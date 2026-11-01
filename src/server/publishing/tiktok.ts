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
    throw new SocialApiError(code === "scope_not_authorized" ? "TikTok hasn't granted posting (video.publish). Reconnect TikTok and accept posting." : code === "unaudited_client_can_only_post_to_private_accounts" ? "Until TikTok approves Orix Signals, TikTok only accepts posts to a private account. In the TikTok app, turn on Settings and privacy → Privacy → Private account, publish from Orix Signals, then turn it off again." : msg, res.status, "TikTok", kind, code);
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
  let privacy = chooseTikTokPrivacy(info.privacy_level_options ?? []);
  const start = (level: string) => call<{ data: { publish_id: string; upload_url: string } }>("/post/publish/video/init/", token, {
    post_info: { title: caption.slice(0, 2200), privacy_level: level, disable_duet: false, disable_comment: false, disable_stitch: false },
    source_info: { source: "FILE_UPLOAD", video_size: video.size, chunk_size: video.size, total_chunk_count: 1 },
  });
  let init: Awaited<ReturnType<typeof start>>;
  try {
    init = await start(privacy);
  } catch (e) {
    // an app TikTok hasn't audited yet may only post private ("only me") videos: retry once that way
    if (!(e instanceof SocialApiError) || e.code !== "unaudited_client_can_only_post_to_private_accounts" || privacy === "SELF_ONLY") throw e;
    privacy = "SELF_ONLY";
    init = await start(privacy);
  }
  const put = await fetch(init.data.upload_url, {
    method: "PUT", body: video, cache: "no-store", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": video.type || "video/mp4", "Content-Length": String(video.size), "Content-Range": `bytes 0-${video.size - 1}/${video.size}` },
  }).catch(() => null);
  if (!put || !put.ok) throw new SocialApiError(`TikTok refused the video upload (${put?.status ?? "network"}).`, put?.status ?? 0, "TikTok", put && put.status < 500 ? "other" : "server");
  const r = await checkTikTok({ token, publishId: init.data.publish_id, username: opts.username, waitMs: opts.waitMs ?? 60_000 });
  return { ...r, privacy };
}

/** Follows a TikTok publication until it is live or failed (or `waitMs` runs out: processing). */
export async function checkTikTok(opts: { token: string; publishId: string; username?: string | null; waitMs?: number; kind?: "video" | "photo" }): Promise<PublishResult> {
  const deadline = Date.now() + (opts.waitMs ?? 30_000);
  for (;;) {
    const s = await status(opts.token, opts.publishId);
    if (s.status === "PUBLISH_COMPLETE") {
      const id = s.publicaly_available_post_id?.[0];
      const user = opts.username?.replace(/^@/, "");
      return { postId: id ? String(id) : opts.publishId, url: id && user ? `https://www.tiktok.com/@${user}/${opts.kind === "photo" ? "photo" : "video"}/${id}` : null, scheduledFor: null, containerId: opts.publishId };
    }
    if (s.status === "FAILED") throw new SocialApiError(opts.kind === "photo" ? `TikTok could not publish the photos (${s.fail_reason ?? "unknown reason"}).` : `TikTok could not publish the video (${s.fail_reason ?? "unknown reason"}). Check: MP4/MOV, H.264, 3 s to the account's maximum duration.`, 400, "TikTok", "other");
    if (Date.now() >= deadline) return { postId: "", url: null, scheduledFor: null, containerId: opts.publishId, processing: true };
    await new Promise((res) => setTimeout(res, 4000));
  }
}

/**
 * Publishes a photo post: TikTok downloads each photo itself from a link on the app's verified URL prefix (JPEG,
 * up to 35 photos, the first is the cover), then the status is followed like a video's.
 */
export async function publishTikTokPhotos(opts: { token: string; title: string; description: string; photoUrls: string[]; username?: string | null; waitMs?: number }): Promise<PublishResult & { privacy: string }> {
  const { token } = opts;
  const info = await tiktokCreatorInfo(token);
  let privacy = chooseTikTokPrivacy(info.privacy_level_options ?? []);
  const start = (level: string) => call<{ data: { publish_id: string } }>("/post/publish/content/init/", token, {
    media_type: "PHOTO", post_mode: "DIRECT_POST",
    post_info: { title: [...opts.title].slice(0, 90).join(""), description: opts.description.slice(0, 4000), privacy_level: level, disable_comment: false, auto_add_music: true },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: opts.photoUrls.slice(0, 35) },
  });
  let init: Awaited<ReturnType<typeof start>>;
  try {
    init = await start(privacy);
  } catch (e) {
    if (e instanceof SocialApiError && e.code === "url_ownership_unverified") {
      throw new SocialApiError("TikTok hasn't verified the Orix Signals photo link yet. Verify the URL prefix in the TikTok developer portal (ask Claude for the steps).", 400, "TikTok", "other", e.code);
    }
    if (!(e instanceof SocialApiError) || e.code !== "unaudited_client_can_only_post_to_private_accounts" || privacy === "SELF_ONLY") throw e;
    privacy = "SELF_ONLY";
    init = await start(privacy);
  }
  const r = await checkTikTok({ token, publishId: init.data.publish_id, username: opts.username, waitMs: opts.waitMs ?? 60_000, kind: "photo" });
  return { ...r, privacy };
}
