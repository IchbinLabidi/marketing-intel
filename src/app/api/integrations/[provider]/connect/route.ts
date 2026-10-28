import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isOAuthConfigured } from "@/server/social/config";
import { isSocialProvider, PROVIDERS } from "@/server/social/providers";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";

const SOCIAL_STATE_COOKIE = "social_oauth";

/** Starts the provider's official OAuth flow for one project. State and PKCE verifier stay in an httpOnly cookie. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/connect">) {
  const { provider } = await ctx.params;
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const user = await requireUser();
  const { project } = await getProjectContext(projectId); // 404 when the user has no access
  const back = new URL(`/p/${projectId}/integrations`, request.url);
  if (!isSocialProvider(provider)) return NextResponse.redirect(back);
  back.searchParams.set("provider", provider);
  if (!(await hasPermission(project.workspace_id, "intelligence.edit"))) {
    back.searchParams.set("error", "read_only");
    return NextResponse.redirect(back);
  }
  if (!isOAuthConfigured(provider)) {
    back.searchParams.set("error", "not_configured");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const res = NextResponse.redirect(PROVIDERS[provider].authUrl(state, challenge));
  res.cookies.set(SOCIAL_STATE_COOKIE, JSON.stringify({ state, verifier, projectId, provider, userId: user.id }), {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/integrations", maxAge: 600,
  });
  return res;
}
