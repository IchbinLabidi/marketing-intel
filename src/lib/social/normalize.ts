// Provider responses → one normalized post shape stored in historical_content_items.
// Pure functions (tested). Rules: a metric the provider didn't return stays null (unavailable), a returned 0 stays 0;
// provider definitions are kept in metrics_raw under their original names.

export type SocialProvider = "youtube" | "linkedin" | "tiktok";

export type NormalizedMetrics = {
  views: number | null; video_views: number | null; impressions: number | null; reach: number | null; clicks: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null; watch_time_minutes: number | null;
  subscriptions: number | null;
};
export type NormalizedPost = {
  external_id: string;
  platform: SocialProvider;
  title: string | null;
  caption: string | null;
  permalink: string | null;
  published_at: string; // ISO timestamp
  format: string;
  media_type: string | null;
  metrics: NormalizedMetrics;
  metrics_raw: Record<string, unknown>;
};

export const EMPTY_METRICS: NormalizedMetrics = {
  views: null, video_views: null, impressions: null, reach: null, clicks: null, likes: null, comments: null, shares: null, saves: null, watch_time_minutes: null, subscriptions: null,
};

/** Number from an API value: "123" → 123, undefined/null/"" → null (unavailable), never NaN. */
export function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ISO 8601 duration (PT1M5S) → seconds. */
export function isoDurationSeconds(d: string | null | undefined) {
  const m = d?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

// ---------------------------------------------------------------------------
// YouTube (Data API v3 videos.list; Analytics API per-video report when authorized)
// ---------------------------------------------------------------------------
export type YouTubeVideo = {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string; favoriteCount?: string };
};
/** Analytics API row for one video: views, estimatedMinutesWatched, likes, comments, shares, subscribersGained (null when not authorized). */
export type YouTubeAnalyticsRow = { views?: number; estimatedMinutesWatched?: number; likes?: number; comments?: number; shares?: number; subscribersGained?: number };

export function normalizeYouTubeVideo(v: YouTubeVideo, analytics?: YouTubeAnalyticsRow | null): NormalizedPost | null {
  const published = v.snippet?.publishedAt;
  if (!v.id || !published) return null;
  const seconds = isoDurationSeconds(v.contentDetails?.duration);
  // YouTube doesn't flag Shorts in the API; vertical videos up to 3 minutes can be Shorts. Only the duration is known,
  // so ≤ 60 s is labelled "YouTube Short (≤60 s)" and longer videos "YouTube video".
  const format = seconds != null && seconds > 0 && seconds <= 60 ? "YouTube Short (≤60 s)" : v.snippet?.liveBroadcastContent === "live" ? "YouTube live" : "YouTube video";
  const views = num(v.statistics?.viewCount);
  return {
    external_id: v.id,
    platform: "youtube",
    title: v.snippet?.title?.trim() || null,
    caption: v.snippet?.description?.trim() || null,
    permalink: `https://www.youtube.com/watch?v=${v.id}`,
    published_at: new Date(published).toISOString(),
    format,
    media_type: "VIDEO",
    metrics: {
      ...EMPTY_METRICS,
      // Public lifetime counters; the Analytics API adds watch time, shares and subscribers gained when authorized.
      views, video_views: views,
      likes: num(v.statistics?.likeCount),
      comments: num(v.statistics?.commentCount),
      shares: analytics ? num(analytics.shares) : null,
      watch_time_minutes: analytics ? num(analytics.estimatedMinutesWatched) : null,
      subscriptions: analytics ? num(analytics.subscribersGained) : null,
    },
    metrics_raw: { statistics: v.statistics ?? {}, duration_seconds: seconds, ...(analytics ? { analytics } : {}) },
  };
}

