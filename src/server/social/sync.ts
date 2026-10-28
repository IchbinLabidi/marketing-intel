import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toHistoricalRow } from "@/lib/social/normalize";
import { getAccess, type SocialConnection } from "@/server/services/social";
import { SocialApiError, type Counter } from "./http";
import { PROVIDERS } from "./providers";

const STALE_AFTER_MS = 3 * 60 * 1000;
const MAX_POSTS_INITIAL = Number(process.env.SOCIAL_SYNC_MAX_POSTS) || 1000;
const MAX_POSTS_INCREMENTAL = 500;
const REFRESH_WINDOW_DAYS = 30; // recent posts' counters keep moving, so each sync re-reads the last 30 days

export class SocialSyncBusyError extends Error {
  constructor() {
    super("A synchronization is already running for this account.");
  }
}

export function describeSocialError(e: unknown) {
  if (e instanceof SocialApiError) {
    if (e.isAuth) return `${e.provider}: access expired or was revoked. Reconnect the account.`;
    if (e.isPermission) return `${e.provider}: permission missing (${e.message}). Reconnect and grant the requested access, or check the app's approved products.`;
    if (e.kind === "rate_limit") return `${e.provider}: rate limit reached. The next sync will continue.`;
    return `${e.provider}: ${e.message}`;
  }
  return e instanceof Error ? e.message : "Unknown error";
}

/**
 * Synchronises one connected account: account figures (followers, totals) as a daily snapshot, then posts newest
 * first. Posts are upserted on (project, source, external id), so running it again never duplicates anything and
 * fields edited in the app are left alone. Works with the signed-in user's client (RLS) or the service-role client
 * of the scheduled job (`admin`).
 */
export async function runSocialSync(db: SupabaseClient, conn: SocialConnection, opts: { trigger: "manual" | "auto" | "scheduled" | "connect"; admin?: boolean }) {
  const provider = PROVIDERS[conn.provider];
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  await db.from("social_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), errors: [{ message: "Interrupted (no progress for 3 minutes)" }] })
    .eq("connection_id", conn.id).eq("status", "running").lt("heartbeat_at", staleBefore);
  const { data: run, error: runError } = await db.from("social_sync_runs")
    .insert({ project_id: conn.project_id, connection_id: conn.id, trigger: opts.trigger, status: "running", heartbeat_at: new Date().toISOString() })
    .select("id").single();
  if (runError) {
    if (runError.code === "23505") throw new SocialSyncBusyError();
    throw runError;
  }
  await db.from("social_connections").update({ last_sync_status: "running" }).eq("id", conn.id);

  const counter: Counter = { calls: 0, onCall: (n) => { if (n % 10 === 0) void db.from("social_sync_runs").update({ heartbeat_at: new Date().toISOString() }).eq("id", run.id); } };
  const stats = { fetched: 0, created: 0, updated: 0, api_calls: 0 };
  const errors: { message: string }[] = [];
  let connectionStatus: SocialConnection["status"] = "connected";
  let postsComplete = false;
  const now = new Date().toISOString();

  try {
    const { data: project } = await db.from("projects").select("timezone").eq("id", conn.project_id).single();
    const tz = (project?.timezone as string) || "UTC";
    const access = await getAccess(db, conn, opts.admin);
    const account = { externalId: conn.external_account_id, name: conn.account_name, handle: conn.account_handle, url: conn.account_url, avatar: conn.avatar_url };

    // Account figures → today's snapshot (audience growth). A provider that doesn't expose followers stores null.
    try {
      const profile = await provider.profile(account, access, counter);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      await db.from("social_account_snapshots").upsert(
        { project_id: conn.project_id, connection_id: conn.id, snapshot_date: today, followers: profile.followers, total_views: profile.totalViews, total_posts: profile.totalPosts, metrics: profile.raw },
        { onConflict: "connection_id,snapshot_date" },
      );
      await db.from("social_connections").update({ followers: profile.followers, followers_updated_at: now }).eq("id", conn.id);
    } catch (e) {
      if (e instanceof SocialApiError && e.isAuth) throw e;
      errors.push({ message: `Account figures: ${describeSocialError(e)}` });
    }

    // Posts: the full history the first time, then the last 30 days plus anything new.
    const since = conn.backfill_done && conn.last_success_at ? new Date(Date.parse(conn.last_success_at) - REFRESH_WINDOW_DAYS * 86_400_000) : null;
    const source = `${conn.provider}_api`;
    for await (const page of provider.posts(account, access, { since, max: conn.backfill_done ? MAX_POSTS_INCREMENTAL : MAX_POSTS_INITIAL, counter })) {
      if (!page.length) continue;
      stats.fetched += page.length;
      const ids = page.map((p) => p.external_id);
      const { data: existing } = await db.from("historical_content_items").select("external_id").eq("project_id", conn.project_id).eq("source", source).in("external_id", ids);
      const known = new Set((existing ?? []).map((r) => r.external_id as string));
      const rows = page.map((p) => toHistoricalRow(p, { projectId: conn.project_id, connectionId: conn.id, tz, now }));
      const { error } = await db.from("historical_content_items").upsert(rows, { onConflict: "project_id,source,external_id" });
      if (error) throw error;
      stats.created += ids.filter((id) => !known.has(id)).length;
      stats.updated += ids.filter((id) => known.has(id)).length;
    }
    postsComplete = true;
  } catch (e) {
    errors.push({ message: describeSocialError(e) });
    if (e instanceof SocialApiError) connectionStatus = e.isAuth ? "needs_attention" : e.isPermission ? "permission_denied" : "connected";
  }

  stats.api_calls = counter.calls;
  const fatal = errors.length > 0 && stats.fetched === 0 && errors.some((x) => !x.message.startsWith("Account figures"));
  const status = errors.length === 0 ? "succeeded" : fatal ? "failed" : "partial";
  const finishedAt = new Date().toISOString();
  await db.from("social_sync_runs").update({ status, stats, errors, finished_at: finishedAt }).eq("id", run.id);
  await db.from("social_connections").update({
    status: connectionStatus,
    last_sync_at: finishedAt,
    last_sync_status: status,
    last_error: errors.length ? errors.map((x) => x.message).join(" · ").slice(0, 1000) : null,
    ...(status !== "failed" ? { last_success_at: finishedAt } : {}),
    // The history counts as imported once every page was read; an interrupted listing starts over next time.
    ...(postsComplete ? { backfill_done: true } : {}),
  }).eq("id", conn.id);
  return { status, stats, errors };
}
