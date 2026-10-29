import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canEdit } from "@/lib/domain/constants";
import { isMetaConfigured } from "@/server/meta/config";
import { buildAuthUrl } from "@/server/meta/oauth";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const META_STATE_COOKIE = "meta_oauth"; // read back by /api/meta/callback

/** Starts the official Facebook Login flow for one project. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  await requireUser();
  const { role } = await getProjectContext(projectId); // 404s when the user has no access
  const back = new URL(`/p/${projectId}/history`, request.url);
  if (!canEdit(role)) {
    back.searchParams.set("meta_error", "read_only");
    return NextResponse.redirect(back);
  }
  if (!isMetaConfigured()) {
    back.searchParams.set("meta_error", "not_configured");
    return NextResponse.redirect(back);
  }
  const state = randomBytes(24).toString("base64url");
  // publish=1 also asks for the publishing permissions (used by the calendar's Publish button)
  const res = NextResponse.redirect(buildAuthUrl(state, { publish: request.nextUrl.searchParams.get("publish") === "1" }));
  res.cookies.set(META_STATE_COOKIE, JSON.stringify({ state, projectId }), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/meta",
    maxAge: 600,
  });
  return res;
}
