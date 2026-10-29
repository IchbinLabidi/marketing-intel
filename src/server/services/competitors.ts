import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Platform } from "@/lib/domain/constants";
import { getMetaConnection, readMetaTokens } from "./meta";
import { envCredentials } from "@/server/competitors/providers";
import type { ProviderCredentials } from "@/server/competitors/providers/types";

export type CompetitorChannel = {
  id: string; competitor_id: string; project_id: string; platform: Platform; handle: string | null; url: string | null; enabled: boolean;
  external_id: string | null; display_name: string | null; bio: string | null; followers_count: number | null; media_count: number | null;
  profile_image_url: string | null; website: string | null; status: string; last_error: string | null; last_attempt_at: string | null;
  last_synced_at: string | null; coverage_from: string | null; coverage_to: string | null; posts_collected: number;
};
export type Competitor = {
  id: string; project_id: string; name: string; website: string | null; notes: string | null; description: string | null; industry: string | null;
  target_audience: string | null; monitoring: "manual" | "daily" | "weekly"; history_days: number; max_posts: number;
  last_synced_at: string | null; sync_status: string; created_at: string; competitor_channels: CompetitorChannel[];
};
export type CompetitorPost = {
  id: string; competitor_id: string; channel_id: string | null; project_id: string; source: string; external_id: string | null; platform: Platform | null;
  url: string | null; published_at: string | null; format: string | null; media_type: string | null; media_url: string | null; thumbnail_url: string | null;
  caption: string | null; hook: string | null; title: string | null; hashtags: string[]; mentions: string[]; likes: number | null; comments: number | null;
  shares: number | null; views: number | null; saves: number | null; duration_seconds: number | null; followers_at_collection: number | null;
  metrics_raw: Record<string, number>; metrics_updated_at: string | null; created_at: string;
};
export type CompetitorRun = { id: string; competitor_id: string; trigger: string; status: string; started_at: string; finished_at: string | null; heartbeat_at: string; error: string | null; stats: { calls?: number; outcomes?: { platform: string; status: string; posts: number; message: string | null }[] } };

const CHANNEL_COLS = "id, competitor_id, project_id, platform, handle, url, enabled, external_id, display_name, bio, followers_count, media_count, profile_image_url, website, status, last_error, last_attempt_at, last_synced_at, coverage_from, coverage_to, posts_collected";

export async function listCompetitors(projectId: string): Promise<Competitor[]> {
  const db = await createClient();
  const { data, error } = await db.from("competitors").select(`*, competitor_channels(${CHANNEL_COLS})`).eq("project_id", projectId).order("name");
  if (error) throw error;
  return (data ?? []) as Competitor[];
}

export async function getCompetitor(projectId: string, id: string): Promise<Competitor | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const { data, error } = await db.from("competitors").select(`*, competitor_channels(${CHANNEL_COLS})`).eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Competitor | null;
}

