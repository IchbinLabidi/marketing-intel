import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultYouTubeVariant, publicationCopy, readCaptions } from "@/lib/production/platform-copy";
import { composeCaption, MAX_FILE_BYTES, MAX_GROUP, mediaKindOf, validateForTarget, validateGroup, type PublishTarget } from "@/lib/publishing/rules";
import { classifyMetaError, facebookPostStatus, publishFacebook, publishFacebookPhotos, publishInstagram, publishInstagramCarousel, PUBLISH_SCOPES, type MediaInput, type PublishResult } from "@/server/publishing/meta";
import { MetaApiError } from "@/server/meta/graph";
import { metaConfig } from "@/server/meta/config";
import { decryptToken } from "@/server/meta/crypto";
import { downloadDriveFile, refreshDriveToken } from "@/server/drive/google";
import { SocialApiError } from "@/server/social/http";
import { describeSocialError } from "@/server/social/sync";
import { isJpeg, toInstagramJpeg } from "@/server/publishing/convert";
import { checkTikTok, publishTikTokPhotos, publishTikTokVideo } from "@/server/publishing/tiktok";
import { tiktokMediaUrl } from "@/server/publishing/tiktok-media";
import { publishYouTubeVideo, YOUTUBE_UPLOAD_SCOPE, youtubeTitle } from "@/server/publishing/youtube";
import { getAccess, readSocialTokens, storeSocialTokens, type SocialConnection } from "@/server/services/social";
import type { ContentItem, MetaConnection } from "@/types/domain";
import type { TFor } from "@/i18n/messages";

// The publishing engine, shared by the Publish dialog (signed-in user, RLS) and the scheduled-publishing job
// (service role, admin = true, nobody signed in). Not a server action: never import it from client code.

/** `t` writes the messages stored on a failed publication: the signed-in user's language, English for the scheduled job. */
export type Env = { db: SupabaseClient; admin: boolean; t: TFor<"publishing"> };

export type Publication = {
  id: string; content_item_id: string; provider: string; account_ref: string; account_name: string | null; status: string;
  scheduled_for: string | null; platform_post_id: string | null; platform_url: string | null; error: string | null; error_kind: string | null;
  attempts: number; updated_at: string;
};

export type Asset = { id: string; body: { path?: string; url?: string; name?: string; mime?: string; source_type?: string; source_file_id?: string } };
type Prepared = { media: MediaInput; tempPath: string | null };

const BUCKET = "production-media";
const SIGNED_LINK_SECONDS = 60 * 60; // Instagram downloads the media within minutes; the link expires after an hour

