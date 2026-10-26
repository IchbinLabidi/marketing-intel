import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  facebookSyncFields,
  INSIGHT_CANDIDATES,
  insertOnlyFields,
  insightSurface,
  instagramSyncFields,
  parseInsights,
  type FacebookPost,
  type InsightValues,
  type InstagramMedia,
} from "@/lib/meta/normalize";
import type { MetaConnection, MetaSupportedMetrics, MetaSyncRun, SyncCounts } from "@/types/domain";
import { graphBatch, graphPaginate, MetaApiError, type GraphCounter } from "./graph";

const FB_FIELDS =
  "id,message,created_time,permalink_url,status_type,attachments{media_type,type},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
const IG_FIELDS = "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count";

const MAX_POSTS = Number(process.env.META_SYNC_MAX_POSTS) || 1000; // per platform per run
const REFRESH_DAYS = 90; // metrics keep moving for recent posts; older ones are refreshed on demand
const REFRESH_ALL_CAP = 600;
const STALE_AFTER_MS = 3 * 60 * 1000; // no heartbeat for this long = the process running the sync is gone

export class SyncBusyError extends Error {
  constructor() {
    super("A synchronization is already running for this project.");
  }
}

type Platform = "facebook" | "instagram";
type Existing = { id: string; external_id: string; platform: Platform; actual_publication_date: string | null; media_product_type: string | null; format: string | null };
type Kind = MetaSyncRun["kind"];

/**
 * Synchronises a project's Meta connection. Works with the signed-in user's Supabase client (RLS applies) or the
 * service-role client used by the scheduled job. Only data the Graph API returns is stored.
 */
