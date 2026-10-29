"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canEdit } from "@/lib/domain/constants";
import { composeCaption, MAX_GROUP, mediaKindOf, validateForTarget, validateGroup, type PublishTarget } from "@/lib/publishing/rules";
import type { ActionResult } from "@/lib/validation/common";
import { classifyMetaError, facebookScheduleError, publishFacebook, publishFacebookPhotos, publishInstagram, publishInstagramCarousel, PUBLISH_SCOPES, type MediaInput, type PublishResult } from "@/server/publishing/meta";
import { MetaApiError } from "@/server/meta/graph";
import { downloadDriveFile } from "@/server/drive/google";
import { driveAccessToken, getDriveConnection } from "@/server/drive/service";
import { SocialApiError } from "@/server/social/http";
import { describeSocialError } from "@/server/social/sync";
import { MAX_FILE_BYTES } from "@/lib/publishing/rules";
import { getPost, updatePost } from "@/server/services/calendar";
import { getMetaConnection, readMetaTokens } from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";

export type Publication = {
  id: string; content_item_id: string; provider: string; account_ref: string; account_name: string | null; status: string;
  scheduled_for: string | null; platform_post_id: string | null; platform_url: string | null; error: string | null; error_kind: string | null;
  attempts: number; updated_at: string;
};

const BUCKET = "production-media";
const SIGNED_LINK_SECONDS = 60 * 60; // Instagram downloads the media within minutes; the link expires after an hour
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

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

type Asset = { id: string; body: { path?: string; url?: string; name?: string; mime?: string; source_type?: string; source_file_id?: string } };
type Prepared = { media: MediaInput; tempPath: string | null };

/**
 * Turns a media attachment into what each network accepts. Never makes a private file public.
 * Google Drive files are downloaded through the Drive API with the project's authorization (no sharing link); for
 * Instagram, which needs a URL, a temporary private copy is stored and removed once Instagram has it.
 */
