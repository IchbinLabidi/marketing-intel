"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canEdit } from "@/lib/domain/constants";
import type { PublishTarget } from "@/lib/publishing/rules";
import type { ActionResult } from "@/lib/validation/common";
import { classifyMetaError, facebookScheduleError, publishInstagram, PUBLISH_SCOPES } from "@/server/publishing/meta";
import { describeSocialError } from "@/server/social/sync";
import { checkTikTok } from "@/server/publishing/tiktok";
import { YOUTUBE_UPLOAD_SCOPE } from "@/server/publishing/youtube";
import { getAccess } from "@/server/services/social";
import { getPost } from "@/server/services/calendar";
import { getMetaConnection, readMetaTokens } from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";
import {
  accountOf, checkTargets, cleanup, guessMime, loadAssets, prepareSenders, sendClaimed, syncItemStatus, tiktokConnection, youtubeConnection,
  type Asset, type Env, type Publication,
} from "@/server/publishing/core";

import { getFormatter, getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";

export type { Publication } from "@/server/publishing/core";

const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");
// Orix Signals publishes Instagram, TikTok and YouTube itself at the chosen time (their APIs can't schedule a post)
const MIN_LEAD_MS = 5 * 60_000;
const MAX_LEAD_MS = 75 * 24 * 3600_000;

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  return { user, allowed: canEdit(role) && (await hasPermission(project.workspace_id, "calendar.edit")) };
}

export async function listPublicationsAction(projectId: string, itemId: string): Promise<ActionResult<Publication[]>> {
  await requireUser();
  await getProjectContext(projectId);
  const db = await createClient();
  const { data, error } = await db.from("content_publications").select("id, content_item_id, provider, account_ref, account_name, status, scheduled_for, platform_post_id, platform_url, error, error_kind, attempts, updated_at")
    .eq("project_id", projectId).eq("content_item_id", itemId).order("created_at");
  if (error) return { ok: true, data: [] }; // table missing before migration 0017
  return { ok: true, data: data as Publication[] };
}

/**
 * Publishes an approved calendar post to the chosen networks, or schedules it: Facebook keeps a scheduled post itself;
 * Instagram, TikTok and YouTube are queued here and sent by the scheduled-publishing job at that time.
 * One publication row per network and account guarantees the post can't be sent twice.
 */
