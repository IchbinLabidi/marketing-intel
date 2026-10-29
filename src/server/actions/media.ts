"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";

const BUCKET = "production-media";

/**
 * Permanently deletes one media attachment of a post: the stored file is removed from storage first (so a failure
 * leaves everything as it was), then the database record. Google Drive files are only references: the record is
 * deleted, the original stays in the person's Drive. Media used by a publication still in progress can't be deleted.
 */
export async function deleteMediaAction(projectId: string, itemId: string, assetId: string): Promise<ActionResult> {
  await requireUser();
  const { project } = await getProjectContext(projectId);
  if (!(await hasPermission(project.workspace_id, "calendar.edit")) && !(await hasPermission(project.workspace_id, "content.create"))) {
    return { ok: false, error: "Your role can't delete media." };
  }
  const db = await createClient();
  const { data: asset } = await db.from("content_assets").select("id, body").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").eq("id", assetId).maybeSingle();
  if (!asset) return { ok: false, error: "This media was already deleted." };
  const body = asset.body as { path?: string; source_type?: string; name?: string };

  const { data: busy } = await db.from("content_publications").select("id").eq("media_asset_id", assetId).in("status", ["uploading", "processing"]).limit(1);
  if (busy?.length) return { ok: false, error: "This media is being published right now. Try again once the publication has finished." };

  if (body.path) {
    if (!body.path.startsWith(`${projectId}/${itemId}/`)) return { ok: false, error: "Invalid file path." };
    const { error } = await db.storage.from(BUCKET).remove([body.path]);
    if (error) return { ok: false, error: "The file couldn't be removed from storage, so nothing was deleted. Try again." };
  }
  const { error, count } = await db.from("content_assets").delete({ count: "exact" }).eq("id", assetId).eq("project_id", projectId);
  if (error || !count) {
    // the file is already gone: a second attempt deletes the record (removing a missing file is not an error)
    return { ok: false, error: error?.message.includes("locked") ? "Published content is locked." : "The record couldn't be deleted. Try again." };
  }
  revalidatePath(`/p/${projectId}`, "layout");
  const name = body.name ?? "Media";
  return { ok: true, message: body.source_type === "google_drive" ? `${name} removed from the post (the original stays in your Google Drive)` : body.path ? `${name} deleted permanently` : `${name} removed` };
}