async function mediaFor(db: Awaited<ReturnType<typeof createClient>>, projectId: string, itemId: string, asset: Asset | null, target: PublishTarget, allowTemporaryLink: boolean): Promise<Prepared> {
  if (!asset) return { media: { kind: "none" }, tempPath: null };
  const mime = asset.body.mime ?? (asset.body.url ? guessMime(asset.body.url) : "");
  const kind = mediaKindOf(mime);
  if (!kind) throw new Error("This attachment isn't an image or a video.");
  if (asset.body.source_type === "google_drive") {
    const conn = await getDriveConnection(projectId);
    if (!conn || !asset.body.source_file_id) throw new Error("Google Drive isn't connected for this project. Reconnect it to publish this file.");
    const bytes = await downloadDriveFile(await driveAccessToken(db, conn), asset.body.source_file_id, MAX_FILE_BYTES);
    const filename = asset.body.name ?? "media";
    if (target === "facebook") return { media: { kind, bytes, filename, mime }, tempPath: null };
    if (!allowTemporaryLink) throw new Error("Instagram downloads media from a link. Allow the temporary private link (valid 1 hour) to publish this file.");
    const tempPath = `${projectId}/${itemId}/publish-tmp-${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
    const up = await db.storage.from(BUCKET).upload(tempPath, bytes, { contentType: mime, upsert: false });
    if (up.error) throw new Error("Could not prepare the Drive file for Instagram.");
    const { data } = await db.storage.from(BUCKET).createSignedUrl(tempPath, SIGNED_LINK_SECONDS);
    if (!data?.signedUrl) { await db.storage.from(BUCKET).remove([tempPath]); throw new Error("Could not prepare the Drive file for Instagram."); }
    return { media: { kind, url: data.signedUrl, mime }, tempPath };
  }
  if (asset.body.url) return { media: { kind, url: asset.body.url, mime }, tempPath: null }; // already a public https link chosen by the team
  if (!asset.body.path) throw new Error("The attachment has no stored file.");
  if (target === "facebook") {
    // Facebook receives the bytes directly: no link to the private file is ever created
    const { data, error } = await db.storage.from(BUCKET).download(asset.body.path);
    if (error || !data) throw new Error("The stored file could not be read. Re-attach it.");
    return { media: { kind, bytes: data, filename: asset.body.name ?? "media", mime }, tempPath: null };
  }
  // Instagram only accepts a URL it downloads itself: a signed link valid for one hour, only with explicit consent
  if (!allowTemporaryLink) throw new Error("Instagram downloads media from a link. Allow the temporary private link (valid 1 hour) to publish this file.");
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(asset.body.path, SIGNED_LINK_SECONDS);
  if (error || !data?.signedUrl) throw new Error("Could not prepare the file for Instagram.");
  return { media: { kind, url: data.signedUrl, mime }, tempPath: null };
}

/** Removes temporary copies made for Instagram (best effort; never blocks the publication result). Several paths are stored one per line. */
async function cleanup(db: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined) {
  const paths = (path ?? "").split("\n").filter(Boolean);
  if (paths.length) await db.storage.from(BUCKET).remove(paths).catch(() => undefined);
}

const guessMime = (url: string) => (/\.(mp4|mov)(\?|$)/i.test(url) ? "video/mp4" : /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg");

/**
 * Publishes (or schedules, on Facebook) an approved calendar post to the project's connected Page and/or Instagram
 * account. One publication row per network and account guarantees the post can't be sent twice.
 */
export async function publishPostAction(
  projectId: string,
  itemId: string,
  input: { targets: PublishTarget[]; mediaAssetId?: string | null; mediaAssetIds?: string[]; scheduleAt: string | null; allowTemporaryLink: boolean },
): Promise<ActionResult<{ publications: Publication[] }>> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return { ok: false, error: "Your role can't publish from the calendar." };
  const targets = [...new Set(input.targets)].filter((t): t is PublishTarget => t === "facebook" || t === "instagram");
  if (!targets.length) return { ok: false, error: "Choose where to publish." };
  const item = await getPost(projectId, itemId);
  if (!item) return { ok: false, error: "Post not found." };
  if (!["approved", "scheduled"].includes(item.status)) return { ok: false, error: "Only approved posts can be published. Approve it in Content Production first." };
  const scheduleAt = input.scheduleAt ? new Date(input.scheduleAt) : null;
  if (scheduleAt) {
    if (targets.includes("instagram")) return { ok: false, error: "Instagram can't be scheduled through its API. Publish to Instagram now, or schedule Facebook only." };
    const err = facebookScheduleError(scheduleAt);
    if (err) return { ok: false, error: err };
  }

  const conn = await getMetaConnection(projectId);
  if (!conn || conn.status !== "active" || !conn.page_id) return { ok: false, error: "Connect Meta (Facebook Page) on the Integrations page first." };
  const missing = PUBLISH_SCOPES.filter((s) => (s === "instagram_content_publish" ? targets.includes("instagram") : targets.includes("facebook")) && !conn.granted_scopes.includes(s));
  if (missing.length) return { ok: false, error: `Meta hasn't granted publishing yet (${missing.join(", ")}). Reconnect Meta on the Integrations page and accept the publishing permissions.` };
  if (targets.includes("instagram") && !conn.ig_user_id) return { ok: false, error: "No Instagram professional account is linked to the connected Page." };
  const { page: pageToken } = await readMetaTokens(conn.id);
  if (!pageToken) return { ok: false, error: "The Page access token is missing. Reconnect Meta." };

  const db = await createClient();
  // Media in the order the person selected it (the first one leads the carousel)
  const ids = [...new Set(input.mediaAssetIds ?? (input.mediaAssetId ? [input.mediaAssetId] : []))];
  if (ids.length > MAX_GROUP) return { ok: false, error: `Choose at most ${MAX_GROUP} photos for one post.` };
  let assets: Asset[] = [];
  if (ids.length) {
    const { data } = await db.from("content_assets").select("id, body").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").in("id", ids);
    const found = (data ?? []) as Asset[];
    if (found.length !== ids.length) return { ok: false, error: "The selected media isn't attached to this post." };
    assets = ids.map((id) => found.find((a) => a.id === id)!);
  }
  const asset = assets[0] ?? null;
  const mimeOf = (a: Asset) => a.body.mime ?? (a.body.url ? guessMime(a.body.url) : null);
  const caption = composeCaption(item);
  for (const t of targets) {
    const problem = validateGroup(t, assets.map(mimeOf)) ?? validateForTarget(t, { caption, mime: asset ? mimeOf(asset) : null, hasMedia: Boolean(asset) });
    if (problem) return { ok: false, error: problem };
  }

  const results: Publication[] = [];
  for (const target of targets) {
    const accountRef = target === "facebook" ? conn.page_id : conn.ig_user_id!;
    const accountName = target === "facebook" ? conn.page_name : conn.ig_username ? `@${conn.ig_username}` : null;
    // Claim the (post, network, account) slot. A row that is published, scheduled or in progress blocks a second send.
    await db.from("content_publications").upsert(
      { project_id: projectId, content_item_id: itemId, provider: target, account_ref: accountRef, account_name: accountName, status: "queued", created_by: user.id },
      { onConflict: "content_item_id,provider,account_ref", ignoreDuplicates: true },
    );
    const { data: claimed } = await db.from("content_publications")
      .update({ status: "uploading", error: null, error_kind: null, media_asset_id: asset?.id ?? null })
      .eq("content_item_id", itemId).eq("provider", target).eq("account_ref", accountRef).in("status", ["queued", "failed", "cancelled"])
      .select("id, attempts").maybeSingle();
    if (!claimed) {
      const { data: existing } = await db.from("content_publications").select("*").eq("content_item_id", itemId).eq("provider", target).eq("account_ref", accountRef).maybeSingle();
      if (existing) results.push(existing as Publication);
      continue; // already published / scheduled / in progress
    }
    let tempPath: string | null = null;
    try {
      const prepared: { media: MediaInput; tempPath: string | null }[] = [];
      try {
        for (const a of assets.length ? assets : [null]) prepared.push(await mediaFor(db, projectId, itemId, a, target, input.allowTemporaryLink));
      } finally {
        tempPath = prepared.map((p) => p.tempPath).filter(Boolean).join("\n") || null;
      }
      const media = prepared[0].media;
      let r: PublishResult;
      if (target === "facebook") {
        r = prepared.length > 1
          ? await publishFacebookPhotos({ pageId: conn.page_id, pageToken, message: caption, photos: prepared.map((p) => p.media), scheduleAt })
          : await publishFacebook({ pageId: conn.page_id, pageToken, message: caption, media, scheduleAt });
      } else {
        const items = prepared.map((p) => p.media);
        if (items.some((m) => m.kind === "none" || !("url" in m))) throw new Error("Instagram needs an image or a video.");
        const urls = items as Extract<MediaInput, { url: string }>[];
        r = urls.length > 1
          ? await publishInstagramCarousel({ igUserId: conn.ig_user_id!, pageToken, caption, items: urls, waitMs: 90_000 })
          : await publishInstagram({ igUserId: conn.ig_user_id!, pageToken, caption, media: urls[0], waitMs: 90_000 });
      }
      const status = r.processing ? "processing" : r.scheduledFor ? "scheduled" : "published";
      const { data: row } = await db.from("content_publications").update({
        status, platform_post_id: r.postId || null, platform_url: r.url, scheduled_for: r.scheduledFor, container_id: r.containerId ?? null, attempts: claimed.attempts + 1, next_attempt_at: null,
        // a video still processing keeps its temporary copy until Instagram is done with it
        temp_media_path: r.processing ? tempPath : null,
      }).eq("id", claimed.id).select("*").single();
      if (!r.processing) await cleanup(db, tempPath);
      results.push(row as Publication);
    } catch (e) {
      // our own checks (missing file, consent) are validation errors; Meta errors are classified by their code
      await cleanup(db, tempPath);
      const c = e instanceof MetaApiError ? classifyMetaError(e)
        : e instanceof SocialApiError ? { kind: (e.isAuth || e.isPermission ? "auth" : e.kind === "server" || e.kind === "network" || e.kind === "rate_limit" ? "transient" : "permanent") as "auth" | "transient" | "permanent", message: describeSocialError(e) }
        : { kind: "validation" as const, message: e instanceof Error ? e.message : "Unknown error" };
      const { data: row } = await db.from("content_publications").update({
        status: "failed", error: c.message.slice(0, 1000), error_kind: c.kind, attempts: claimed.attempts + 1,
        next_attempt_at: c.kind === "transient" ? new Date(Date.now() + 2 ** Math.min(claimed.attempts, 6) * 60_000).toISOString() : null,
      }).eq("id", claimed.id).select("*").single();
      results.push(row as Publication);
    }
  }
  await syncItemStatus(projectId, itemId, results);
  refresh(projectId);
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length === results.length) return { ok: false, error: failed.map((f) => `${f.provider}: ${f.error}`).join(" · ") };
  return { ok: true, data: { publications: results }, message: summary(results) };
}

