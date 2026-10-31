import "server-only";
import { SocialApiError } from "@/server/social/http";
import type { PublishResult } from "./meta";

// TikTok Content Posting API, Direct Post (official). The video is sent as bytes (FILE_UPLOAD), so no public link is
// ever created. Until TikTok audits the app, posts can only be private ("SELF_ONLY"); the creator's allowed privacy
// levels are read first and the most public one allowed is used, never more than the creator permits.
const API = "https://open.tiktokapis.com/v2";
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024; // files up to 64 MB are uploaded in one chunk (our limit is 50 MB)

type TikTokError = { error?: { code?: string; message?: string; log_id?: string } };

async function call<T>(path: string, token: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new SocialApiError("TikTok is unreachable. Try again.", 0, "TikTok", "network");
  }
  const json = (await res.json().catch(() => ({}))) as T & TikTokError;
  const code = json.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    const msg = json.error?.message || `TikTok error (${res.status})`;
    const kind: SocialApiError["kind"] = res.status === 401 || code === "access_token_invalid" ? "auth" : code === "scope_not_authorized" ? "permission"
      : res.status === 429 || code === "rate_limit_exceeded" || code === "spam_risk_too_many_posts" ? "rate_limit"
        : res.status >= 500 ? "server" : "other";
    throw new SocialApiError(code === "scope_not_authorized" ? "TikTok hasn't granted posting (video.publish). Reconnect TikTok and accept posting." : code === "unaudited_client_can_only_post_to_private_accounts" ? "Until TikTok approves the app, it can only post to a private TikTok account (or as private videos)." : msg, res.status, "TikTok", kind );
  }
  return json;
}

export type CreatorInfo = { privacy_level_options: string[]; max_video_post_duration_sec?: number; creator_username?: string; comment_disabled?: boolean };

export async function tiktokCreatorInfo(token: string): Promise<CreatorInfo> {
  const r = await call<{ data: CreatorInfo }>("/post/publish/creator_info/query/", token, {});
  return r.data;
}

/** The most public level the creator allows (public > followers > friends > only me). */
export function chooseTikTokPrivacy(options: string[]) {
  return ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"].find((p) => options.includes(p)) ?? "SELF_ONLY";
}

async function status(token: string, publishId: string) {
  const r = await call<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>("/post/publish/status/fetch/", token, { publish_id: publishId });
  return r.data;
}

/** Publishes a video, then follows its status for up to `waitMs`; past that the caller resumes with `checkTikTok`. */
export async function publishTikTokVideo(opts: { token: string; caption: string; video: Blob; username?: string | null; waitMs?: number }): Promise<PublishResult & { privacy: string }> {
  const { token, caption, video } = opts;
  if (video.size > MAX_SINGLE_CHUNK) throw new SocialApiError("The video is larger than 64 MB.", 400, "TikTok", "other");
  const info = await tiktokCreatorInfo(token);
  const privacy = chooseTikTokPrivacy(info.privacy_level_options ?? []);
  const init = await call<{ data: { publish_id: string; upload_url: string } }>("/post/publish/video/init/", token, {
    post_info: { title: caption.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: "FILE_UPLOAD", video_size: video.size, chunk_size: video.size, total_chunk_count: 1 },
  });
  const put = await fetch(init.data.upload_url, {
    method: "PUT", body: video, cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": video.type || "video/mp4", "Content-Length": String(video.size), "Content-Range": `bytes 0-${video.size - 1}/${video.size}` },
  }).catch(() => null);
  if (!put || !put.ok) throw new SocialApiError(`TikTok refused the video upload (${put?.status ?? "network"}).`, put?.status ?? 0, "TikTok", put && put.status < 500 ? "other" : "server");
  const r = await checkTikTok({ token, publishId: init.data.publish_id, username: opts.username, waitMs: opts.waitMs ?? 60_000 });
  return { ...r, privacy };
}

/** Follows a TikTok publication until it is live or failed (or `waitMs` runs out: processing). */
export async function checkTikTok(opts: { token: string; publishId: string; username?: string | null; waitMs?: number }): Promise<PublishResult> {
  const deadline = Date.now() + (opts.waitMs ?? 30_000);
  for (;;) {
    const s = await status(opts.token, opts.publishId);
    if (s.status === "PUBLISH_COMPLETE") {
      const id = s.publicaly_available_post_id?.[0];
      const user = opts.username?.replace(/^@/, "");
      return { postId: id ? String(id) : opts.publishId, url: id && user ? `https://www.tiktok.com/@${user}/video/${id}` : null, scheduledFor: null, containerId: opts.publishId };
    }
    if (s.status === "FAILED") throw new SocialApiError(`TikTok could not publish the video (${s.fail_reason ?? "unknown reason"}). Check: MP4/MOV, H.264, 3 s to the account's maximum duration.`, 400, "TikTok", "other");
    if (Date.now() >= deadline) return { postId: "", url: null, scheduledFor: null, containerId: opts.publishId, processing: true };
    await new Promise((res) => setTimeout(res, 4000));
  }
}
