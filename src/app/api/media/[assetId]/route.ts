import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { downloadDriveFile, driveFileMeta } from "@/server/drive/google";
import { driveAccessToken, getDriveConnection } from "@/server/drive/service";
import { MAX_FILE_BYTES } from "@/lib/publishing/rules";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

type Body = { path?: string; url?: string; mime?: string; source_type?: string; source_file_id?: string };

/**
 * A stable address for a post's media, used by previews so they keep working after a refresh (signed links and
 * Drive thumbnails expire). Access goes through the same row-level security as the post itself.
 * - files kept in Signal's storage: redirect to a fresh signed link (10 minutes)
 * - Google Drive files: read through the Drive API with the project's authorization (?size=thumb uses Drive's thumbnail)
 * - public links: redirect to the link
 * Nothing is ever made public.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/media/[assetId]">) {
  const { assetId } = await ctx.params;
  const projectId = request.nextUrl.searchParams.get("project") ?? "";
  const thumb = request.nextUrl.searchParams.get("size") === "thumb";
  await requireUser();
  await getProjectContext(projectId);
  const db = await createClient();
  const { data } = await db.from("content_assets").select("id, body").eq("project_id", projectId).eq("id", assetId).eq("kind", "media").maybeSingle();
  if (!data) return new NextResponse("Media not found", { status: 404 });
  const body = data.body as Body;

  if (body.path) {
    const { data: signed } = await db.storage.from("production-media").createSignedUrl(body.path, 600);
    if (!signed?.signedUrl) return new NextResponse("The stored file is missing", { status: 404 });
    return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "private, max-age=300" } });
  }
  if (body.source_type === "google_drive" && body.source_file_id) {
    const conn = await getDriveConnection(projectId);
    if (!conn) return new NextResponse("Google Drive isn't connected for this project", { status: 409 });
    try {
      const token = await driveAccessToken(db, conn);
      if (thumb) {
        const meta = await driveFileMeta(token, body.source_file_id);
        if (meta.thumbnailLink) {
          // Drive thumbnails are sized by the "=sNNN" suffix; 800 px keeps previews sharp without the full file
          const res = await fetch(meta.thumbnailLink.replace(/=s\d+$/, "=s800"), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
          if (res.ok) return new NextResponse(res.body, { headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=3600" } });
        }
      }
      const file = await downloadDriveFile(token, body.source_file_id, MAX_FILE_BYTES);
      return new NextResponse(file, { headers: { "Content-Type": file.type || body.mime || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
    } catch {
      return new NextResponse("This Drive file can't be read (deleted, or Drive access expired)", { status: 502 });
    }
  }
  if (body.url?.startsWith("https://")) return NextResponse.redirect(body.url);
  return new NextResponse("Media has no file", { status: 404 });
}
