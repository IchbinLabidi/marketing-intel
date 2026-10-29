"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MAX_FILE_BYTES, mediaKindOf } from "@/lib/publishing/rules";
import type { ActionResult } from "@/lib/validation/common";
import { driveConfig, driveFileMeta, revokeDriveToken } from "@/server/drive/google";
import { driveAccessToken, getDriveConnection } from "@/server/drive/service";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { clearSocialTokens, readSocialTokens } from "@/server/services/social";
import { SocialApiError } from "@/server/social/http";
import { describeSocialError } from "@/server/social/sync";
import { hasPermission } from "@/server/services/team";

async function guard(projectId: string) {
  await requireUser();
  const { project } = await getProjectContext(projectId);
  return hasPermission(project.workspace_id, "calendar.edit");
}

export type DrivePickerState = {
  configured: boolean; missing: string[]; email: string | null;
  /** Only what the Google Picker needs in the browser: a short-lived access token (≤1 h, drive.file only), never the refresh token. */
  picker: { accessToken: string; apiKey: string; appId: string; clientId: string } | null;
};

export async function drivePickerAction(projectId: string): Promise<ActionResult<DrivePickerState>> {
  if (!(await guard(projectId))) return { ok: false, error: "Your role can't attach media in the calendar." };
  const c = driveConfig();
  if (c.missing.length) return { ok: true, data: { configured: false, missing: c.missing, email: null, picker: null } };
  const conn = await getDriveConnection(projectId);
  if (!conn) return { ok: true, data: { configured: true, missing: [], email: null, picker: null } };
  try {
    const accessToken = await driveAccessToken(await createClient(), conn);
    return { ok: true, data: { configured: true, missing: [], email: conn.account_name, picker: { accessToken, apiKey: c.apiKey, appId: c.appId, clientId: c.clientId } } };
  } catch (e) {
    return { ok: false, error: describeSocialError(e) };
  }
}

/**
 * Records a picked Drive file on a post: only a reference (id and metadata) is stored, not the bytes. The file is
 * checked through the Drive API with the project's authorization: it must exist, be downloadable and be an image
 * or a video small enough to publish.
 */
export async function attachDriveFileAction(projectId: string, itemId: string, fileId: string): Promise<ActionResult<{ id: string }>> {
  if (!(await guard(projectId))) return { ok: false, error: "Your role can't attach media in the calendar." };
  const conn = await getDriveConnection(projectId);
  if (!conn) return { ok: false, error: "Connect Google Drive first." };
  try {
    const db = await createClient();
    const meta = await driveFileMeta(await driveAccessToken(db, conn), fileId);
    if (meta.trashed) return { ok: false, error: "This file is in the Drive trash." };
    if (meta.capabilities?.canDownload === false) return { ok: false, error: "Your Google account can't download this file (the owner restricted downloads)." };
    if (!mediaKindOf(meta.mimeType)) return { ok: false, error: "Choose an image or a video." };
    const size = Number(meta.size ?? 0);
    if (size > MAX_FILE_BYTES) return { ok: false, error: `This file is ${(size / 1024 / 1024).toFixed(1)} MB; publishing supports up to 50 MB.` };
    const { data: item } = await db.from("content_items").select("language").eq("project_id", projectId).eq("id", itemId).maybeSingle();
    if (!item) return { ok: false, error: "Post not found." };
    const { data: row, error } = await db.from("content_assets").insert({
      project_id: projectId, content_item_id: itemId, kind: "media", language: item.language || "fr",
      body: {
        source_type: "google_drive", source_file_id: meta.id, name: meta.name.slice(0, 200), mime: meta.mimeType, size_bytes: size || null,
        thumbnail_url: meta.thumbnailLink ?? null, drive_file_url: meta.webViewLink ?? null, modified_time: meta.modifiedTime ?? null,
        // Persistent while the file exists in Drive and the project's Drive authorization is valid; re-checked at publication.
        persistence_status: "google_drive",
      },
    }).select("id").single();
    if (error) throw error;
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, data: { id: row.id }, message: `${meta.name} attached from Google Drive` };
  } catch (e) {
    if (e instanceof SocialApiError && e.kind === "not_found") return { ok: false, error: "This file can't be found with the project's Drive access." };
    return { ok: false, error: describeSocialError(e) };
  }
}

export async function disconnectDriveAction(projectId: string): Promise<ActionResult> {
  if (!(await guard(projectId))) return { ok: false, error: "Your role can't change integrations." };
  const conn = await getDriveConnection(projectId);
  if (!conn) return { ok: true, message: "Already disconnected" };
  const db = await createClient();
  const t = await readSocialTokens(db, conn.id).catch(() => ({ access: null, refresh: null }));
  if (t.refresh || t.access) await revokeDriveToken((t.refresh ?? t.access)!);
  await clearSocialTokens(db, conn.id).catch(() => undefined);
  await db.from("social_connections").update({ status: "disconnected" }).eq("id", conn.id);
  revalidatePath(`/p/${projectId}`, "layout");
  return { ok: true, message: "Google Drive disconnected. Files already attached stay referenced but can't be published until you reconnect." };
}
