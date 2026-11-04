"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { getT } from "@/i18n/server";
import { youtubeApiKey } from "@/server/social/config";
import { PROVIDERS } from "@/server/social/providers";
import { findPublicChannel } from "@/server/social/providers/youtube";
import { startSocialSync } from "@/server/social/start";
import { describeSocialError } from "@/server/social/sync";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { clearSocialTokens, getSocialConnection, readSocialTokens } from "@/server/services/social";
import { hasPermission } from "@/server/services/team";

const noEdit = async (): Promise<ActionResult<never>> => ({ ok: false, error: (await getT("integrations"))("actions.cannotManage") });
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function guard(projectId: string) {
  const user = await requireUser();
  const { project } = await getProjectContext(projectId);
  return { user, allowed: await hasPermission(project.workspace_id, "intelligence.edit") };
}

/** Connects a YouTube channel's public data with the server's API key (no sign-in to Google needed). */
export async function addYouTubeChannelAction(projectId: string, input: string): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return noEdit();
  const t = await getT("integrations");
  if (!youtubeApiKey()) return { ok: false, error: t("actions.youtubeKeyMissing") };
  try {
    const channel = await findPublicChannel(input);
    if (!channel) return { ok: false, error: t("actions.channelNotFound") };
    const db = await createClient();
    const { data: existing } = await db.from("social_connections").select("id, auth_type, status").eq("project_id", projectId).eq("provider", "youtube").eq("external_account_id", channel.externalId).maybeSingle();
    if (existing?.auth_type === "oauth" && existing.status !== "disconnected") return { ok: false, error: channel.name ? t("actions.channelAlreadyFull", { name: channel.name }) : t("actions.thisChannelAlreadyFull") };
    const { data, error } = await db.from("social_connections").upsert({
      project_id: projectId, provider: "youtube", auth_type: "api_key", external_account_id: channel.externalId, account_name: channel.name, account_handle: channel.handle,
      account_url: channel.url, avatar_url: channel.avatar, status: "connected", granted_scopes: [], declined_scopes: [], token_expires_at: null, last_error: null, connected_by: user.id,
    }, { onConflict: "project_id,provider,external_account_id" }).select("id").single();
    if (error) throw error;
    await startSocialSync(projectId, data.id, "connect");
    refresh(projectId);
    return { ok: true, message: channel.name ? t("actions.channelAdded", { name: channel.name }) : t("actions.channelAddedUnnamed") };
  } catch (e) {
    return { ok: false, error: describeSocialError(e) };
  }
}

export async function syncSocialAction(projectId: string, connectionId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return noEdit();
  const r = await startSocialSync(projectId, connectionId, "manual");
  if (!r.ok) return r;
  refresh(projectId);
  return { ok: true, message: (await getT("integrations"))("actions.syncStarted") };
}

/**
 * Revokes the token at the provider when possible, deletes it here and marks the account disconnected.
 * Imported posts are kept unless the user asks to delete them.
 */
export async function disconnectSocialAction(projectId: string, connectionId: string, deletePosts: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return noEdit();
  try {
    const t = await getT("integrations");
    const conn = await getSocialConnection(projectId, connectionId);
    if (!conn) return { ok: true, message: t("actions.alreadyRemoved") };
    const db = await createClient();
    if (conn.auth_type === "oauth") {
      const tokens = await readSocialTokens(db, conn.id).catch(() => ({ access: null, refresh: null }));
      // Several accounts can share one authorization (e.g. LinkedIn pages), and the same account can be connected in
      // another project: revoking at the provider would cut those too, so only revoke when nothing else uses it.
      const { count } = await db.from("social_connections").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("provider", conn.provider).eq("auth_type", "oauth").neq("status", "disconnected").neq("id", conn.id);
      const { count: elsewhere } = await db.from("social_connections").select("id", { count: "exact", head: true }).eq("provider", conn.provider).eq("external_account_id", conn.external_account_id).eq("auth_type", "oauth").neq("status", "disconnected").neq("id", conn.id);
      // a Google grant is shared with Google Drive (same Google app), so YouTube tokens are only deleted here, never revoked
      if (!count && !elsewhere && conn.provider !== "youtube" && (tokens.refresh || tokens.access)) await PROVIDERS[conn.provider].revoke(tokens.refresh ?? tokens.access!);
      await clearSocialTokens(db, conn.id);
    }
    const { error } = await db.from("social_connections").update({ status: "disconnected", last_error: null, token_expires_at: null }).eq("id", conn.id);
    if (error) throw error;
    if (deletePosts) {
      const { error: e2 } = await db.from("historical_content_items").delete().eq("project_id", projectId).eq("social_connection_id", conn.id);
      if (e2) throw e2;
    }
    refresh(projectId);
    return { ok: true, message: deletePosts ? t("actions.disconnectedDeleted") : t("actions.disconnectedKept") };
  } catch (e) {
    return { ok: false, error: describeSocialError(e) };
  }
}

export async function setSocialAutoSyncAction(projectId: string, connectionId: string, enabled: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return noEdit();
  const db = await createClient();
  const { error } = await db.from("social_connections").update({ auto_sync: enabled }).eq("project_id", projectId).eq("id", connectionId);
  if (error) return { ok: false, error: error.message };
  refresh(projectId);
  const t = await getT("integrations");
  return { ok: true, message: enabled ? t("actions.dailyOn") : t("actions.dailyOff") };
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
  const [td, t] = await Promise.all([getT("domain"), getT("integrations")]);
  const metrics = [
    { label: td("metric.reach"), value: v("reach") }, { label: td("metric.impressions"), value: v("impressions") }, { label: td("metric.views"), value: v("video_views") ?? v("views") },
    { label: td("metric.likes"), value: v("likes") }, { label: td("metric.comments"), value: v("comments") }, { label: td("metric.shares"), value: v("shares") }, { label: td("metric.saves"), value: v("saves") },
    { label: td("metric.clicks"), value: v("clicks") }, { label: t("performance.watchTime"), value: v("watch_time_minutes") },
  ];
  return { ok: true, data: { platform: row.platform as string | null, permalink: row.permalink as string | null, published_at: row.published_at as string | null, source: row.source as string, metrics_updated_at: row.metrics_updated_at as string | null, metrics } };
}