export const guessMime = (url: string) => (/\.(mp4|mov)(\?|$)/i.test(url) ? "video/mp4" : /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg");

/** Stores a temporary private copy for Instagram to download, and returns a signed link to it (valid one hour). */
async function temporaryLink(env: Env, projectId: string, itemId: string, bytes: Blob, filename: string, mime: string) {
  const { db, t } = env;
  const tempPath = `${projectId}/${itemId}/publish-tmp-${crypto.randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
  const up = await db.storage.from(BUCKET).upload(tempPath, bytes, { contentType: mime, upsert: false });
  if (up.error) throw new Error(t("core.prepareInstagram"));
  const { data } = await db.storage.from(BUCKET).createSignedUrl(tempPath, SIGNED_LINK_SECONDS);
  if (!data?.signedUrl) { await db.storage.from(BUCKET).remove([tempPath]); throw new Error(t("core.prepareInstagram")); }
  return { url: data.signedUrl, tempPath };
}

/** A temporary private JPEG copy that TikTok downloads through a signed link on the app's verified prefix. */
async function tiktokPhotoLink(env: Env, projectId: string, itemId: string, photo: Blob, filename: string) {
  const { db, t } = env;
  const jpeg = await toInstagramJpeg(photo);
  const tempPath = `${projectId}/${itemId}/publish-tmp-${crypto.randomUUID()}-${filename.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)}.jpg`;
  const up = await db.storage.from(BUCKET).upload(tempPath, jpeg, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(t("core.prepareTikTokPhotos"));
  return { url: tiktokMediaUrl(tempPath), tempPath };
}

/** Instagram only takes JPEG photos: anything else is converted (file name gets a .jpg extension). */
async function forInstagram(bytes: Blob, filename: string, mime: string, kind: "image" | "video") {
  if (kind !== "image" || isJpeg(mime)) return { bytes, filename, mime };
  return { bytes: await toInstagramJpeg(bytes), filename: `${filename.replace(/\.[a-z0-9]+$/i, "")}.jpg`, mime: "image/jpeg" };
}

/** The project's Google Drive authorization and a fresh access token (refreshed when it expires). */
async function driveToken(env: Env, projectId: string): Promise<string> {
  const { data: conn } = await env.db.from("social_connections").select("id, token_expires_at")
    .eq("project_id", projectId).eq("provider", "google_drive").neq("status", "disconnected").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) throw new Error(env.t("core.driveNotConnected"));
  const tokens = await readSocialTokens(env.db, conn.id, env.admin);
  const fresh = conn.token_expires_at && Date.parse(conn.token_expires_at) > Date.now() + 5 * 60_000;
  if (tokens.access && fresh) return tokens.access;
  if (!tokens.refresh) throw new SocialApiError(env.t("core.driveExpired"), 401, "Google Drive", "auth");
  const t = await refreshDriveToken(tokens.refresh);
  await storeSocialTokens(env.db, conn.id, { access: t.access, refresh: t.refresh, refreshExpiresAt: null }, env.admin);
  await env.db.from("social_connections").update({ token_expires_at: t.expiresAt, status: "connected", last_error: null }).eq("id", conn.id);
  return t.access;
}

/**
 * Turns a media attachment into what each network accepts. Never makes a private file public.
 * Google Drive files are downloaded through the Drive API with the project's authorization (no sharing link); for
 * Instagram, which needs a URL, a temporary private copy is stored and removed once Instagram has it.
 */
async function mediaFor(env: Env, projectId: string, itemId: string, asset: Asset | null, target: PublishTarget, allowTemporaryLink: boolean): Promise<Prepared> {
  const { db, t } = env;
  if (!asset) return { media: { kind: "none" }, tempPath: null };
  const mime = asset.body.mime ?? (asset.body.url ? guessMime(asset.body.url) : "");
  const kind = mediaKindOf(mime);
  if (!kind) throw new Error(t("core.notMedia"));
  if (asset.body.source_type === "google_drive") {
    if (!asset.body.source_file_id) throw new Error(t("core.driveNotConnected"));
    const bytes = await downloadDriveFile(await driveToken(env, projectId), asset.body.source_file_id, MAX_FILE_BYTES);
    const filename = asset.body.name ?? "media";
    if (target !== "instagram") return { media: { kind, bytes, filename, mime }, tempPath: null };
    if (!allowTemporaryLink) throw new Error(t("core.igTempLinkPublish"));
    const ig = await forInstagram(bytes, filename, mime, kind);
    const link = await temporaryLink(env, projectId, itemId, ig.bytes, ig.filename, ig.mime);
    return { media: { kind, url: link.url, mime: ig.mime }, tempPath: link.tempPath };
  }
  if (asset.body.url) {
    // already a public https link chosen by the team: sent as is, so Instagram needs it to be a JPEG already
    if (target === "instagram" && kind === "image" && !isJpeg(mime)) throw new Error(t("core.igJpegLink"));
    return { media: { kind, url: asset.body.url, mime }, tempPath: null };
  }
  if (!asset.body.path) throw new Error(t("core.noStoredFile"));
  if (target !== "instagram") {
    // Facebook and TikTok receive the bytes directly: no link to the private file is ever created
    const { data, error } = await db.storage.from(BUCKET).download(asset.body.path);
    if (error || !data) throw new Error(t("core.unreadable"));
    return { media: { kind, bytes: data, filename: asset.body.name ?? "media", mime }, tempPath: null };
  }
  // Instagram only accepts a URL it downloads itself: a signed link valid for one hour, only with explicit consent
  if (!allowTemporaryLink) throw new Error(t("core.igTempLinkPublish"));
  if (kind === "image" && !isJpeg(mime)) {
    // not a JPEG: a converted temporary copy is sent instead of the original
    const { data: original, error } = await db.storage.from(BUCKET).download(asset.body.path);
    if (error || !original) throw new Error(t("core.unreadable"));
    const ig = await forInstagram(original, asset.body.name ?? "photo", mime, kind);
    const link = await temporaryLink(env, projectId, itemId, ig.bytes, ig.filename, ig.mime);
    return { media: { kind, url: link.url, mime: ig.mime }, tempPath: link.tempPath };
  }
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(asset.body.path, SIGNED_LINK_SECONDS);
  if (error || !data?.signedUrl) throw new Error(t("core.prepareInstagram"));
  return { media: { kind, url: data.signedUrl, mime }, tempPath: null };
}

/** Removes temporary copies made for Instagram (best effort; never blocks the publication result). Several paths are stored one per line. */
export async function cleanup(db: SupabaseClient, path: string | null | undefined) {
  const paths = (path ?? "").split("\n").filter(Boolean);
  if (paths.length) await db.storage.from(BUCKET).remove(paths).catch(() => undefined);
}

/** The project's YouTube channel authorized with Google (public-data channels can't upload). */
export async function youtubeConnection(db: SupabaseClient, projectId: string): Promise<SocialConnection | null> {
  const { data } = await db.from("social_connections").select("*").eq("project_id", projectId).eq("provider", "youtube").eq("auth_type", "oauth").eq("status", "connected").order("created_at", { ascending: false });
  const rows = (data ?? []) as SocialConnection[];
  return rows.find((r) => r.granted_scopes.includes(YOUTUBE_UPLOAD_SCOPE)) ?? rows[0] ?? null;
}

/** The project's connected TikTok account (the first active one). */
export async function tiktokConnection(db: SupabaseClient, projectId: string): Promise<SocialConnection | null> {
  const { data } = await db.from("social_connections").select("*").eq("project_id", projectId).eq("provider", "tiktok").eq("status", "connected").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as SocialConnection | null) ?? null;
}

/** The Page token: through the permission-checked RPC for a signed-in user, straight from the table for the job. */
export async function metaPageToken(env: Env, connectionId: string): Promise<string | null> {
  const key = metaConfig().tokenKey;
  if (env.admin) {
    const { data } = await env.db.from("meta_tokens").select("page_token_enc").eq("connection_id", connectionId).maybeSingle();
    return data?.page_token_enc ? decryptToken(data.page_token_enc, key) : null;
  }
  const { data, error } = await env.db.rpc("meta_read_tokens", { p_connection: connectionId });
  if (error) throw error;
  const row = (data as { page_token_enc: string | null }[] | null)?.[0];
  return row?.page_token_enc ? decryptToken(row.page_token_enc, key) : null;
}

/** Everything needed to send to the chosen networks: connections, tokens and permissions, or the reason it can't. */
export type Senders = {
  meta: MetaConnection | null; pageToken: string | null;
  tiktok: { conn: SocialConnection; token: string } | null;
  youtube: { conn: SocialConnection; token: string } | null;
};
export async function prepareSenders(env: Env, projectId: string, targets: PublishTarget[]): Promise<{ ok: true; senders: Senders } | { ok: false; error: string }> {
  const { db, t } = env;
  // Meta (Facebook / Instagram) is only required when one of its networks is chosen
  const needsMeta = targets.includes("facebook") || targets.includes("instagram");
  let meta: MetaConnection | null = null;
  let pageToken: string | null = null;
  if (needsMeta) {
    const { data } = await db.from("meta_connections").select("*").eq("project_id", projectId).maybeSingle();
    meta = data as MetaConnection | null;
    if (!meta || meta.status !== "active" || !meta.page_id) return { ok: false, error: t("core.connectMeta") };
    const missing = PUBLISH_SCOPES.filter((s) => (s === "instagram_content_publish" ? targets.includes("instagram") : targets.includes("facebook")) && !meta!.granted_scopes.includes(s));
    if (missing.length) return { ok: false, error: t("core.metaScopes", { scopes: missing.join(", ") }) };
    if (targets.includes("instagram") && !meta.ig_user_id) return { ok: false, error: t("core.noInstagramAccount") };
    pageToken = await metaPageToken(env, meta.id);
    if (!pageToken) return { ok: false, error: t("core.pageTokenMissing") };
  }
  // TikTok: the project's connected account, with the posting permission
  let tiktok: Senders["tiktok"] = null;
  if (targets.includes("tiktok")) {
    const tt = await tiktokConnection(db, projectId);
    if (!tt) return { ok: false, error: t("core.connectTikTok") };
    if (!tt.granted_scopes.includes("video.publish")) return { ok: false, error: t("core.tiktokScope") };
    try { tiktok = { conn: tt, token: (await getAccess(db, tt, env.admin)).token! }; } catch (e) { return { ok: false, error: describeSocialError(e) }; }
  }
  // YouTube: the project's channel authorized with upload permission
  let youtube: Senders["youtube"] = null;
  if (targets.includes("youtube")) {
    const yt = await youtubeConnection(db, projectId);
    if (!yt) return { ok: false, error: t("core.connectYouTube") };
    if (!yt.granted_scopes.includes(YOUTUBE_UPLOAD_SCOPE)) return { ok: false, error: t("core.youtubeScope") };
    try { youtube = { conn: yt, token: (await getAccess(db, yt, env.admin)).token! }; } catch (e) { return { ok: false, error: describeSocialError(e) }; }
  }
  return { ok: true, senders: { meta, pageToken, tiktok, youtube } };
}

/** The account a publication goes to on each network. */
export function accountOf(s: Senders, target: PublishTarget) {
  const ref = target === "youtube" ? s.youtube!.conn.external_account_id : target === "tiktok" ? s.tiktok!.conn.external_account_id : target === "facebook" ? s.meta!.page_id! : s.meta!.ig_user_id!;
  const name = target === "youtube" ? s.youtube!.conn.account_name ?? s.youtube!.conn.account_handle : target === "tiktok" ? s.tiktok!.conn.account_handle ?? s.tiktok!.conn.account_name : target === "facebook" ? s.meta!.page_name : s.meta!.ig_username ? `@${s.meta!.ig_username}` : null;
  return { ref, name };
}

/** The post's chosen media, in the order the person selected it (the first one leads the carousel). */
export async function loadAssets(env: Env, projectId: string, itemId: string, ids: string[]): Promise<{ ok: true; assets: Asset[] } | { ok: false; error: string }> {
  const { db, t } = env;
  if (ids.length > MAX_GROUP) return { ok: false, error: t("core.maxPhotos", { max: MAX_GROUP }) };
  if (!ids.length) return { ok: true, assets: [] };
  const { data } = await db.from("content_assets").select("id, body").eq("project_id", projectId).eq("content_item_id", itemId).eq("kind", "media").in("id", ids);
  const found = (data ?? []) as Asset[];
  if (found.length !== ids.length) return { ok: false, error: t("core.mediaNotAttached") };
  return { ok: true, assets: ids.map((id) => found.find((a) => a.id === id)!) };
}

/**
 * The copy one network sends: the platform's own caption from Content Studio, or the general caption when it has none.
 * YouTube uses the Shorts or the long-form copy (by default the one that fits the item, as the publish dialog shows).
 */
export function copyFor(item: ContentItem, target: PublishTarget, youtubeVariant?: "shorts" | "video") {
  return publicationCopy(item, target, composeCaption, youtubeVariant ?? defaultYouTubeVariant(readCaptions(item.platform_captions), item.format));
}

/** Checks the caption and media against each network's rules; the first problem, or null. */
export function checkTargets(item: ContentItem, targets: PublishTarget[], assets: Asset[], youtubeVariant?: "shorts" | "video"): string | null {
  const mimeOf = (a: Asset) => a.body.mime ?? (a.body.url ? guessMime(a.body.url) : null);
  for (const t of targets) {
    const caption = copyFor(item, t, youtubeVariant).text;
    const problem = validateGroup(t, assets.map(mimeOf)) ?? validateForTarget(t, { caption, mime: assets[0] ? mimeOf(assets[0]) : null, hasMedia: Boolean(assets[0]) });
    if (problem) return problem;
  }
  return null;
}

/**
 * Sends one claimed publication (status "uploading") to its network and records the outcome on the row:
 * published, scheduled (Facebook's own scheduling), processing (videos still being prepared) or failed.
 */
export async function sendClaimed(env: Env, s: Senders, args: {
  projectId: string; item: ContentItem; target: PublishTarget; assets: Asset[]; claimed: { id: string; attempts: number };
  scheduleAt: Date | null; allowTemporaryLink: boolean; youtubeVariant?: "shorts" | "video";
}): Promise<Publication> {
  const { db, t } = env;
  const { projectId, item, target, assets, claimed } = args;
  const { text: caption, title: copyTitle } = copyFor(item, target, args.youtubeVariant);
  let tempPath: string | null = null;
  try {
    const prepared: Prepared[] = [];
    try {
      for (const a of assets.length ? assets : [null]) prepared.push(await mediaFor(env, projectId, item.id, a, target, args.allowTemporaryLink));
    } finally {
      tempPath = prepared.map((p) => p.tempPath).filter(Boolean).join("\n") || null;
    }
    const media = prepared[0].media;
    let r: PublishResult;
    if (target === "youtube") {
      if (media.kind !== "video" || !("bytes" in media)) throw new Error(t("core.youtubeNeedsVideo"));
      r = await publishYouTubeVideo({ t, token: s.youtube!.token, title: youtubeTitle(copyTitle ?? item.title, caption), description: caption, video: media.bytes });
    } else if (target === "tiktok" && media.kind === "image") {
      // photo post: TikTok pulls JPEG copies from signed links on the verified prefix (kept until TikTok is done)
      const urls: string[] = [];
      for (const p of prepared) {
        if (p.media.kind !== "image" || !("bytes" in p.media)) throw new Error(t("core.tiktokPhotosNeedFiles"));
        const link = await tiktokPhotoLink(env, projectId, item.id, p.media.bytes, p.media.filename);
        tempPath = [tempPath, link.tempPath].filter(Boolean).join("\n");
        urls.push(link.url);
      }
      r = await publishTikTokPhotos({ t, token: s.tiktok!.token, title: item.title, description: caption, photoUrls: urls, username: s.tiktok!.conn.account_handle, waitMs: 60_000 });
    } else if (target === "tiktok") {
      if (media.kind !== "video" || !("bytes" in media)) throw new Error(t("core.tiktokNeedsVideo"));
      r = await publishTikTokVideo({ t, token: s.tiktok!.token, caption, video: media.bytes, username: s.tiktok!.conn.account_handle, waitMs: 60_000 });
    } else if (target === "facebook") {
      r = prepared.length > 1
        ? await publishFacebookPhotos({ t, pageId: s.meta!.page_id!, pageToken: s.pageToken!, message: caption, photos: prepared.map((p) => p.media), scheduleAt: args.scheduleAt })
        : await publishFacebook({ t, pageId: s.meta!.page_id!, pageToken: s.pageToken!, message: caption, media, scheduleAt: args.scheduleAt });
    } else {
      const items = prepared.map((p) => p.media);
      if (items.some((m) => m.kind === "none" || !("url" in m))) throw new Error(t("core.instagramNeedsMedia"));
      const urls = items as Extract<MediaInput, { url: string }>[];
      r = urls.length > 1
        ? await publishInstagramCarousel({ t, igUserId: s.meta!.ig_user_id!, pageToken: s.pageToken!, caption, items: urls, waitMs: 90_000 })
        : await publishInstagram({ t, igUserId: s.meta!.ig_user_id!, pageToken: s.pageToken!, caption, media: urls[0], waitMs: 90_000 });
    }
    const status = r.processing ? "processing" : r.scheduledFor ? "scheduled" : "published";
    const { data: row } = await db.from("content_publications").update({
      status, platform_post_id: r.postId || null, platform_url: r.url, scheduled_for: r.scheduledFor, container_id: r.containerId ?? null, attempts: claimed.attempts + 1, next_attempt_at: null,
      // a video still processing keeps its temporary copy until Instagram is done with it
      temp_media_path: r.processing ? tempPath : null,
    }).eq("id", claimed.id).select("*").single();
    if (!r.processing) await cleanup(db, tempPath);
    return row as Publication;
  } catch (e) {
    // our own checks (missing file, consent) are validation errors; Meta errors are classified by their code
    await cleanup(db, tempPath);
    const c = e instanceof MetaApiError ? classifyMetaError(e, t)
      : e instanceof SocialApiError ? { kind: (e.isAuth || e.isPermission ? "auth" : e.kind === "server" || e.kind === "network" || e.kind === "rate_limit" ? "transient" : "permanent") as "auth" | "transient" | "permanent", message: describeSocialError(e) }
      : { kind: "validation" as const, message: e instanceof Error ? e.message : t("core.unknownError") };
    const { data: row } = await db.from("content_publications").update({
      status: "failed", error: c.message.slice(0, 1000), error_kind: c.kind, attempts: claimed.attempts + 1,
      next_attempt_at: c.kind === "transient" ? new Date(Date.now() + 2 ** Math.min(claimed.attempts, 6) * 60_000).toISOString() : null,
    }).eq("id", claimed.id).select("*").single();
    return row as Publication;
  }
}

/** A publication row with the columns the follow-up needs. */
export type PendingPublication = Publication & { project_id: string; container_id: string | null; temp_media_path: string | null };

/** Rows still waiting on the network: a video still processing, or a Facebook post whose scheduled time has passed. */
export const needsFollowUp = (p: Pick<PendingPublication, "status" | "provider" | "scheduled_for" | "container_id" | "platform_post_id">, now = Date.now()) =>
  (p.status === "processing" && Boolean(p.container_id) && (p.provider === "instagram" || p.provider === "tiktok"))
  || (p.status === "scheduled" && p.provider === "facebook" && Boolean(p.platform_post_id) && Boolean(p.scheduled_for) && Date.parse(p.scheduled_for!) <= now);

/**
 * Asks the network how a waiting publication is doing and records it: an Instagram or TikTok video still processing
 * is published once ready; a Facebook post scheduled on Facebook is marked published once its time has come and it is
 * live. Used by "Check again" and by the scheduled-publishing job, so nobody has to come back and click.
 * `changed` is false when the network is still not done (the caller can try again later).
 */
export async function followUp(env: Env, pub: PendingPublication, waitMs = 20_000): Promise<{ publication: Publication; changed: boolean; message: string | null; error?: boolean }> {
  const { db, t } = env;
  const save = async (values: Record<string, unknown>) => {
    const { data } = await db.from("content_publications").update(values).eq("id", pub.id).select("*").single();
    return (data ?? pub) as Publication;
  };
  const waiting = async () => ({ publication: await save({ updated_at: new Date().toISOString() }), changed: false, message: null });
  if (!needsFollowUp(pub)) return { publication: pub, changed: false, message: null };
  try {
    if (pub.provider === "tiktok") {
      const tt = await tiktokConnection(db, pub.project_id);
      if (!tt) return { publication: pub, changed: false, message: t("actions.reconnectTikTok"), error: true };
      const r = await checkTikTok({ t, token: (await getAccess(db, tt, env.admin)).token!, publishId: pub.container_id!, username: tt.account_handle, waitMs });
      if (r.processing) return { ...(await waiting()), message: t("actions.tiktokProcessing") };
      return { publication: await save({ status: "published", platform_post_id: r.postId, platform_url: r.url }), changed: true, message: t("actions.publishedTikTok") };
    }
    const { data: meta } = await db.from("meta_connections").select("id").eq("project_id", pub.project_id).maybeSingle();
    const token = meta ? await metaPageToken(env, meta.id) : null;
    if (!token) return { publication: pub, changed: false, message: t("actions.reconnectMeta"), error: true };
    if (pub.provider === "facebook") {
      const s = await facebookPostStatus({ t, postId: pub.platform_post_id!, pageToken: token });
      if (!s.published) return { ...(await waiting()), message: t("actions.facebookNotYet") };
      return { publication: await save({ status: "published", platform_url: s.url ?? `https://www.facebook.com/${pub.platform_post_id}` }), changed: true, message: t("actions.publishedFacebook") };
    }
    const r = await publishInstagram({ t, igUserId: pub.account_ref, pageToken: token, caption: "", media: { kind: "video", url: "", mime: "video/mp4" }, containerId: pub.container_id!, waitMs });
    if (r.processing) return { ...(await waiting()), message: t("actions.instagramProcessing") };
    const row = await save({ status: "published", platform_post_id: r.postId, platform_url: r.url, temp_media_path: null });
    await cleanup(db, pub.temp_media_path);
    return { publication: row, changed: true, message: t("actions.publishedInstagram") };
  } catch (e) {
    const c = e instanceof MetaApiError ? classifyMetaError(e, t)
      : e instanceof SocialApiError ? { kind: (e.isAuth || e.isPermission ? "auth" : e.kind === "server" || e.kind === "network" || e.kind === "rate_limit" ? "transient" : "permanent") as string, message: describeSocialError(e) }
      : { kind: "transient", message: e instanceof Error ? e.message : t("core.unknownError") };
    // a network hiccup, or Facebook not finding a post it holds, is not a verdict: ask again on the next run
    if (c.kind === "transient" || c.kind === "auth" || pub.provider === "facebook") return { publication: pub, changed: false, message: c.message, error: true };
    const row = await save({ status: "failed", error: c.message.slice(0, 1000), error_kind: c.kind, temp_media_path: null });
    await cleanup(db, pub.temp_media_path);
    return { publication: row, changed: true, message: c.message, error: true };
  }
}

/** The calendar item follows its publications: published as soon as one network has it live. */
export async function syncItemStatus(db: SupabaseClient, projectId: string, itemId: string, pubs: Publication[]) {
  const set = (values: Partial<ContentItem>) => db.from("content_items").update(values).eq("id", itemId).eq("project_id", projectId).then(() => undefined, () => undefined);
  const live = pubs.find((p) => p.status === "published" && p.platform_url);
  if (live) await set({ status: "published", published_at: new Date().toISOString(), published_url: live.platform_url, publish_error: null });
  else if (pubs.some((p) => p.status === "scheduled" || (p.status === "queued" && p.scheduled_for))) await set({ status: "scheduled", publish_error: null });
  else if (pubs.length && pubs.every((p) => p.status === "failed")) await set({ publish_error: pubs.map((p) => `${p.provider}: ${p.error}`).join(" · ").slice(0, 1000) });
}
