import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { driveAuthUrl, driveConfig } from "@/server/drive/google";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";

/** Starts Google's OAuth flow (drive.file) for one project. State, PKCE verifier and user stay in an httpOnly cookie. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const back = request.nextUrl.searchParams.get("back") === "calendar" ? "calendar" : "integrations";
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
  res.cookies.set("drive_oauth", JSON.stringify({ state, verifier, projectId, userId: user.id, back }), {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/drive", maxAge: 600,
  });
  return res;
}
