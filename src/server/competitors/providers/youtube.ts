import "server-only";
import { num, ProviderError, type CollectedPost, type DataProvider } from "./types";

// YouTube Data API v3 (official). Public channels and videos with an API key (YOUTUBE_API_KEY, Google Cloud console,
// "YouTube Data API v3" enabled). Quota: 10,000 units/day by default; one collection of 200 videos costs ~10 units
// (channels 1 + playlistItems 1/50 + videos 1/50), a custom-URL lookup costs 100 (search).

const API = "https://www.googleapis.com/youtube/v3";

async function yt<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ProviderError("YouTube API unreachable. Try again later.", "failed", true);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (reason === "quotaExceeded" || res.status === 429) throw new ProviderError("YouTube API daily quota reached. Collection resumes tomorrow.", "failed", true);
    if (res.status === 400 && /API key/i.test(body?.error?.message ?? "")) throw new ProviderError("The YouTube API key is invalid.", "needs_config");
    if (res.status === 403) throw new ProviderError(`YouTube refused the request: ${body?.error?.message ?? reason}. Check that “YouTube Data API v3” is enabled for this key.`, "needs_config");
    throw new ProviderError(`YouTube API: ${body?.error?.message ?? res.status}`);
  }
  return body as T;
}

/** ISO 8601 duration (PT1H2M3S) → seconds */
export function isoDuration(d: string | undefined) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

type Channel = { id: string; snippet?: { title?: string; description?: string; customUrl?: string; thumbnails?: { high?: { url?: string }; default?: { url?: string } } }; statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }; contentDetails?: { relatedPlaylists?: { uploads?: string } } };
type Video = { id: string; snippet?: { title?: string; description?: string; publishedAt?: string; thumbnails?: { high?: { url?: string } }; liveBroadcastContent?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails?: { duration?: string } };

export const youtubeProvider: DataProvider = {
  id: "youtube-data-api",
  label: "YouTube Data API v3",
  platform: "youtube",
  source: "youtube_api",
  availability(creds) {
    return creds.youtubeKey ? { ok: true } : { ok: false, status: "needs_config", reason: "Add YOUTUBE_API_KEY (Google Cloud → APIs & Services → YouTube Data API v3 → Credentials) to .env.local." };
  },
  async collect(channel, { since, max }, creds) {
    const key = creds.youtubeKey!;
    let calls = 0;
    const call = <T,>(p: string, q: Record<string, string>) => { calls++; return yt<T>(p, q, key); };
    const h = channel.external_id ?? channel.handle;
    const part = "snippet,statistics,contentDetails";
    let list: { items?: Channel[] };
    if (/^UC[A-Za-z0-9_-]{22}$/.test(h)) list = await call("channels", { part, id: h });
    else if (h.startsWith("@")) list = await call("channels", { part, forHandle: h });
    else if (h.startsWith("user/")) list = await call("channels", { part, forUsername: h.slice(5) });
    else {
      const s = await call<{ items?: { id?: { channelId?: string } }[] }>("search", { part: "snippet", type: "channel", maxResults: "1", q: h.replace(/^c\//, "") });
      const id = s.items?.[0]?.id?.channelId;
      if (!id) throw new ProviderError("No YouTube channel found for this link.");
      list = await call("channels", { part, id });
    }
    const ch = list.items?.[0];
    if (!ch) throw new ProviderError("No YouTube channel found for this link.");
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    const ids: string[] = [];
    let pageToken = "";
    let truncated = false;
    while (uploads) {
      const page = await call<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]; nextPageToken?: string }>("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
      let old = false;
      for (const it of page.items ?? []) {
        const at = it.contentDetails?.videoPublishedAt;
        if (at && new Date(at) < since) { old = true; break; }
        if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
        if (ids.length >= max) break;
      }
      if (ids.length >= max) { truncated = Boolean(page.nextPageToken); break; }
      if (old || !page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    const posts: CollectedPost[] = [];
    for (let k = 0; k < ids.length; k += 50) {
      const v = await call<{ items?: Video[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(k, k + 50).join(",") });
      for (const it of v.items ?? []) {
        const seconds = isoDuration(it.contentDetails?.duration);
        const s = it.statistics ?? {};
        posts.push({
          external_id: it.id, url: `https://www.youtube.com/watch?v=${it.id}`,
          published_at: it.snippet?.publishedAt ? new Date(it.snippet.publishedAt).toISOString() : null,
          caption: [it.snippet?.title, it.snippet?.description].filter(Boolean).join("\n\n") || null,
          // Shorts are not flagged by the API; ≤ 3 min vertical uploads are the common rule, so this is labelled a duration bucket
          format: seconds != null && seconds <= 180 ? "Short video" : it.snippet?.liveBroadcastContent && it.snippet.liveBroadcastContent !== "none" ? "Live" : "Video",
          media_type: "VIDEO", media_url: null, thumbnail_url: it.snippet?.thumbnails?.high?.url ?? null,
          likes: num(s.likeCount), comments: num(s.commentCount), views: num(s.viewCount), shares: null, saves: null,
          duration_seconds: seconds,
          metrics_raw: Object.fromEntries(Object.entries({ viewCount: num(s.viewCount), likeCount: num(s.likeCount), commentCount: num(s.commentCount) }).filter(([, x]) => x != null)) as Record<string, number>,
        });
      }
    }
    return {
      profile: {
        external_id: ch.id, display_name: ch.snippet?.title ?? null, bio: ch.snippet?.description ?? null,
        followers_count: ch.statistics?.hiddenSubscriberCount ? null : num(ch.statistics?.subscriberCount), media_count: num(ch.statistics?.videoCount),
        profile_image_url: ch.snippet?.thumbnails?.high?.url ?? ch.snippet?.thumbnails?.default?.url ?? null, website: null,
      },
      posts, truncated,
      notes: ["Views, likes and comments from the YouTube Data API (subscriber counts are rounded by YouTube). “Short video” = 3 minutes or less."],
      calls,
    };
  },
};