/** Resumes an Instagram video still being processed by Meta. */
export async function checkPublicationAction(projectId: string, publicationId: string): Promise<ActionResult<{ publication: Publication }>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return { ok: false, error: "Your role can't publish from the calendar." };
  const db = await createClient();
  const { data: pub } = await db.from("content_publications").select("*").eq("project_id", projectId).eq("id", publicationId).maybeSingle();
  if (!pub) return { ok: false, error: "Publication not found." };
  if (pub.status !== "processing" || !pub.container_id) return { ok: true, data: { publication: pub as Publication } };
  const conn = await getMetaConnection(projectId);
  const { page } = conn ? await readMetaTokens(conn.id) : { page: null };
  if (!conn || !page) return { ok: false, error: "Reconnect Meta to finish this publication." };
  try {
    const r = await publishInstagram({ igUserId: pub.account_ref, pageToken: page, caption: "", media: { kind: "video", url: "", mime: "video/mp4" }, containerId: pub.container_id, waitMs: 60_000 });
    const { data: row } = await db.from("content_publications").update(r.processing ? { updated_at: new Date().toISOString() } : { status: "published", platform_post_id: r.postId, platform_url: r.url, temp_media_path: null }).eq("id", pub.id).select("*").single();
    if (!r.processing) await cleanup(db, pub.temp_media_path);
    await syncItemStatus(projectId, pub.content_item_id, [row as Publication]);
    refresh(projectId);
    return { ok: true, data: { publication: row as Publication }, message: r.processing ? "Instagram is still processing the video. Check again in a minute." : "Published on Instagram" };
  } catch (e) {
    const c = classifyMetaError(e);
    const { data: row } = await db.from("content_publications").update({ status: "failed", error: c.message.slice(0, 1000), error_kind: c.kind, temp_media_path: null }).eq("id", pub.id).select("*").single();
    await cleanup(db, pub.temp_media_path);
    refresh(projectId);
    return { ok: false, error: c.message, data: { publication: row as Publication } } as ActionResult<{ publication: Publication }>;
  }
}