export async function runMetaSync(
  db: SupabaseClient,
  conn: MetaConnection,
  pageToken: string,
  { kind, trigger }: { kind: Kind; trigger: MetaSyncRun["trigger"] },
) {
  // A run whose heartbeat stopped (process crashed or was restarted) is closed so it doesn't block new ones.
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  await db
    .from("meta_sync_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), errors: [{ platform: "all", message: "Interrupted (no progress for 3 minutes)" }] })
    .eq("connection_id", conn.id)
    .eq("status", "running")
    .or(`heartbeat_at.lt.${staleBefore},and(heartbeat_at.is.null,started_at.lt.${staleBefore})`);

  // The unique index on running runs makes this the lock: a concurrent start fails here instead of racing.
  const { data: run, error: runError } = await db
    .from("meta_sync_runs")
    .insert({ project_id: conn.project_id, connection_id: conn.id, kind, trigger, status: "running", heartbeat_at: new Date().toISOString() })
    .select("id")
    .single();
  if (runError) {
    if (runError.code === "23505") throw new SyncBusyError();
    throw runError;
  }

  const log = (msg: string) => console.info(`[meta-sync ${run.id.slice(0, 8)}] ${msg}`);
  log(`${kind} sync started (${trigger}) for page ${conn.page_id}${conn.ig_user_id ? ` + instagram ${conn.ig_user_id}` : ""}`);
  const stats: Record<string, SyncCounts | number | boolean | string> = {};
  const beat = async (step: string) => {
    stats.step = step;
    log(step);
    await db.from("meta_sync_runs").update({ heartbeat_at: new Date().toISOString(), stats }).eq("id", run.id);
  };

  try {
    return await syncRun(db, conn, pageToken, kind, run.id, stats, beat, log);
  } catch (e) {
    // Anything not handled per platform still closes the run with its reason, never leaving it "running".
    const message = describeMetaError(e).slice(0, 500);
    log(`failed: ${message}`);
    const finishedAt = new Date().toISOString();
    await db.from("meta_sync_runs").update({ status: "failed", errors: [{ platform: "all", message }], finished_at: finishedAt }).eq("id", run.id);
    await db.from("meta_connections").update({ last_sync_at: finishedAt, last_sync_status: "failed", last_error: message }).eq("id", conn.id);
    throw e;
  }
}

async function syncRun(
  db: SupabaseClient,
  conn: MetaConnection,
  pageToken: string,
  kind: Kind,
  runId: string,
  stats: Record<string, SyncCounts | number | boolean | string>,
  beat: (step: string) => Promise<void>,
  log: (msg: string) => void,
) {
  let lastBeat = Date.now();
  const counter: GraphCounter = {
    calls: 0,
    // keep the heartbeat fresh during long listings / insight batches (fire and forget, at most every 30 s)
    onCall: (calls) => {
      if (Date.now() - lastBeat < 30_000) return;
      lastBeat = Date.now();
      void db.from("meta_sync_runs").update({ heartbeat_at: new Date().toISOString(), stats: { ...stats, api_calls: calls } }).eq("id", runId);
    },
  };
  const errors: MetaSyncRun["errors"] = [];
  // A full refresh re-probes metrics: an earlier rejection may have been specific to the posts it was tested on.
  const supported: MetaSupportedMetrics = kind === "refresh" ? {} : structuredClone(conn.supported_metrics ?? {});
  const backfill: MetaConnection["backfill"] = { ...(conn.backfill ?? {}) };
  let connectionStatus: MetaConnection["status"] = "active";
  let stop = false;

  const existing = await loadExisting(db, conn.project_id);
  const platforms: Platform[] = ["facebook", ...(conn.ig_user_id ? (["instagram"] as const) : [])];
  await beat(`${existing.length} synced posts already stored`);

  for (const platform of platforms) {
    if (stop) break;
    const counts: SyncCounts = { fetched: 0, created: 0, updated: 0, metrics: 0 };
    stats[platform] = counts;
    try {
      const mine = existing.filter((e) => e.platform === platform);
      const latest = mine.map((e) => e.actual_publication_date).filter(Boolean).sort().pop();
      // Until the whole history has been listed once, every run pages further back (MAX_POSTS more each time).
      const backfillDone = backfill[platform] === "done";
      const since = kind === "incremental" && latest && backfillDone ? new Date(Date.parse(latest) - 3 * 86400000) : null;
      const max = since ? MAX_POSTS : mine.length + MAX_POSTS;

      // 1. List posts (newest first)
      await beat(`${platform}: listing posts${since ? ` since ${since.toISOString().slice(0, 10)}` : ""}`);
      const list =
        platform === "facebook"
          ? await graphPaginate<FacebookPost>(`${conn.page_id}/posts`, { fields: FB_FIELDS, limit: 50, since: since ? Math.floor(since.getTime() / 1000) : undefined }, pageToken, { max, counter })
          : await graphPaginate<InstagramMedia>(`${conn.ig_user_id}/media`, { fields: IG_FIELDS, limit: 50 }, pageToken, {
              max,
              counter,
              stop: (m) => Boolean(since && Date.parse(m.timestamp) < since.getTime()),
            });
      counts.fetched = list.items.length;
      if (!since) backfill[platform] = list.truncated ? "pending" : "done";
      if (list.truncated) stats.truncated = true;

      // 2. Existing posts whose metrics should be refreshed even though they weren't in this listing
      const listed = new Set(list.items.map((p) => p.id));
      const cutoff = new Date(Date.now() - REFRESH_DAYS * 86400000).toISOString().slice(0, 10);
      const refreshOnly = mine
        .filter((e) => !listed.has(e.external_id) && (kind === "refresh" || (e.actual_publication_date ?? "") >= cutoff))
        .slice(0, kind === "refresh" ? REFRESH_ALL_CAP : 200);
      const refreshed = refreshOnly.length ? await fetchObjects(platform, refreshOnly.map((e) => e.external_id), pageToken, counter) : [];
      const posts = [...list.items, ...refreshed] as (FacebookPost | InstagramMedia)[];

      // 3. Insights, batched, with metric support learned per surface
      await beat(`${platform}: ${list.items.length} posts listed${list.truncated ? " (limit reached)" : ""}, reading insights of ${posts.length}`);
      const insights = await fetchInsights(platform, posts, pageToken, supported, counter);
      await beat(`${platform}: insights read for ${insights.size} posts, saving`);

      // 4. Persist: insert new posts, update sync-owned fields of known ones (never pillar/campaign/edited title)
      const byExternal = new Set(existing.map((e) => `${e.platform}:${e.external_id}`));
      const now = new Date().toISOString();
      const inserts: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      for (const p of posts) {
        const ins = insights.get(p.id) ?? null;
        if (ins && Object.keys(ins).length) counts.metrics++;
        const fields = platform === "facebook" ? facebookSyncFields(p as FacebookPost, ins) : instagramSyncFields(p as InstagramMedia, ins);
        const row = { ...fields, metrics_updated_at: now, meta_connection_id: conn.id };
        if (byExternal.has(`${platform}:${p.id}`)) {
          // upsert on the natural key updates only the columns sent here
          updates.push({ ...row, project_id: conn.project_id, source: "meta_api", external_id: p.id });
        } else {
          const caption = platform === "facebook" ? (p as FacebookPost).message : (p as InstagramMedia).caption;
          inserts.push({ ...row, ...insertOnlyFields(platform, caption), project_id: conn.project_id, source: "meta_api", external_id: p.id });
        }
      }
      for (let k = 0; k < inserts.length; k += 200) {
        // ignoreDuplicates: a concurrent run that inserted the same post first is not an error
        const { error } = await db.from("historical_content_items").upsert(inserts.slice(k, k + 200), { onConflict: "project_id,source,external_id", ignoreDuplicates: true });
        if (error) throw error;
      }
      for (let k = 0; k < updates.length; k += 200) {
        const { error } = await db.from("historical_content_items").upsert(updates.slice(k, k + 200), { onConflict: "project_id,source,external_id" });
        if (error) throw error;
      }
      counts.created = inserts.length;
      counts.updated = updates.length;
      await beat(`${platform}: ${counts.created} new, ${counts.updated} updated`);
    } catch (e) {
      const err = e instanceof MetaApiError ? e : null;
      errors.push({ platform, code: err?.code, message: describeMetaError(e) });
      log(`${platform} failed: ${describeMetaError(e)}${err ? ` (code ${err.code}${err.subcode ? `/${err.subcode}` : ""})` : ""}`);
      if (err?.isTokenError) {
        connectionStatus = "expired";
        stop = true;
      } else if (err?.isRateLimit) {
        stop = true;
      }
    }
  }

  stats.api_calls = counter.calls;
  delete stats.step;
  const status: MetaSyncRun["status"] = errors.length === 0 ? "succeeded" : errors.length < platforms.length && connectionStatus === "active" ? "partial" : "failed";
  const finishedAt = new Date().toISOString();
  await db.from("meta_sync_runs").update({ status, stats, errors, finished_at: finishedAt }).eq("id", runId);
  log(`finished: ${status}, ${counter.calls} API calls`);
  await db
    .from("meta_connections")
    .update({
      status: connectionStatus,
      supported_metrics: supported,
      backfill,
      last_sync_at: finishedAt,
      last_sync_status: status,
      last_error: errors.length ? errors.map((e) => `${e.platform}: ${e.message}`).join(" · ").slice(0, 1000) : null,
    })
    .eq("id", conn.id);
  return { runId, status, stats, errors };
}

async function loadExisting(db: SupabaseClient, projectId: string): Promise<Existing[]> {
  const out: Existing[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("historical_content_items")
      .select("id, external_id, platform, actual_publication_date, media_product_type, format")
      .eq("project_id", projectId)
      .eq("source", "meta_api")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Existing[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fetchObjects(platform: Platform, ids: string[], token: string, counter: GraphCounter) {
  const fields = platform === "facebook" ? FB_FIELDS : IG_FIELDS;
  const results = await graphBatch<FacebookPost | InstagramMedia>(ids.map((id) => ({ method: "GET", relative_url: `${id}?fields=${encodeURIComponent(fields)}` })), token, counter);
  const out: (FacebookPost | InstagramMedia)[] = [];
  for (const r of results) {
    if (r.ok) out.push(r.body);
    else if (r.error.isTokenError || r.error.isRateLimit) throw r.error; // deleted posts (code 100) are simply skipped
  }
  return out;
}

/** Fetches insights for many posts; when a metric is rejected, probes once and remembers it for the surface. */
export async function fetchInsights(
  platform: Platform,
  posts: (FacebookPost | InstagramMedia)[],
  token: string,
  supported: MetaSupportedMetrics,
  counter: GraphCounter,
) {
  const out = new Map<string, InsightValues>();
  const groups = new Map<string, (FacebookPost | InstagramMedia)[]>();
  for (const p of posts) {
    if (platform === "instagram" && (p as InstagramMedia).media_product_type === "STORY") continue;
    const format = platform === "facebook" ? facebookSyncFields(p as FacebookPost, null).format : null;
    const surface = insightSurface(platform, { media_product_type: (p as InstagramMedia).media_product_type, format: format as string | null });
    groups.set(surface, [...(groups.get(surface) ?? []), p]);
  }

  for (const [surface, group] of groups) {
    const learned = (supported[surface] ??= { ok: [], rejected: [] });
    const metricsFor = () => (INSIGHT_CANDIDATES[surface as keyof typeof INSIGHT_CANDIDATES] as readonly string[]).filter((m) => !learned.rejected.includes(m));
    let pending = group;
    for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
      const metrics = metricsFor();
      if (!metrics.length) break;
      const results = await graphBatch<Parameters<typeof parseInsights>[0]>(
        pending.map((p) => ({ method: "GET", relative_url: `${p.id}/insights?metric=${metrics.join(",")}${platform === "facebook" ? "&period=lifetime" : ""}` })),
        token,
        counter,
      );
      const failed: typeof pending = [];
      results.forEach((r, i) => {
        if (r.ok) {
          out.set(pending[i].id, parseInsights(r.body));
          for (const m of metrics) if (!learned.ok.includes(m)) learned.ok.push(m);
        } else if (r.error.isTokenError || r.error.isRateLimit) throw r.error;
        else if (r.error.isInvalidParameter) failed.push(pending[i]);
        // permission errors (e.g. Page under 100 likes) leave the post without insights rather than failing the run
      });
      if (!failed.length) break;
      // Probe the first failing post metric by metric to find which names this surface rejects.
      const probe = await graphBatch<Parameters<typeof parseInsights>[0]>(
        metrics.map((m) => ({ method: "GET", relative_url: `${failed[0].id}/insights?metric=${m}${platform === "facebook" ? "&period=lifetime" : ""}` })),
        token,
        counter,
      );
      let rejectedAny = false;
      probe.forEach((r, i) => {
        if (!r.ok && r.error.isInvalidParameter) {
          learned.rejected.push(metrics[i]);
          learned.ok = learned.ok.filter((m) => m !== metrics[i]);
          rejectedAny = true;
        }
      });
      if (!rejectedAny) break; // the post itself can't return insights; don't blame the metrics
      pending = failed;
    }
  }
  return out;
}

export function describeMetaError(e: unknown) {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) return "Meta access expired or was revoked. Reconnect Meta.";
    if (e.isRateLimit) return "Meta rate limit reached. The next synchronization will continue.";
    if (e.isPermissionError) return `Missing permission: ${e.message}`;
    return e.message;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Unexpected error";
}
