"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";
import { getT } from "@/i18n/server";

const BUCKET = "production-media";

/**
 * Permanently deletes one media attachment of a post: the stored file is removed from storage first (so a failure
 * leaves everything as it was), then the database record. Google Drive files are only references: the record is
 * deleted, the original stays in the person's Drive. Media used by a publication still in progress can't be deleted.
 */
export async function deleteMediaAction(projectId: string, itemId: string, assetId: string): Promise<ActionResult> {
  await requireUser();
  const t = await getT("calendar");
  const { project } = await getProjectContext(projectId);
  if (!(await hasPermission(project.workspace_id, "calendar.edit")) && !(await hasPermission(project.workspace_id, "content.create"))) {
    return { ok: false, error: t("mediaActions.noDelete") };
  }
  const db = await createClient();
  const { data: asset } = await db.from("content_assets").select("id, body").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").eq("id", assetId).maybeSingle();
  if (!asset) return { ok: false, error: t("mediaActions.alreadyDeleted") };
  const body = asset.body as { path?: string; source_type?: string; name?: string };

  const { data: busy } = await db.from("content_publications").select("id").eq("media_asset_id", assetId).in("status", ["uploading", "processing"]).limit(1);
  if (busy?.length) return { ok: false, error: t("mediaActions.beingPublished") };

  if (body.path) {
    if (!body.path.startsWith(`${projectId}/${itemId}/`)) return { ok: false, error: t("mediaActions.invalidPath") };
    const { error } = await db.storage.from(BUCKET).remove([body.path]);
    if (error) return { ok: false, error: t("mediaActions.storageFailed") };
  }
  const { error, count } = await db.from("content_assets").delete({ count: "exact" }).eq("id", assetId).eq("project_id", projectId);
  if (error || !count) {
    // the file is already gone: a second attempt deletes the record (removing a missing file is not an error)
    return { ok: false, error: error?.message.includes("locked") ? t("mediaActions.locked") : t("mediaActions.recordFailed") };
  }
  revalidatePath(`/p/${projectId}`, "layout");
  const name = body.name ?? t("mediaActions.defaultName");
  return { ok: true, message: body.source_type === "google_drive" ? t("mediaActions.removedDrive", { name }) : body.path ? t("mediaActions.deletedPermanently", { name }) : t("mediaActions.removed", { name }) };
}