export async function listRuns(projectId: string, competitorId?: string, limit = 10): Promise<CompetitorRun[]> {
  const db = await createClient();
  let q = db.from("competitor_sync_runs").select("id, competitor_id, trigger, status, started_at, finished_at, heartbeat_at, error, stats").eq("project_id", projectId);
  if (competitorId) q = q.eq("competitor_id", competitorId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as CompetitorRun[];
}

export type PostQuery = {
  competitor?: string; platform?: string; format?: string; from?: string; to?: string; search?: string; topic?: string;
  minEngagement?: number; sort?: "recent" | "oldest" | "likes" | "comments" | "views"; page?: number; pageSize?: number;
};

/** Library query: filtered, sorted and paginated in the database (never the whole table in the browser). */
export async function queryPosts(projectId: string, q: PostQuery) {
  const db = await createClient();
  const size = Math.min(60, Math.max(12, q.pageSize ?? 24));
  const page = Math.max(1, q.page ?? 1);
  let s = db.from("competitor_content_items").select("*", { count: "exact" }).eq("project_id", projectId);
  if (q.competitor) s = s.eq("competitor_id", q.competitor);
  if (q.platform) s = s.eq("platform", q.platform);
  if (q.format) s = s.eq("format", q.format);
  if (q.from) s = s.gte("published_at", `${q.from}T00:00:00Z`);
  if (q.to) s = s.lte("published_at", `${q.to}T23:59:59Z`);
  const term = (q.search ?? q.topic ?? "").trim().replace(/[%_,()]/g, " ").slice(0, 100);
  if (term) s = s.ilike("caption", `%${term}%`);
  if (q.minEngagement) s = s.gte("likes", q.minEngagement);
  const order = q.sort ?? "recent";
  s = order === "oldest" ? s.order("published_at", { ascending: true, nullsFirst: false })
    : order === "recent" ? s.order("published_at", { ascending: false, nullsFirst: false })
    : s.order(order, { ascending: false, nullsFirst: false });
  const { data, error, count } = await s.order("id").range((page - 1) * size, page * size - 1);
  if (error) throw error;
  return { posts: (data ?? []) as CompetitorPost[], total: count ?? 0, page, size };
}

/** Posts for analysis (bounded): competitors' posts in the period, newest first. */
export async function postsForAnalysis(projectId: string, competitorIds: string[] | null, sinceDays: number, limit = 3000) {
  const db = await createClient();
  const out: CompetitorPost[] = [];
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  for (let from = 0; from < limit; from += 1000) {
    let q = db.from("competitor_content_items").select("*").eq("project_id", projectId).gte("published_at", since);
    if (competitorIds?.length) q = q.in("competitor_id", competitorIds);
    const { data, error } = await q.order("published_at", { ascending: false }).range(from, Math.min(limit, from + 1000) - 1);
    if (error) throw error;
    out.push(...((data ?? []) as CompetitorPost[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export async function competitorPostsByIds(projectId: string, ids: string[]) {
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  if (!clean.length) return [];
  const db = await createClient();
  const { data, error } = await db.from("competitor_content_items").select("id, competitor_id, platform, url, published_at, format, caption, hook, likes, comments, shares, views, saves, followers_at_collection, thumbnail_url, competitors(name)").eq("project_id", projectId).in("id", clean);
  if (error) throw error;
  return data ?? [];
}

export async function metricHistory(projectId: string, postId: string) {
  const db = await createClient();
  const { data, error } = await db.from("competitor_metric_snapshots").select("collected_at, likes, comments, shares, views, saves").eq("project_id", projectId).eq("content_item_id", postId).order("collected_at").limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function followerHistory(projectId: string, channelIds: string[]) {
  if (!channelIds.length) return [];
  const db = await createClient();
  const { data, error } = await db.from("competitor_metric_snapshots").select("channel_id, collected_at, followers").eq("project_id", projectId).in("channel_id", channelIds).is("content_item_id", null).order("collected_at").limit(500);
  if (error) throw error;
  return data ?? [];
}

/** Credentials for providers, read server-side for the signed-in user (Meta tokens via the role-checked RPC). */
export async function projectCredentials(projectId: string): Promise<ProviderCredentials> {
  const env = envCredentials();
  const conn = await getMetaConnection(projectId).catch(() => null);
  let meta: ProviderCredentials["meta"] = null;
  if (conn?.status === "active") {
    const { page } = await readMetaTokens(conn.id).catch(() => ({ page: null }));
    if (page) meta = { igUserId: conn.ig_user_id, pageToken: page };
  }
  return { meta, ...env };
}

export type CompetitorAd = { id: string; competitor_id: string; library_id: string; url: string; started_on: string; ended_on: string | null; platforms: string[]; body: string; created_at: string };

/** Ads recorded from Meta's Ad Library: running ones first, then newest. Empty while migration 0016 isn't applied. */
export async function listCompetitorAds(projectId: string, competitorId: string): Promise<CompetitorAd[]> {
  const db = await createClient();
  const { data, error } = await db.from("competitor_ads").select("id, competitor_id, library_id, url, started_on, ended_on, platforms, body, created_at")
    .eq("project_id", projectId).eq("competitor_id", competitorId).order("ended_on", { ascending: false, nullsFirst: true }).order("started_on", { ascending: false }).limit(500);
  if (error) return [];
  return data as CompetitorAd[];
}
