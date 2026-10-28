"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { youtubeApiKey } from "@/server/social/config";
import { PROVIDERS } from "@/server/social/providers";
import { findPublicChannel } from "@/server/social/providers/youtube";
import { startSocialSync } from "@/server/social/start";
import { describeSocialError } from "@/server/social/sync";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { clearSocialTokens, getSocialConnection, readSocialTokens } from "@/server/services/social";
import { hasPermission } from "@/server/services/team";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role can't manage integrations for this project." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function guard(projectId: string) {
  const user = await requireUser();
  const { project } = await getProjectContext(projectId);
  return { user, allowed: await hasPermission(project.workspace_id, "intelligence.edit") };
}

/** Connects a YouTube channel's public data with the server's API key (no sign-in to Google needed). */
export async function addYouTubeChannelAction(projectId: string, input: string): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!youtubeApiKey()) return { ok: false, error: "YOUTUBE_API_KEY is not configured on the server." };
  try {
    const channel = await findPublicChannel(input);
    if (!channel) return { ok: false, error: "No channel found. Paste the channel URL (youtube.com/@name or /channel/UC…), an @handle or the channel id." };
    const db = await createClient();
    const { data: existing } = await db.from("social_connections").select("id, auth_type, status").eq("project_id", projectId).eq("provider", "youtube").eq("external_account_id", channel.externalId).maybeSingle();
    if (existing?.auth_type === "oauth" && existing.status !== "disconnected") return { ok: false, error: `${channel.name ?? "This channel"} is already connected with full access.` };
    const { data, error } = await db.from("social_connections").upsert({
      project_id: projectId, provider: "youtube", auth_type: "api_key", external_account_id: channel.externalId, account_name: channel.name, account_handle: channel.handle,
      account_url: channel.url, avatar_url: channel.avatar, status: "connected", granted_scopes: [], declined_scopes: [], token_expires_at: null, last_error: null, connected_by: user.id,
    }, { onConflict: "project_id,provider,external_account_id" }).select("id").single();
    if (error) throw error;
    await startSocialSync(projectId, data.id, "connect");
    refresh(projectId);
    return { ok: true, message: `${channel.name ?? "Channel"} added. Importing its videos…` };
  } catch (e) {
    return { ok: false, error: describeSocialError(e) };
  }
}

export async function syncSocialAction(projectId: string, connectionId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const r = await startSocialSync(projectId, connectionId, "manual");
  if (!r.ok) return r;
  refresh(projectId);
  return { ok: true, message: "Synchronization started" };
}

/**
 * Revokes the token at the provider when possible, deletes it here and marks the account disconnected.
 * Imported posts are kept unless the user asks to delete them.
 */
export async function disconnectSocialAction(projectId: string, connectionId: string, deletePosts: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const conn = await getSocialConnection(projectId, connectionId);
    if (!conn) return { ok: true, message: "Already removed" };
    const db = await createClient();
    if (conn.auth_type === "oauth") {
      const tokens = await readSocialTokens(db, conn.id).catch(() => ({ access: null, refresh: null }));
      // Several accounts can share one authorization (e.g. LinkedIn pages); only revoke when this was the last one.
      const { count } = await db.from("social_connections").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("provider", conn.provider).eq("auth_type", "oauth").neq("status", "disconnected").neq("id", conn.id);
      if (!count && (tokens.refresh || tokens.access)) await PROVIDERS[conn.provider].revoke(tokens.refresh ?? tokens.access!);
      await clearSocialTokens(db, conn.id);
    }
    const { error } = await db.from("social_connections").update({ status: "disconnected", last_error: null, token_expires_at: null }).eq("id", conn.id);
    if (error) throw error;
    if (deletePosts) {
      const { error: e2 } = await db.from("historical_content_items").delete().eq("project_id", projectId).eq("social_connection_id", conn.id);
      if (e2) throw e2;
    }
    refresh(projectId);
    return { ok: true, message: deletePosts ? "Disconnected and imported posts deleted" : "Disconnected. Imported posts are kept." };
  } catch (e) {
    return { ok: false, error: describeSocialError(e) };
  }
}

export async function setSocialAutoSyncAction(projectId: string, connectionId: string, enabled: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { error } = await db.from("social_connections").update({ auto_sync: enabled }).eq("project_id", projectId).eq("id", connectionId);
  if (error) return { ok: false, error: error.message };
  refresh(projectId);
  return { ok: true, message: enabled ? "Daily synchronization on" : "Daily synchronization off" };
}

export type PublishedPerformance = {
  platform: string | null; permalink: string | null; published_at: string | null; source: string; metrics_updated_at: string | null;
  metrics: { label: string; value: number | null }[];
};

/**
 * Real figures of the synced post a calendar item is linked to (after publication was verified). Needs permission
 * to view Content history; metrics the platform didn't return are reported as unavailable, not zero.
 */
export async function publishedPerformanceAction(projectId: string, itemId: string): Promise<ActionResult<PublishedPerformance | null>> {
  await requireUser();
  const { project } = await getProjectContext(projectId);
  if (!(await hasPermission(project.workspace_id, "intelligence.view"))) return { ok: true, data: null };
  const db = await createClient();
  const { data: item } = await db.from("content_items").select("historical_source_id, status").eq("project_id", projectId).eq("id", itemId).maybeSingle();
  if (!item?.historical_source_id || item.status !== "published") return { ok: true, data: null };
  const { data: h, error } = await db.from("historical_content_items").select("*").eq("project_id", projectId).eq("id", item.historical_source_id).maybeSingle();
  if (error || !h) return { ok: true, data: null };
  const row = h as Record<string, unknown>;
  const v = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : row[k] == null ? null : Number(row[k]));
  const metrics = [
    { label: "Reach", value: v("reach") }, { label: "Impressions", value: v("impressions") }, { label: "Views", value: v("video_views") ?? v("views") },
    { label: "Likes", value: v("likes") }, { label: "Comments", value: v("comments") }, { label: "Shares", value: v("shares") }, { label: "Saves", value: v("saves") },
    { label: "Clicks", value: v("clicks") }, { label: "Watch time (min)", value: v("watch_time_minutes") },
  ];
  return { ok: true, data: { platform: row.platform as string | null, permalink: row.permalink as string | null, published_at: row.published_at as string | null, source: row.source as string, metrics_updated_at: row.metrics_updated_at as string | null, metrics } };
}
