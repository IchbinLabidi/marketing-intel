import "server-only";
import { META_GRAPH_HOST, META_GRAPH_VERSION, metaConfig } from "@/server/meta/config";
import { appSecretProof } from "@/server/meta/crypto";
import { MetaApiError } from "@/server/meta/graph";

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

async function graphPost<T>(path: string, fields: Record<string, string>, token: string, opts: { host?: string; file?: { field: string; blob: Blob; filename: string } } = {}): Promise<T> {
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
    throw new MetaApiError(`Meta API unreachable (${e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network error"})`, undefined, undefined, 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const e = json?.error ?? {};
    throw new MetaApiError(e.error_user_msg || e.message || `Meta API error (${res.status})`, e.code, e.error_subcode, res.status);
  }
  return json as T;
}

async function graphGetJson<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${META_GRAPH_HOST}/${META_GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const { appSecret } = metaConfig();
  if (appSecret) url.searchParams.set("appsecret_proof", appSecretProof(token, appSecret));
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new MetaApiError(json?.error?.message || `Meta API error (${res.status})`, json?.error?.code, json?.error?.error_subcode, res.status);
  return json as T;
}

/** Facebook only accepts scheduled times between 10 minutes and 30 days ahead (Pages API). */
export function facebookScheduleError(at: Date, now = new Date()) {
  const diff = at.getTime() - now.getTime();
  if (diff < 10 * 60_000) return "Facebook needs the scheduled time to be at least 10 minutes from now.";
  if (diff > 30 * 86_400_000) return "Facebook can schedule at most 30 days ahead.";
  return null;
}

export async function publishFacebook(opts: { pageId: string; pageToken: string; message: string; media: MediaInput; scheduleAt: Date | null }): Promise<PublishResult> {
  const { pageId, pageToken, message, media, scheduleAt } = opts;
  const schedule: Record<string, string> = scheduleAt ? { published: "false", scheduled_publish_time: String(Math.floor(scheduleAt.getTime() / 1000)) } : {};
  let id: string;
  if (media.kind === "none") {
    id = (await graphPost<{ id: string }>(`${pageId}/feed`, { message, ...schedule }, pageToken)).id;
  } else if (media.kind === "image") {
    const r = "bytes" in media
      ? await graphPost<{ id: string; post_id?: string }>(`${pageId}/photos`, { caption: message, ...schedule }, pageToken, { file: { field: "source", blob: media.bytes, filename: media.filename } })
      : await graphPost<{ id: string; post_id?: string }>(`${pageId}/photos`, { caption: message, url: media.url, ...schedule }, pageToken);
    id = r.post_id ?? r.id;
  } else {
    // Videos go to the graph-video host (official endpoint for uploads)
    const host = "https://graph-video.facebook.com";
    const r = "bytes" in media
      ? await graphPost<{ id: string }>(`${pageId}/videos`, { description: message, ...schedule }, pageToken, { host, file: { field: "source", blob: media.bytes, filename: media.filename } })
      : await graphPost<{ id: string }>(`${pageId}/videos`, { description: message, file_url: media.url, ...schedule }, pageToken, { host });
    id = r.id;
  }
  return { postId: id, url: scheduleAt ? null : `https://www.facebook.com/${id}`, scheduledFor: scheduleAt ? scheduleAt.toISOString() : null };
}

/**
 * Instagram: create a media container from a URL Meta can download, wait until it is processed (videos), publish it.
 * If processing takes longer than `waitMs`, returns { processing: true, containerId } so the caller can resume later.
 */
export async function publishInstagram(opts: { igUserId: string; pageToken: string; caption: string; media: Extract<MediaInput, { url: string }>; waitMs?: number; containerId?: string }): Promise<PublishResult> {
  const { igUserId, pageToken, caption, media } = opts;
  let containerId = opts.containerId;
  if (!containerId) {
    const fields: Record<string, string> = media.kind === "image" ? { image_url: media.url, caption } : { media_type: "REELS", video_url: media.url, caption };
    containerId = (await graphPost<{ id: string }>(`${igUserId}/media`, fields, pageToken)).id;
  }
  const deadline = Date.now() + (opts.waitMs ?? 90_000);
  for (;;) {
    const s = await graphGetJson<{ status_code?: string; status?: string }>(containerId, { fields: "status_code,status" }, pageToken);
    if (s.status_code === "FINISHED" || (media.kind === "image" && !s.status_code)) break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new MetaApiError(`Instagram could not process the media (${s.status || s.status_code}). Check the format: JPEG image, or MP4/MOV video (H.264, 3–90 s for Reels).`, 100, undefined, 400);
    if (Date.now() >= deadline) return { postId: "", url: null, scheduledFor: null, containerId, processing: true };
    await new Promise((r) => setTimeout(r, 5000));
  }
  const published = await graphPost<{ id: string }>(`${igUserId}/media_publish`, { creation_id: containerId }, pageToken);
  const info = await graphGetJson<{ permalink?: string }>(published.id, { fields: "permalink" }, pageToken).catch(() => ({ permalink: undefined }));
  return { postId: published.id, url: info.permalink ?? null, scheduledFor: null, containerId };
}

/** permanent errors aren't retried automatically; transient ones can be retried with backoff. */
export function classifyMetaError(e: unknown): { kind: "auth" | "permanent" | "transient" | "validation"; message: string } {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) return { kind: "auth", message: "Meta access expired. Reconnect Meta in Content history." };
    if (e.isPermissionError) return { kind: "auth", message: `Meta refused: ${e.message}. Reconnect Meta and accept the publishing permissions (pages_manage_posts, instagram_content_publish).` };
    if (e.isRateLimit || e.status === 0 || e.status >= 500 || e.code === 1 || e.code === 2) return { kind: "transient", message: `Meta is temporarily unavailable or rate-limited: ${e.message}` };
    if (e.isInvalidParameter || e.status === 400) return { kind: "validation", message: e.message };
    return { kind: "permanent", message: e.message };
  }
  return { kind: "transient", message: e instanceof Error ? e.message : "Unknown error" };
}
