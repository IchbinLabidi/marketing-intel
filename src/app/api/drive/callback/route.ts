import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { driveAccount, DRIVE_SCOPES, exchangeDriveCode } from "@/server/drive/google";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { clearSocialTokens, storeSocialTokens } from "@/server/services/social";
import { describeSocialError } from "@/server/social/sync";
import { hasPermission } from "@/server/services/team";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google's redirect: validates state against the cookie, exchanges the code on the server, stores tokens encrypted. */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  let saved: { state: string; verifier: string; projectId: string; userId: string; back: string } | null = null;
  try { saved = JSON.parse(request.cookies.get("drive_oauth")?.value ?? "null"); } catch { saved = null; }
  const page = (to: string) => new URL(saved ? `/p/${saved.projectId}/${to}` : "/projects", request.url);
  // Success returns where the person started; failures always land on Integrations, which explains them.
  const done = (params: Record<string, string>) => {
    const back = page(params.error ? "integrations" : saved?.back === "calendar" ? "calendar" : "integrations");
    for (const [k, v] of Object.entries({ provider: "google_drive", ...params })) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: "drive_oauth", path: "/api/drive" });
    return res;
  };
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!saved || saved.userId !== user.id || !state || !same(state, saved.state)) return done({ error: "state" });
  if (request.nextUrl.searchParams.get("error")) return done({ error: "denied" });
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "provider" });
  const { project } = await getProjectContext(saved.projectId);
  if (!(await hasPermission(project.workspace_id, "calendar.edit"))) return done({ error: "read_only" });
  try {
    const tokens = await exchangeDriveCode(code, saved.verifier);
    if (!tokens.scopes.includes(DRIVE_SCOPES[0])) return done({ error: "scope" });
    const account = await driveAccount(tokens.access);
    const db = await createClient();
    const { data, error } = await db.from("social_connections").upsert({
      project_id: saved.projectId, provider: "google_drive", auth_type: "oauth", external_account_id: account.id, account_name: account.email, account_handle: account.email,
      status: "connected", granted_scopes: tokens.scopes, declined_scopes: [], token_expires_at: tokens.expiresAt, auto_sync: false, last_error: null, connected_by: user.id,
    }, { onConflict: "project_id,provider,external_account_id" }).select("id").single();
    if (error) throw error;
    await storeSocialTokens(db, data.id, tokens);
    // one Google account per project: connecting another account replaces the previous one
    const { data: others } = await db.from("social_connections").select("id").eq("project_id", saved.projectId).eq("provider", "google_drive").neq("id", data.id).neq("status", "disconnected");
    for (const o of others ?? []) {
      await clearSocialTokens(db, o.id).catch(() => undefined);
      await db.from("social_connections").update({ status: "disconnected" }).eq("id", o.id);
    }
    return done({ connected: "1" });
  } catch (e) {
    return done({ error: "provider", detail: describeSocialError(e).slice(0, 200) });
  }
}
