import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SCOPES } from "@/server/social/config";
import { isSocialProvider, PROVIDERS } from "@/server/social/providers";
import { startSocialSync } from "@/server/social/start";
import { describeSocialError } from "@/server/social/sync";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { storeSocialTokens } from "@/server/services/social";
import { hasPermission } from "@/server/services/team";

const COOKIE = "social_oauth";
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * OAuth redirect target. Validates state (CSRF) against the cookie set by /connect, exchanges the code on the
 * server, records every account the person authorized, stores the tokens encrypted and starts the first sync.
 * Nothing is recorded as connected unless the token exchange and the account lookup both succeeded.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const user = await requireUser();
  const raw = request.cookies.get(COOKIE)?.value;
  let saved: { state: string; verifier: string; projectId: string; provider: string; userId: string } | null = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  const projectId = saved?.projectId ?? "";
  const back = new URL(projectId ? `/p/${projectId}/integrations` : "/projects", request.url);
  back.searchParams.set("provider", provider);
  const done = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: COOKIE, path: "/api/integrations" });
    return res;
  };

  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!saved || !isSocialProvider(provider) || saved.provider !== provider || saved.userId !== user.id || !state || !same(state, saved.state)) return done({ error: "state" });
  const denied = request.nextUrl.searchParams.get("error");
  if (denied) return done({ error: denied === "access_denied" || denied === "user_cancelled" ? "denied" : "provider", detail: (request.nextUrl.searchParams.get("error_description") ?? denied).slice(0, 200) });
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done({ error: "provider", detail: "No authorization code returned." });

  const { project } = await getProjectContext(projectId);
  if (!(await hasPermission(project.workspace_id, "intelligence.edit"))) return done({ error: "read_only" });

  const client = PROVIDERS[provider];
  try {
    const tokens = await client.exchange(code, saved.verifier);
    const accounts = await client.accounts(tokens.access);
    if (!accounts.length) return done({ error: "no_accounts" });
    const granted = tokens.scopes;
    const declined = granted.length ? SCOPES[provider].filter((s) => !granted.includes(s)) : [];
    const db = await createClient();
    const ids: string[] = [];
    for (const a of accounts) {
      const { data, error } = await db.from("social_connections").upsert({
        project_id: projectId, provider, auth_type: "oauth", external_account_id: a.externalId, account_name: a.name, account_handle: a.handle, account_url: a.url, avatar_url: a.avatar,
        status: "connected", granted_scopes: granted, declined_scopes: declined, token_expires_at: tokens.expiresAt, last_error: null, connected_by: user.id,
      }, { onConflict: "project_id,provider,external_account_id" }).select("id").single();
      if (error) throw error;
      await storeSocialTokens(db, data.id, tokens);
      ids.push(data.id);
    }
    for (const id of ids) await startSocialSync(projectId, id, "connect");
    return done({ connected: String(ids.length) });
  } catch (e) {
    return done({ error: "provider", detail: describeSocialError(e).slice(0, 200) });
  }
}