export async function publishPostAction(
  projectId: string,
  itemId: string,
  input: { targets: PublishTarget[]; mediaAssetId?: string | null; mediaAssetIds?: string[]; scheduleAt: string | null; allowTemporaryLink: boolean; youtubeVariant?: "shorts" | "video" },
): Promise<ActionResult<{ publications: Publication[] }>> {
  const { user, allowed } = await guard(projectId);
  const t = await getT("publishing");
  if (!allowed) return { ok: false, error: t("actions.notAllowed") };
  const targets = [...new Set(input.targets)].filter((t): t is PublishTarget => t === "facebook" || t === "instagram" || t === "tiktok" || t === "youtube");
  if (!targets.length) return { ok: false, error: t("actions.chooseTargets") };
  const item = await getPost(projectId, itemId);
  if (!item) return { ok: false, error: t("actions.postNotFound") };
  if (!["approved", "scheduled"].includes(item.status)) return { ok: false, error: t("actions.notApproved") };
  const scheduleAt = input.scheduleAt ? new Date(input.scheduleAt) : null;
  if (scheduleAt) {
    if (Number.isNaN(scheduleAt.getTime())) return { ok: false, error: t("actions.invalidDate") };
    if (targets.includes("facebook")) { const err = facebookScheduleError(t, scheduleAt); if (err) return { ok: false, error: err }; }
    const lead = scheduleAt.getTime() - Date.now();
    if (targets.some((t) => t !== "facebook") && (lead < MIN_LEAD_MS || lead > MAX_LEAD_MS)) return { ok: false, error: t("actions.leadWindow") };
  }

  const db = await createClient();
  const env: Env = { db, admin: false, t };
  const prep = await prepareSenders(env, projectId, targets);
  if (!prep.ok) return { ok: false, error: prep.error };
  const ids = [...new Set(input.mediaAssetIds ?? (input.mediaAssetId ? [input.mediaAssetId] : []))];
  const loaded = await loadAssets(env, projectId, itemId, ids);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const assets: Asset[] = loaded.assets;
  const youtubeVariant = input.youtubeVariant === "shorts" || input.youtubeVariant === "video" ? input.youtubeVariant : undefined;
  const problem = checkTargets(item, targets, assets, youtubeVariant);
  if (problem) return { ok: false, error: problem };
  // a queued Instagram post needs the temporary-link consent now: nobody is there to give it at publishing time
  if (scheduleAt && targets.includes("instagram") && !input.allowTemporaryLink && assets.some((a) => !a.body.url)) {
    return { ok: false, error: t("actions.igTempLinkSchedule") };
  }

  const results: Publication[] = [];
  for (const target of targets) {
    const account = accountOf(prep.senders, target);
    const slot = () => db.from("content_publications").select("*").eq("content_item_id", itemId).eq("provider", target).eq("account_ref", account.ref).maybeSingle();
    // Claim the (post, network, account) slot. A row that is published, scheduled or in progress blocks a second send.
    await db.from("content_publications").upsert(
      { project_id: projectId, content_item_id: itemId, provider: target, account_ref: account.ref, account_name: account.name, status: "queued", created_by: user.id },
      { onConflict: "content_item_id,provider,account_ref", ignoreDuplicates: true },
    );
    if (scheduleAt && target !== "facebook") {
      // queued with its time: the scheduled-publishing job sends it then (a later "Publish now" takes it over)
      const { data: queued } = await db.from("content_publications")
        .update({ status: "queued", scheduled_for: scheduleAt.toISOString(), media_asset_ids: assets.map((a) => a.id), allow_temp_link: input.allowTemporaryLink, error: null, error_kind: null, next_attempt_at: null, created_by: user.id })
        .eq("content_item_id", itemId).eq("provider", target).eq("account_ref", account.ref).in("status", ["queued", "failed", "cancelled"])
        .select("*").maybeSingle();
      const row = queued ?? (await slot()).data;
      if (row) results.push(row as Publication);
      continue;
    }
    const { data: claimed } = await db.from("content_publications")
      .update({ status: "uploading", error: null, error_kind: null, scheduled_for: null, media_asset_id: assets[0]?.id ?? null })
      .eq("content_item_id", itemId).eq("provider", target).eq("account_ref", account.ref).in("status", ["queued", "failed", "cancelled"])
      .select("id, attempts").maybeSingle();
    if (!claimed) {
      const { data: existing } = await slot();
      if (existing) results.push(existing as Publication);
      continue; // already published / scheduled / in progress
    }
    results.push(await sendClaimed(env, prep.senders, { projectId, item, target, assets, claimed, scheduleAt: target === "facebook" ? scheduleAt : null, allowTemporaryLink: input.allowTemporaryLink, youtubeVariant }));
  }
  await syncItemStatus(db, projectId, itemId, results);
  refresh(projectId);
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length === results.length) return { ok: false, error: failed.map((f) => `${f.provider}: ${f.error}`).join(" · ") };
  return { ok: true, data: { publications: results }, message: summary(results, t, (await getFormatter()).list) };
}

/** Stops a post queued in Orix Signals for a later time (it was never sent: nothing to undo on the network). */
export async function cancelScheduledAction(projectId: string, publicationId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  const t = await getT("publishing");
  if (!allowed) return { ok: false, error: t("actions.notAllowed") };
  const db = await createClient();
  const { data: row } = await db.from("content_publications").update({ status: "cancelled", error: t("actions.scheduleCancelled"), error_kind: null, next_attempt_at: null })
    .eq("project_id", projectId).eq("id", publicationId).eq("status", "queued").not("scheduled_for", "is", null).select("*").maybeSingle();
  if (!row) return { ok: false, error: t("actions.noLongerWaiting") };
  const { data: all } = await db.from("content_publications").select("*").eq("content_item_id", row.content_item_id);
  const pubs = (all ?? []) as Publication[];
  if (!pubs.some((p) => ["published", "scheduled", "uploading", "processing"].includes(p.status) || (p.status === "queued" && p.scheduled_for))) {
    await db.from("content_items").update({ status: "approved" }).eq("id", row.content_item_id).eq("project_id", projectId).eq("status", "scheduled");
  }
  refresh(projectId);
  return { ok: true, message: t("actions.scheduleCancelled") };
}