/** Columns-and-rows report from youtubeAnalytics.reports.query → map by video id. */
export function youtubeAnalyticsByVideo(report: { columnHeaders?: { name: string }[]; rows?: (string | number)[][] } | null | undefined) {
  const out = new Map<string, YouTubeAnalyticsRow>();
  const cols = report?.columnHeaders?.map((c) => c.name) ?? [];
  const vi = cols.indexOf("video");
  if (vi < 0) return out;
  for (const row of report?.rows ?? []) {
    const rec: Record<string, number> = {};
    cols.forEach((c, i) => { if (i !== vi) rec[c] = Number(row[i]); });
    out.set(String(row[vi]), rec as YouTubeAnalyticsRow);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LinkedIn (Posts API + organizationalEntityShareStatistics)
// ---------------------------------------------------------------------------
export type LinkedInPost = {
  id: string; // urn:li:share:… or urn:li:ugcPost:…
  commentary?: string;
  publishedAt?: number; createdAt?: number;
  lifecycleState?: string;
  content?: { media?: { id?: string }; article?: { source?: string; title?: string }; multiImage?: unknown; poll?: unknown };
};
export type LinkedInShareStats = {
  impressionCount?: number; uniqueImpressionsCount?: number; clickCount?: number; likeCount?: number; commentCount?: number; shareCount?: number; engagement?: number;
};

export function linkedInFormat(p: LinkedInPost) {
  const c = p.content;
  if (!c) return "LinkedIn text post";
  if (c.multiImage) return "LinkedIn carousel";
  if (c.poll) return "LinkedIn poll";
  if (c.article) return "LinkedIn article link";
  const media = c.media?.id ?? "";
  if (media.includes(":video:")) return "LinkedIn video";
  if (media.includes(":document:")) return "LinkedIn document";
  if (media.includes(":image:")) return "LinkedIn image post";
  return "LinkedIn post";
}

export function normalizeLinkedInPost(p: LinkedInPost, stats?: LinkedInShareStats | null): NormalizedPost | null {
  const ts = p.publishedAt ?? p.createdAt;
  if (!p.id || !ts || (p.lifecycleState && p.lifecycleState !== "PUBLISHED")) return null;
  const text = p.commentary?.trim() || null;
  return {
    external_id: p.id,
    platform: "linkedin",
    title: text ? text.split("\n")[0].slice(0, 200) : p.content?.article?.title ?? null,
    caption: text,
    permalink: `https://www.linkedin.com/feed/update/${p.id}/`,
    published_at: new Date(ts).toISOString(),
    format: linkedInFormat(p),
    media_type: linkedInFormat(p).replace("LinkedIn ", "").toUpperCase(),
    metrics: {
      ...EMPTY_METRICS,
      // LinkedIn definitions: impressions = times shown; unique impressions = distinct members reached.
      impressions: stats ? num(stats.impressionCount) : null,
      reach: stats ? num(stats.uniqueImpressionsCount) : null,
      clicks: stats ? num(stats.clickCount) : null,
      likes: stats ? num(stats.likeCount) : null,
      comments: stats ? num(stats.commentCount) : null,
      shares: stats ? num(stats.shareCount) : null,
    },
    metrics_raw: stats ? { totalShareStatistics: stats } : {},
  };
}

// ---------------------------------------------------------------------------
// TikTok (Display API video.list)
// ---------------------------------------------------------------------------
export type TikTokVideo = {
  id: string; title?: string; video_description?: string; create_time?: number; share_url?: string; duration?: number;
  view_count?: number; like_count?: number; comment_count?: number; share_count?: number;
};

export function normalizeTikTokVideo(v: TikTokVideo): NormalizedPost | null {
  if (!v.id || !v.create_time) return null;
  const caption = v.video_description?.trim() || null;
  const views = num(v.view_count);
  return {
    external_id: v.id,
    platform: "tiktok",
    title: v.title?.trim() || (caption ? caption.split("\n")[0].slice(0, 200) : null),
    caption,
    permalink: v.share_url ?? null,
    published_at: new Date(v.create_time * 1000).toISOString(),
    format: "TikTok video",
    media_type: "VIDEO",
    metrics: { ...EMPTY_METRICS, views, video_views: views, likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) },
    metrics_raw: { view_count: v.view_count, like_count: v.like_count, comment_count: v.comment_count, share_count: v.share_count, duration: v.duration },
  };
}

// ---------------------------------------------------------------------------
// Storage row
// ---------------------------------------------------------------------------
const SOURCE: Record<SocialProvider, string> = { youtube: "youtube_api", linkedin: "linkedin_api", tiktok: "tiktok_api" };

/**
 * Columns written on every sync. Fields the team edits in the app (pillar, funnel stage, campaign…) are not
 * included, so a re-sync never overwrites them.
 */
export function toHistoricalRow(post: NormalizedPost, ctx: { projectId: string; connectionId: string; tz: string; now: string }) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(post.published_at));
  return {
    project_id: ctx.projectId,
    source: SOURCE[post.platform],
    external_id: post.external_id,
    social_connection_id: ctx.connectionId,
    platform: post.platform,
    platform_raw: post.platform,
    title: post.title,
    caption: post.caption,
    permalink: post.permalink,
    published_at: post.published_at,
    publication_date: date,
    actual_publication_date: date,
    publication_status: "published",
    format: post.format,
    media_type: post.media_type,
    ...post.metrics,
    metrics_raw: post.metrics_raw,
    metrics_updated_at: ctx.now,
  };
}

/** Video/post id inside a URL a team member pasted on a calendar item, for exact matching with synced posts. */
export function externalIdFromUrl(url: string | null | undefined): { provider: SocialProvider; id: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return { provider: "youtube", id: u.pathname.slice(1).split("/")[0] };
    if (host === "youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return { provider: "youtube", id: v };
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
      if (m) return { provider: "youtube", id: m[1] };
    }
    if (host === "linkedin.com") {
      const m = decodeURIComponent(u.pathname).match(/(urn:li:(?:share|ugcPost|activity):\d+)/);
      if (m) return { provider: "linkedin", id: m[1] };
    }
    if (host === "tiktok.com") {
      const m = u.pathname.match(/\/video\/(\d+)/);
      if (m) return { provider: "tiktok", id: m[1] };
    }
  } catch {
    return null;
  }
  return null;
}
