import { NextResponse, type NextRequest } from "next/server";
import { canEdit } from "@/lib/domain/constants";
import { exchangeCode, getMetaUser, listManagedPages } from "@/server/meta/oauth";
import { getMetaConnection, storeMetaTokens, upsertMetaConnection } from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const COOKIE = "meta_oauth";

/** OAuth redirect target. Exchanges the code server-side, stores the encrypted long-lived token, then asks for a Page. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let saved: { state?: string; projectId?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(COOKIE)?.value ?? "{}");
  } catch {}
  const projectId = saved.projectId ?? "";
  const back = (q: Record<string, string>) => {
    const url = new URL(projectId ? `/p/${projectId}/history` : "/dashboard", request.url);
    for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: COOKIE, path: "/api/meta" });
    return res;
  };

  // CSRF: the state must match the one we set for this browser a few minutes ago.
  if (!saved.state || params.get("state") !== saved.state) return back({ meta_error: "state" });
  if (params.get("error")) return back({ meta_error: params.get("error_reason") === "user_denied" ? "denied" : "oauth" });
  const code = params.get("code");
  if (!code) return back({ meta_error: "oauth" });

  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return back({ meta_error: "read_only" });

  try {
    const { token, expiresAt } = await exchangeCode(code);
    const me = await getMetaUser(token);
    const previous = await getMetaConnection(projectId);
    // Reconnecting with the same Page selected before: refresh its Page token and resume without asking again.
    const pages = previous?.page_id ? await listManagedPages(token) : [];
    const samePage = pages.find((p) => p.id === previous?.page_id);

    const conn = await upsertMetaConnection(projectId, {
      connected_by: user.id,
      fb_user_id: me.id,
      fb_user_name: me.name,
      granted_scopes: me.granted,
      declined_scopes: me.declined,
      token_expires_at: expiresAt,
      status: samePage ? "active" : "pending_page",
      last_error: null,
      ...(samePage
        ? { ig_user_id: samePage.instagram_business_account?.id ?? null, ig_username: samePage.instagram_business_account?.username ?? null, page_name: samePage.name }
        : { page_id: null, page_name: null, ig_user_id: null, ig_username: null }),
    });
    await storeMetaTokens(conn.id, { user: token, page: samePage?.access_token ?? null });
    return back(samePage ? { meta: "reconnected" } : { meta: "select_page" });
  } catch (e) {
    return back({ meta_error: "exchange", meta_message: (e instanceof Error ? e.message : "Unknown error").slice(0, 200) });
  }
}