/** Resumes an Instagram video still being processed by Meta. */
export async function checkPublicationAction(projectId: string, publicationId: string): Promise<ActionResult<{ publication: Publication }>> {
  const { allowed } = await guard(projectId);
  const t = await getT("publishing");
  if (!allowed) return { ok: false, error: t("actions.notAllowed") };
  const db = await createClient();
  const { data: pub } = await db.from("content_publications").select("*").eq("project_id", projectId).eq("id", publicationId).maybeSingle();
  if (!pub) return { ok: false, error: t("actions.publicationNotFound") };
  if (pub.status !== "processing" || !pub.container_id) return { ok: true, data: { publication: pub as Publication } };
  if (pub.provider === "tiktok") {
    const tt = await tiktokConnection(db, projectId);
    if (!tt) return { ok: false, error: t("actions.reconnectTikTok") };
    try {
      const r = await checkTikTok({ t, token: (await getAccess(db, tt)).token!, publishId: pub.container_id, username: tt.account_handle, waitMs: 20_000 });
      const { data: row } = await db.from("content_publications").update(r.processing ? { updated_at: new Date().toISOString() } : { status: "published", platform_post_id: r.postId, platform_url: r.url }).eq("id", pub.id).select("*").single();
      await syncItemStatus(db, projectId, pub.content_item_id, [row as Publication]);
      refresh(projectId);
      return { ok: true, data: { publication: row as Publication }, message: r.processing ? t("actions.tiktokProcessing") : t("actions.publishedTikTok") };
    } catch (e) {
      const { data: row } = await db.from("content_publications").update({ status: "failed", error: describeSocialError(e).slice(0, 1000), error_kind: "permanent" }).eq("id", pub.id).select("*").single();
      refresh(projectId);
      return { ok: false, error: describeSocialError(e), data: { publication: row as Publication } } as ActionResult<{ publication: Publication }>;
    }
  }
  const conn = await getMetaConnection(projectId);
  const { page } = conn ? await readMetaTokens(conn.id) : { page: null };
  if (!conn || !page) return { ok: false, error: t("actions.reconnectMeta") };
  try {
    const r = await publishInstagram({ t, igUserId: pub.account_ref, pageToken: page, caption: "", media: { kind: "video", url: "", mime: "video/mp4" }, containerId: pub.container_id, waitMs: 60_000 });
    const { data: row } = await db.from("content_publications").update(r.processing ? { updated_at: new Date().toISOString() } : { status: "published", platform_post_id: r.postId, platform_url: r.url, temp_media_path: null }).eq("id", pub.id).select("*").single();
    if (!r.processing) await cleanup(db, pub.temp_media_path);
    await syncItemStatus(db, projectId, pub.content_item_id, [row as Publication]);
    refresh(projectId);
    return { ok: true, data: { publication: row as Publication }, message: r.processing ? t("actions.instagramProcessing") : t("actions.publishedInstagram") };
  } catch (e) {
    const c = classifyMetaError(e, t);
    const { data: row } = await db.from("content_publications").update({ status: "failed", error: c.message.slice(0, 1000), error_kind: c.kind, temp_media_path: null }).eq("id", pub.id).select("*").single();
    await cleanup(db, pub.temp_media_path);
    refresh(projectId);
    return { ok: false, error: c.message, data: { publication: row as Publication } } as ActionResult<{ publication: Publication }>;
  }
}

/** The post was deleted on the network: mark that publication as not published (history kept) so it can be published
 *  again. When no network still holds the post, it returns to Approved. Nothing is deleted on the network. */
