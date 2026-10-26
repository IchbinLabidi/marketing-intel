// Pure mapping from Meta Graph API objects to historical_content_items rows. Unit-tested, no I/O.
// Rule: a metric is set only when Meta returned it. Missing stays null; nothing is derived into a raw column.

import type { Metric } from "@/lib/domain/constants";

export type FacebookPost = {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  status_type?: string;
  attachments?: { data?: { media_type?: string; type?: string }[] };
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

export type InstagramMedia = {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD" | string;
  permalink?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
};

export type InsightValues = Record<string, number>;

/** Parses an /insights response (Page post or Instagram media). Handles `values[0].value` and `total_value.value`. */
export function parseInsights(body: { data?: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] }): InsightValues {
  const out: InsightValues = {};
  for (const m of body?.data ?? []) {
    let v: unknown = m.total_value?.value ?? m.values?.[m.values.length - 1]?.value;
    if (v && typeof v === "object") v = Object.values(v as Record<string, number>).reduce((s, x) => s + (Number(x) || 0), 0); // by-type objects
    if (typeof v === "number" && Number.isFinite(v)) out[m.name] = v;
  }
  return out;
}

// API metric name → our column. Facebook "media views" replaced impressions (v25); "viewers" replaced reach.
const IG_MAP: Record<string, Metric> = { views: "views", reach: "reach", likes: "likes", comments: "comments", shares: "shares", saved: "saves", total_interactions: "engagements", impressions: "impressions" };
const FB_MAP: Record<string, Metric> = { post_media_view: "views", post_total_media_view_unique: "reach", post_clicks: "clicks", post_video_views: "video_views" };

/** First line / sentence of a caption, used as the post's title and hook. */
export function captionHook(caption: string | null | undefined, max = 140) {
  const text = (caption ?? "").trim();
  if (!text) return null;
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? text;
  const sentence = firstLine.match(/^(.+?[.!?…])(\s|$)/)?.[1] ?? firstLine;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export function instagramFormat(m: Pick<InstagramMedia, "media_type" | "media_product_type">) {
  if (m.media_product_type === "REELS") return "Reel";
  if (m.media_product_type === "STORY") return "Story";
  if (m.media_type === "CAROUSEL_ALBUM") return "Carousel";
  if (m.media_type === "VIDEO") return "Video";
  if (m.media_type === "IMAGE") return "Image post";
  return null;
}

export function facebookFormat(p: Pick<FacebookPost, "attachments" | "status_type">) {
  const a = p.attachments?.data?.[0];
  const t = `${a?.media_type ?? ""} ${a?.type ?? ""} ${p.status_type ?? ""}`.toLowerCase();
  if (/reel/.test(t)) return "Reel";
  if (/album|multi/.test(t)) return "Carousel";
  if (/video/.test(t)) return "Video";
  if (/photo|image/.test(t)) return "Image post";
  if (/link|share/.test(t)) return "Link post";
  if (/event/.test(t)) return "Event";
  return "Text post";
}

const day = (iso: string) => iso.slice(0, 10);

type Row = Partial<Record<Metric, number | null>> & Record<string, unknown>;

function applyMetrics(row: Row, raw: InsightValues, map: Record<string, Metric>) {
  for (const [api, value] of Object.entries(raw)) {
    const col = map[api];
    if (col) row[col] = Math.round(value);
  }
}

/** Fields owned by the sync (refreshed on every run). Editorial fields (pillar, campaign, title edits) are not touched. */
export function facebookSyncFields(p: FacebookPost, insights: InsightValues | null) {
  const raw: InsightValues = { ...(insights ?? {}) };
  if (p.reactions?.summary?.total_count != null) raw.reactions = p.reactions.summary.total_count;
  if (p.comments?.summary?.total_count != null) raw.comments = p.comments.summary.total_count;
  // The API omits `shares` when a post has none; we still leave it empty rather than infer a 0.
  if (p.shares?.count != null) raw.shares = p.shares.count;
  const row: Row = {
    caption: p.message ?? null,
    permalink: p.permalink_url ?? null,
    media_type: p.attachments?.data?.[0]?.media_type ?? p.status_type ?? null,
    format: facebookFormat(p),
    published_at: new Date(p.created_time).toISOString(),
    actual_publication_date: day(p.created_time),
    publication_date: day(p.created_time),
    metrics_raw: raw,
    likes: raw.reactions ?? null,
    comments: raw.comments ?? null,
    shares: raw.shares ?? null,
  };
  applyMetrics(row, insights ?? {}, FB_MAP);
  return row;
}

export function instagramSyncFields(m: InstagramMedia, insights: InsightValues | null) {
  const raw: InsightValues = { ...(insights ?? {}) };
  if (m.like_count != null && raw.likes == null) raw.likes = m.like_count;
  if (m.comments_count != null && raw.comments == null) raw.comments = m.comments_count;
  const row: Row = {
    caption: m.caption ?? null,
    permalink: m.permalink ?? null,
    media_type: m.media_type ?? null,
    media_product_type: m.media_product_type ?? null,
    format: instagramFormat(m),
    published_at: new Date(m.timestamp).toISOString(),
    actual_publication_date: day(m.timestamp),
    publication_date: day(m.timestamp),
    metrics_raw: raw,
  };
  applyMetrics(row, raw, IG_MAP);
  return row;
}

/** Fields set only when a post is first seen. */
export function insertOnlyFields(platform: "facebook" | "instagram", caption: string | null | undefined) {
  return {
    platform,
    platform_raw: platform === "facebook" ? "Facebook (Meta API)" : "Instagram (Meta API)",
    title: captionHook(caption) ?? "(post without caption)",
    publication_status: "Published", // the API only returns published posts
  };
}

/** Insight metrics we ask for, per surface. Unsupported ones are learned and skipped on later runs. */
export const INSIGHT_CANDIDATES = {
  facebook: ["post_media_view", "post_total_media_view_unique", "post_clicks"],
  facebook_video: ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_video_views"],
  instagram_FEED: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"],
  instagram_REELS: ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"],
} as const;

export function insightSurface(platform: "facebook" | "instagram", media: { media_product_type?: string; format?: string | null }) {
  if (platform === "facebook") return media.format === "Video" || media.format === "Reel" ? "facebook_video" : "facebook";
  return media.media_product_type === "REELS" ? "instagram_REELS" : "instagram_FEED";
}
