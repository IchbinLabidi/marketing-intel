import "server-only";
import { META_GRAPH_HOST, META_GRAPH_VERSION, metaConfig } from "@/server/meta/config";
import { appSecretProof } from "@/server/meta/crypto";
import { MetaApiError } from "@/server/meta/graph";
import type { TFor } from "@/i18n/messages";

type T = TFor<"publishing">;

// Publishing to a Facebook Page and its linked Instagram professional account (official Graph API).
// Facebook: photos and videos are uploaded as bytes (multipart) so private files never need a public link; text posts
// go to /feed. Facebook schedules natively (scheduled_publish_time). Instagram: the Content Publishing API only
// accepts media by URL, which Meta downloads; the caller provides a short-lived signed link. Instagram can't be
// scheduled through the API.

export const PUBLISH_SCOPES = ["pages_manage_posts", "instagram_content_publish"];

export type MediaInput =
  | { kind: "none" }
  | { kind: "image" | "video"; bytes: Blob; filename: string; mime: string }
  | { kind: "image" | "video"; url: string; mime: string };

export type PublishResult = { postId: string; url: string | null; scheduledFor: string | null; containerId?: string; processing?: boolean };

const TIMEOUT_MS = 120_000;

async function graphPost<R>(t: T, path: string, fields: Record<string, string>, token: string, opts: { host?: string; file?: { field: string; blob: Blob; filename: string } } = {}): Promise<R> {
  const url = new URL(`${opts.host ?? META_GRAPH_HOST}/${META_GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  const body = opts.file ? new FormData() : new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  if (opts.file) (body as FormData).append(opts.file.field, opts.file.blob, opts.file.filename);
  body.append("access_token", token);
  const { appSecret } = metaConfig();
  if (appSecret) body.append("appsecret_proof", appSecretProof(token, appSecret));
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new MetaApiError(t("meta.unreachable", { reason: e instanceof Error && e.name === "TimeoutError" ? t("meta.timeout") : t("meta.networkError") }), undefined, undefined, 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const e = json?.error ?? {};
    throw new MetaApiError(e.error_user_msg || e.message || t("meta.apiError", { status: res.status }), e.code, e.error_subcode, res.status);
  }
  return json as R;
}

async function graphGetJson<R>(t: T, path: string, params: Record<string, string>, token: string): Promise<R> {
  const url = new URL(`${META_GRAPH_HOST}/${META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const { appSecret } = metaConfig();
  if (appSecret) url.searchParams.set("appsecret_proof", appSecretProof(token, appSecret));
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new MetaApiError(json?.error?.message || t("meta.apiError", { status: res.status }), json?.error?.code, json?.error?.error_subcode, res.status);
  return json as R;
}

/** Facebook only accepts scheduled times between 10 minutes and 30 days ahead (Pages API). */
export function facebookScheduleError(t: T, at: Date, now = new Date()) {
  const diff = at.getTime() - now.getTime();
  if (diff < 10 * 60_000) return t("meta.fbMinLead");
  if (diff > 30 * 86_400_000) return t("meta.fbMaxLead");
  return null;
}

export async function publishFacebook(opts: { t: T; pageId: string; pageToken: string; message: string; media: MediaInput; scheduleAt: Date | null }): Promise<PublishResult> {
  const { t, pageId, pageToken, message, media, scheduleAt } = opts;
  const schedule: Record<string, string> = scheduleAt ? { published: "false", scheduled_publish_time: String(Math.floor(scheduleAt.getTime() / 1000)) } : {};
  let id: string;
  if (media.kind === "none") {
    id = (await graphPost<{ id: string }>(t, `${pageId}/feed`, { message, ...schedule }, pageToken)).id;
  } else if (media.kind === "image") {
    const r = "bytes" in media
      ? await graphPost<{ id: string; post_id?: string }>(t, `${pageId}/photos`, { caption: message, ...schedule }, pageToken, { file: { field: "source", blob: media.bytes, filename: media.filename } })
      : await graphPost<{ id: string; post_id?: string }>(t, `${pageId}/photos`, { caption: message, url: media.url, ...schedule }, pageToken);
    id = r.post_id ?? r.id;
  } else {
    // Videos go to the graph-video host (official endpoint for uploads)
    const host = "https://graph-video.facebook.com";
    const r = "bytes" in media
      ? await graphPost<{ id: string }>(t, `${pageId}/videos`, { description: message, ...schedule }, pageToken, { host, file: { field: "source", blob: media.bytes, filename: media.filename } })
      : await graphPost<{ id: string }>(t, `${pageId}/videos`, { description: message, file_url: media.url, ...schedule }, pageToken, { host });
    id = r.id;
  }
  return { postId: id, url: scheduleAt ? null : `https://www.facebook.com/${id}`, scheduledFor: scheduleAt ? scheduleAt.toISOString() : null };
}

/** Several photos in one Facebook post: each photo is uploaded unpublished, then attached to one feed post. */
export async function publishFacebookPhotos(opts: { t: T; pageId: string; pageToken: string; message: string; photos: MediaInput[]; scheduleAt: Date | null }): Promise<PublishResult> {
  const { t, pageId, pageToken, message, photos, scheduleAt } = opts;
  const ids: string[] = [];
  for (const p of photos) {
    if (p.kind !== "image") throw new Error(t("meta.fbPhotosOnly"));
    // a scheduled post needs its photos uploaded as temporary (Pages API)
    const fields: Record<string, string> = { published: "false", ...(scheduleAt ? { temporary: "true" } : {}) };
    const r = "bytes" in p
      ? await graphPost<{ id: string }>(t, `${pageId}/photos`, fields, pageToken, { file: { field: "source", blob: p.bytes, filename: p.filename } })
      : await graphPost<{ id: string }>(t, `${pageId}/photos`, { ...fields, url: p.url }, pageToken);
    ids.push(r.id);
  }
  const fields: Record<string, string> = { message, ...(scheduleAt ? { published: "false", scheduled_publish_time: String(Math.floor(scheduleAt.getTime() / 1000)) } : {}) };
  ids.forEach((id, i) => { fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const id = (await graphPost<{ id: string }>(t, `${pageId}/feed`, fields, pageToken)).id;
  return { postId: id, url: scheduleAt ? null : `https://www.facebook.com/${id}`, scheduledFor: scheduleAt ? scheduleAt.toISOString() : null };
}

/** Instagram carousel (2 to 10 photos): one container per photo, a carousel container, then the same publish step. */
export async function publishInstagramCarousel(opts: { t: T; igUserId: string; pageToken: string; caption: string; items: Extract<MediaInput, { url: string }>[]; waitMs?: number }): Promise<PublishResult> {
  const { t, igUserId, pageToken, caption, items } = opts;
  const children: string[] = [];
  for (const m of items) {
    if (m.kind !== "image") throw new Error(t("meta.igCarouselPhotosOnly"));
    children.push((await graphPost<{ id: string }>(t, `${igUserId}/media`, { image_url: m.url, is_carousel_item: "true" }, pageToken)).id);
  }
  const parent = (await graphPost<{ id: string }>(t, `${igUserId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, pageToken)).id;
  // "video" makes the shared step wait for FINISHED, which a carousel container reports like a video does
  return publishInstagram({ t, igUserId, pageToken, caption, media: { kind: "video", url: "", mime: "" }, containerId: parent, waitMs: opts.waitMs });
}

/**
 * Instagram: create a media container from a URL Meta can download, wait until it is processed (videos), publish it.
 * If processing takes longer than `waitMs`, returns { processing: true, containerId } so the caller can resume later.
 */
export async function publishInstagram(opts: { t: T; igUserId: string; pageToken: string; caption: string; media: Extract<MediaInput, { url: string }>; waitMs?: number; containerId?: string }): Promise<PublishResult> {
  const { t, igUserId, pageToken, caption, media } = opts;
  let containerId = opts.containerId;
  if (!containerId) {
    const fields: Record<string, string> = media.kind === "image" ? { image_url: media.url, caption } : { media_type: "REELS", video_url: media.url, caption };
    containerId = (await graphPost<{ id: string }>(t, `${igUserId}/media`, fields, pageToken)).id;
  }
  const deadline = Date.now() + (opts.waitMs ?? 90_000);
  for (;;) {
    const s = await graphGetJson<{ status_code?: string; status?: string }>(t, containerId, { fields: "status_code,status" }, pageToken);
    if (s.status_code === "FINISHED" || (media.kind === "image" && !s.status_code)) break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new MetaApiError(t("meta.igProcessingFailed", { status: s.status || s.status_code }), 100, undefined, 400);
    if (Date.now() >= deadline) return { postId: "", url: null, scheduledFor: null, containerId, processing: true };
    await new Promise((r) => setTimeout(r, 5000));
  }
  const published = await graphPost<{ id: string }>(t, `${igUserId}/media_publish`, { creation_id: containerId }, pageToken);
  const info = await graphGetJson<{ permalink?: string }>(t, published.id, { fields: "permalink" }, pageToken).catch(() => ({ permalink: undefined }));
  return { postId: published.id, url: info.permalink ?? null, scheduledFor: null, containerId };
}

/**
 * Whether a post Facebook was asked to schedule is live now, and its link. Facebook publishes scheduled posts itself
 * and never tells us, so this asks. The id is a feed post, a video (Reels included) or a photo, depending on the media.
 */
export async function facebookPostStatus(opts: { t: T; postId: string; pageToken: string }): Promise<{ published: boolean; url: string | null }> {
  const { t, postId, pageToken } = opts;
  const absolute = (u: string | undefined) => (u ? (u.startsWith("http") ? u : `https://www.facebook.com${u.startsWith("/") ? "" : "/"}${u}`) : null);
  const unknownField = (e: unknown) => e instanceof MetaApiError && e.code === 100;
  try {
    const p = await graphGetJson<{ is_published?: boolean; permalink_url?: string }>(t, postId, { fields: "is_published,permalink_url" }, pageToken);
    return { published: p.is_published === true, url: absolute(p.permalink_url) };
  } catch (e) { if (!unknownField(e)) throw e; }
  try {
    const v = await graphGetJson<{ published?: boolean; permalink_url?: string }>(t, postId, { fields: "published,permalink_url" }, pageToken);
    return { published: v.published === true, url: absolute(v.permalink_url) };
  } catch (e) { if (!unknownField(e)) throw e; }
  // a photo: its feed post says whether it is out
  const ph = await graphGetJson<{ page_story_id?: string }>(t, postId, { fields: "page_story_id" }, pageToken);
  if (!ph.page_story_id) return { published: false, url: null };
  const p = await graphGetJson<{ is_published?: boolean; permalink_url?: string }>(t, ph.page_story_id, { fields: "is_published,permalink_url" }, pageToken);
  return { published: p.is_published === true, url: absolute(p.permalink_url) };
}

/** permanent errors aren't retried automatically; transient ones can be retried with backoff. */
export function classifyMetaError(e: unknown, t: T): { kind: "auth" | "permanent" | "transient" | "validation"; message: string } {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) return { kind: "auth", message: t("meta.tokenExpired") };
    if (e.isPermissionError) return { kind: "auth", message: t("meta.refused", { message: e.message }) };
    if (e.isRateLimit || e.status === 0 || e.status >= 500 || e.code === 1 || e.code === 2) return { kind: "transient", message: t("meta.transient", { message: e.message }) };
    if (e.isInvalidParameter || e.status === 400) return { kind: "validation", message: e.message };
    return { kind: "permanent", message: e.message };
  }
  return { kind: "transient", message: e instanceof Error ? e.message : t("core.unknownError") };
}