/** The calendar item follows its publications: published as soon as one network has it live. */
async function syncItemStatus(projectId: string, itemId: string, pubs: Publication[]) {
  const live = pubs.find((p) => p.status === "published" && p.platform_url);
  if (live) {
    await updatePost(projectId, itemId, { status: "published", published_at: new Date().toISOString(), published_url: live.platform_url, publish_error: null }).catch(() => undefined);
  } else if (pubs.some((p) => p.status === "scheduled")) {
    await updatePost(projectId, itemId, { status: "scheduled", publish_error: null }).catch(() => undefined);
  } else if (pubs.every((p) => p.status === "failed")) {
    await updatePost(projectId, itemId, { publish_error: pubs.map((p) => `${p.provider}: ${p.error}`).join(" · ").slice(0, 1000) }).catch(() => undefined);
  }
}

function summary(pubs: Publication[]) {
  const by = (s: string) => pubs.filter((p) => p.status === s).map((p) => (p.provider === "facebook" ? "Facebook" : "Instagram"));
  return [
    by("published").length ? `Published on ${by("published").join(" and ")}` : null,
    by("scheduled").length ? `Scheduled on ${by("scheduled").join(" and ")}` : null,
    by("processing").length ? `${by("processing").join(" and ")} still processing the video` : null,
    by("failed").length ? `Failed on ${by("failed").join(" and ")}` : null,
  ].filter(Boolean).join(" · ");
}

export type PublishContext = {
  assets: { id: string; name: string; mime: string | null; source: "stored" | "link" | "google_drive"; previewUrl: string | null }[];
  facebook: { name: string } | null;
  instagram: { name: string } | null;
  missingScopes: string[];
  publications: Publication[];
};

/** What the publish dialog needs: the post's media (with short-lived previews), the connected accounts, past attempts. */
export async function publishContextAction(projectId: string, itemId: string): Promise<ActionResult<PublishContext>> {
  await requireUser();
  await getProjectContext(projectId);
  const db = await createClient();
  const { data: rows } = await db.from("content_assets").select("id, body, created_at").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").order("created_at", { ascending: false });
  const assets: PublishContext["assets"] = [];
  for (const r of (rows ?? []) as (Asset & { created_at: string })[]) {
    const b = r.body;
    const source = b.source_type === "google_drive" ? "google_drive" : b.path ? "stored" : "link";
    let previewUrl: string | null = b.url ?? null;
    if (b.path) previewUrl = (await db.storage.from(BUCKET).createSignedUrl(b.path, 600)).data?.signedUrl ?? null; // 10-minute preview link
    assets.push({ id: r.id, name: b.name ?? "Media", mime: b.mime ?? (b.url ? guessMime(b.url) : null), source, previewUrl });
  }
  const conn = await getMetaConnection(projectId);
  const active = conn && conn.status === "active" && conn.page_id;
  const pubs = await listPublicationsAction(projectId, itemId);
  return {
    ok: true,
    data: {
      assets,
      facebook: active ? { name: conn.page_name ?? "Facebook Page" } : null,
      instagram: active && conn.ig_user_id ? { name: conn.ig_username ? `@${conn.ig_username}` : "Instagram" } : null,
      missingScopes: active ? PUBLISH_SCOPES.filter((s) => !conn.granted_scopes.includes(s)) : [],
      publications: pubs.ok ? pubs.data ?? [] : [],
    },
  };
}
