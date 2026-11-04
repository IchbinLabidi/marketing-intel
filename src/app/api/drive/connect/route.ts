import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { driveAuthUrl, driveConfig } from "@/server/drive/google";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";

/** Starts Google's OAuth flow (drive.file) for one project. State, PKCE verifier and user stay in an httpOnly cookie. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const backParam = request.nextUrl.searchParams.get("back");
  const back = backParam === "calendar" || backParam === "production" ? backParam : "integrations";
  // A production card to reopen after Google's consent screen (only a uuid is kept).
  const itemParam = request.nextUrl.searchParams.get("item") ?? "";
  const item = back === "production" && /^[0-9a-f-]{36}$/i.test(itemParam) ? itemParam : null;
  const user = await requireUser();
  const { project } = await getProjectContext(projectId);
  const done = new URL(`/p/${projectId}/integrations?provider=google_drive`, request.url); // errors are explained on Integrations
  if (!(await hasPermission(project.workspace_id, "calendar.edit"))) {
    done.searchParams.set("error", "read_only");
    return NextResponse.redirect(done);
  }
  if (driveConfig().missing.length) {
    done.searchParams.set("error", "not_configured");
    return NextResponse.redirect(done);
  }
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const res = NextResponse.redirect(driveAuthUrl(state, createHash("sha256").update(verifier).digest("base64url")));
  res.cookies.set("drive_oauth", JSON.stringify({ state, verifier, projectId, userId: user.id, back, item }), {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/drive", maxAge: 600,
  });
  return res;
}