export async function unpublishPublicationAction(projectId: string, publicationId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  const t = await getT("publishing");
  if (!allowed) return { ok: false, error: t("actions.notAllowed") };
  const db = await createClient();
  const { data, error } = await db.rpc("unpublish_publication", { p_project: projectId, p_publication: publicationId });
  if (error) return { ok: false, error: error.message };
  refresh(projectId);
  const provider = (data as Publication | null)?.provider;
  return { ok: true, message: provider ? t("actions.unpublishedOn", { provider: `${provider.charAt(0).toUpperCase()}${provider.slice(1)}` }) : t("actions.unpublished") };
}

const LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
function summary(pubs: Publication[], t: TFor<"publishing">, list: (items: string[]) => string) {
  const by = (s: string) => pubs.filter((p) => p.status === s).map((p) => LABEL[p.provider] ?? p.provider);
  return [
    by("published").length ? t("summary.published", { networks: list(by("published")) }) : null,
    by("scheduled").length ? t("summary.scheduled", { networks: list(by("scheduled")) }) : null,
    by("queued").length ? t("summary.queued", { networks: list(by("queued")) }) : null,
    by("processing").length ? t("summary.processing", { networks: list(by("processing")) }) : null,
    by("failed").length ? t("summary.failed", { networks: list(by("failed")) }) : null,
  ].filter(Boolean).join(" · ");
}

export type PublishContext = {
  assets: { id: string; name: string; mime: string | null; source: "stored" | "link" | "google_drive"; previewUrl: string | null; fullUrl: string | null }[];
  facebook: { name: string } | null;
  instagram: { name: string } | null;
  /** connected TikTok account; canPost false until posting (video.publish) is granted */
  tiktok: { name: string; canPost: boolean } | null;
  /** YouTube channel connected with Google; canPost false until uploading is granted */
  youtube: { name: string; canPost: boolean } | null;
  missingScopes: string[];
  publications: Publication[];
};

/** What the publish dialog needs: the post's media (with stable preview addresses), the connected accounts, past attempts. */
export async function publishContextAction(projectId: string, itemId: string): Promise<ActionResult<PublishContext>> {
  await requireUser();
  await getProjectContext(projectId);
  const t = await getT("publishing");
  const db = await createClient();
  const { data: rows } = await db.from("content_assets").select("id, body, created_at").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").order("created_at", { ascending: false });
  const assets: PublishContext["assets"] = [];
  for (const r of (rows ?? []) as (Asset & { created_at: string })[]) {
    const b = r.body;
    const source = b.source_type === "google_drive" ? "google_drive" : b.path ? "stored" : "link";
    // the media route checks access on every request and renews signed links, so previews survive a refresh
    const media = `/api/media/${r.id}?project=${projectId}`;
    assets.push({ id: r.id, name: b.name ?? t("context.media"), mime: b.mime ?? (b.url ? guessMime(b.url) : null), source, previewUrl: `${media}&size=thumb`, fullUrl: media });
  }
  const conn = await getMetaConnection(projectId);
  const active = conn && conn.status === "active" && conn.page_id;
  const pubs = await listPublicationsAction(projectId, itemId);
  const tt = await tiktokConnection(db, projectId);
  const yt = await youtubeConnection(db, projectId);
  return {
    ok: true,
    data: {
      assets,
      facebook: active ? { name: conn.page_name ?? t("context.facebookPage") } : null,
      instagram: active && conn.ig_user_id ? { name: conn.ig_username ? `@${conn.ig_username}` : "Instagram" } : null,
      tiktok: tt ? { name: tt.account_handle ?? tt.account_name ?? "TikTok", canPost: tt.granted_scopes.includes("video.publish") } : null,
      youtube: yt ? { name: yt.account_name ?? yt.account_handle ?? "YouTube", canPost: yt.granted_scopes.includes(YOUTUBE_UPLOAD_SCOPE) } : null,
      missingScopes: active ? PUBLISH_SCOPES.filter((s) => !conn.granted_scopes.includes(s)) : [],
      publications: pubs.ok ? pubs.data ?? [] : [],
    },
  };
}
