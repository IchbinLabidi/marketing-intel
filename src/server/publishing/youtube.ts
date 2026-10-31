import "server-only";
import { SocialApiError } from "@/server/social/http";
import type { PublishResult } from "./meta";

// YouTube Data API v3, videos.insert with a resumable upload (official). The video is sent as bytes, so no public link
// is ever created. Videos uploaded by an API project that hasn't passed YouTube's audit yet are locked to private by
// YouTube itself, whatever privacy is asked for.
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

/** YouTube titles: 1 to 100 characters, no angle brackets. */
export function youtubeTitle(title: string | null | undefined, caption: string) {
  const base = (title?.trim() || caption.split("\n").find((l) => l.trim())?.trim() || "Video").replace(/[<>]/g, "");
  return base.length > 100 ? `${base.slice(0, 99).trimEnd()}…` : base;
}

function fail(res: Response | null, body: { error?: { message?: string; errors?: { reason?: string }[] } }): never {
  const status = res?.status ?? 0;
  const reason = body.error?.errors?.[0]?.reason;
  const kind: SocialApiError["kind"] = !res ? "network" : status === 401 ? "auth" : status === 403 && reason !== "quotaExceeded" && reason !== "uploadLimitExceeded" ? "permission"
    : status === 429 || reason === "quotaExceeded" || reason === "uploadLimitExceeded" ? "rate_limit" : status >= 500 ? "server" : "other";
  const message = !res ? "YouTube is unreachable. Try again."
    : reason === "youtubeSignupRequired" ? "This Google account has no YouTube channel. Reconnect YouTube and choose the account that owns the channel."
      : reason === "quotaExceeded" || reason === "uploadLimitExceeded" ? "YouTube's daily upload limit is reached. Try again tomorrow."
        : kind === "permission" || kind === "auth" ? "YouTube hasn't granted uploading. Reconnect YouTube on the Integrations page and accept uploading videos."
          : body.error?.message || `YouTube error (${status})`;
  throw new SocialApiError(message, status, "YouTube", kind, reason);
}

/** Uploads one video to the authorized channel. */
export async function publishYouTubeVideo(opts: { token: string; title: string; description: string; video: Blob; privacy?: "public" | "unlisted" | "private" }): Promise<PublishResult & { privacy: string }> {
  const { token, video } = opts;
  const meta = {
    snippet: { title: opts.title, description: opts.description.slice(0, 5000).replace(/[<>]/g, ""), categoryId: "27" }, // 27 = Education
    status: { privacyStatus: opts.privacy ?? "public", selfDeclaredMadeForKids: false },
  };
  const start = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(60_000), body: JSON.stringify(meta),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": video.type || "video/mp4", "X-Upload-Content-Length": String(video.size) },
  }).catch(() => null);
  if (!start?.ok) fail(start, start ? await start.json().catch(() => ({})) : {});
  const location = start.headers.get("location");
  if (!location) throw new SocialApiError("YouTube didn't return an upload address.", start.status, "YouTube", "server");
  const put = await fetch(location, {
    method: "PUT", body: video, cache: "no-store", signal: AbortSignal.timeout(280_000),
    headers: { "Content-Type": video.type || "video/mp4", "Content-Length": String(video.size) },
  }).catch(() => null);
  const body = (put ? await put.json().catch(() => ({})) : {}) as { id?: string; status?: { privacyStatus?: string; uploadStatus?: string } } & Parameters<typeof fail>[1];
  if (!put?.ok || !body.id) fail(put, body);
  return { postId: body.id, url: `https://www.youtube.com/watch?v=${body.id}`, scheduledFor: null, containerId: undefined, privacy: body.status?.privacyStatus ?? meta.status.privacyStatus };
}
