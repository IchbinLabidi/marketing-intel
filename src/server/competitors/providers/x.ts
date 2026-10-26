import "server-only";
import { num, ProviderError, type CollectedPost, type DataProvider } from "./types";

// X API v2 (official). Needs a bearer token from a paid X developer plan (Basic or higher): the free plan cannot read
// other accounts' posts. Rate limits are low (Basic: ~10 user-timeline requests / 15 min), so one collection reads
// at most 3 pages of 100 posts and stops early on HTTP 429.

const API = "https://api.x.com/2";

async function xget<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ProviderError("X API unreachable. Try again later.", "failed", true);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw new ProviderError("X API rate limit reached. Collection resumes on the next run.", "failed", true);
  if (res.status === 401) throw new ProviderError("The X bearer token was rejected.", "needs_config");
  if (res.status === 403) throw new ProviderError(`X refused access (${body?.detail ?? body?.title ?? "forbidden"}). Reading other accounts needs a paid X API plan.`, "needs_config");
  if (!res.ok) throw new ProviderError(`X API: ${body?.detail ?? body?.title ?? res.status}`);
  if (body?.errors?.length && !body?.data) throw new ProviderError(`X API: ${body.errors[0]?.detail ?? "not found"}`);
  return body as T;
}

type XUser = { id: string; name?: string; username?: string; description?: string; profile_image_url?: string; url?: string; public_metrics?: { followers_count?: number; tweet_count?: number } };
type XTweet = { id: string; text?: string; created_at?: string; public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; bookmark_count?: number; impression_count?: number }; attachments?: { media_keys?: string[] } };
type XMedia = { media_key: string; type?: string; url?: string; preview_image_url?: string; duration_ms?: number };

export const xProvider: DataProvider = {
  id: "x-api-v2",
  label: "X API v2",
  platform: "x",
  source: "x_api",
  availability(creds) {
    return creds.xBearer ? { ok: true } : { ok: false, status: "needs_config", reason: "Add X_BEARER_TOKEN (X developer portal, paid Basic plan or higher) to .env.local." };
  },
  async collect(channel, { since, max }, creds) {
    const token = creds.xBearer!;
    let calls = 0;
    const call = <T,>(p: string, q: Record<string, string>) => { calls++; return xget<T>(p, q, token); };
    const u = await call<{ data?: XUser }>(`users/by/username/${encodeURIComponent(channel.handle)}`, { "user.fields": "description,profile_image_url,public_metrics,url,name" });
    if (!u.data) throw new ProviderError("No X account found for this handle.");
    const posts: CollectedPost[] = [];
    let next = "";
    let truncated = false;
    let notes: string[] = [];
    for (let page = 0; page < 3; page++) {
      let r: { data?: XTweet[]; includes?: { media?: XMedia[] }; meta?: { next_token?: string } };
      try {
        r = await call(`users/${u.data.id}/tweets`, {
          max_results: "100", exclude: "retweets,replies", start_time: since.toISOString(),
          "tweet.fields": "created_at,public_metrics,attachments", expansions: "attachments.media_keys", "media.fields": "type,url,preview_image_url,duration_ms",
          ...(next ? { pagination_token: next } : {}),
        });
      } catch (e) {
        if (e instanceof ProviderError && e.retryable && posts.length) { notes = ["Stopped early: X rate limit."]; truncated = true; break; }
        throw e;
      }
      const media = new Map((r.includes?.media ?? []).map((m) => [m.media_key, m]));
      for (const t of r.data ?? []) {
        const m = t.attachments?.media_keys?.map((k) => media.get(k)).filter(Boolean) as XMedia[] | undefined;
        const pm = t.public_metrics ?? {};
        const first = m?.[0];
        posts.push({
          external_id: t.id, url: `https://x.com/${u.data.username}/status/${t.id}`, published_at: t.created_at ? new Date(t.created_at).toISOString() : null,
          caption: t.text ?? null,
          format: !first ? "Text post" : first.type === "video" || first.type === "animated_gif" ? "Video" : (m?.length ?? 0) > 1 ? "Carousel" : "Image post",
          media_type: first?.type ?? null, media_url: first?.url ?? null, thumbnail_url: first?.preview_image_url ?? first?.url ?? null,
          likes: num(pm.like_count), comments: num(pm.reply_count), shares: (num(pm.retweet_count) ?? 0) + (num(pm.quote_count) ?? 0),
          views: num(pm.impression_count), saves: num(pm.bookmark_count), duration_seconds: first?.duration_ms ? Math.round(first.duration_ms / 1000) : null,
          metrics_raw: Object.fromEntries(Object.entries(pm).filter(([, v]) => typeof v === "number")) as Record<string, number>,
        });
        if (posts.length >= max) break;
      }
      next = r.meta?.next_token ?? "";
      if (posts.length >= max) { truncated = Boolean(next); break; }
      if (!next) break;
      if (page === 2) truncated = true;
    }
    return {
      profile: {
        external_id: u.data.id, display_name: u.data.name ?? null, bio: u.data.description ?? null,
        followers_count: num(u.data.public_metrics?.followers_count), media_count: num(u.data.public_metrics?.tweet_count),
        profile_image_url: u.data.profile_image_url ?? null, website: u.data.url ?? null,
      },
      posts, truncated, notes: ["Public metrics from X API v2: likes, replies (comments), reposts + quotes (shares), bookmarks, impressions.", ...notes], calls,
    };
  },
};
