import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Platform } from "@/lib/domain/constants";
import { hashtagsOf, mentionsOf } from "@/lib/competitors/urls";
import { captionHook } from "@/lib/meta/normalize";
import { availabilityFor, providerFor } from "./providers";
import { ProviderError, type CollectResult, type ProviderCredentials } from "./providers/types";

export class CompetitorSyncBusyError extends Error {
  constructor() { super("A collection is already running for this competitor."); }
}

type Channel = { id: string; platform: Platform; handle: string | null; url: string | null; external_id: string | null; enabled: boolean };
type Competitor = { id: string; project_id: string; name: string; history_days: number; max_posts: number };
export type ChannelOutcome = { channel_id: string; platform: Platform; status: string; posts: number; message: string | null };

const STALE_MS = 10 * 60_000;

/**
 * Collects every enabled profile of one competitor. Works with the user's client (manual) or the service-role client
 * (scheduled). Posts are upserted on (competitor, source, external id) so a post is never stored twice; every
 * collection appends metric snapshots (profile and posts), so earlier values are kept.
 */
export async function runCompetitorSync(
  db: SupabaseClient,
  competitor: Competitor,
  creds: ProviderCredentials,
  opts: { trigger: "manual" | "scheduled" | "initial"; userId: string | null; channelIds?: string[] },
) {
  // runs abandoned by a crashed process are closed so they don't block forever
  await db.from("competitor_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: "Interrupted" })
    .eq("competitor_id", competitor.id).eq("status", "running").lt("heartbeat_at", new Date(Date.now() - STALE_MS).toISOString());
  const { data: run, error: runErr } = await db.from("competitor_sync_runs")
    .insert({ project_id: competitor.project_id, competitor_id: competitor.id, trigger: opts.trigger, started_by: opts.userId })
    .select("id").single();
  if (runErr) {
    if (runErr.code === "23505") throw new CompetitorSyncBusyError();
    throw runErr;
  }
  await db.from("competitors").update({ sync_status: "synchronizing" }).eq("id", competitor.id);

  const log: { at: string; platform: string; message: string }[] = [];
  const outcomes: ChannelOutcome[] = [];
  const say = (platform: string, message: string) => log.push({ at: new Date().toISOString(), platform, message });
  let calls = 0;
  try {
    let q = db.from("competitor_channels").select("id, platform, handle, url, external_id, enabled").eq("competitor_id", competitor.id).eq("enabled", true);
    if (opts.channelIds?.length) q = q.in("id", opts.channelIds);
    const { data: channels, error } = await q;
    if (error) throw error;
    for (const ch of (channels ?? []) as Channel[]) {
      await db.from("competitor_sync_runs").update({ heartbeat_at: new Date().toISOString(), log }).eq("id", run.id);
      const avail = availabilityFor(ch.platform, creds);
      if (!avail.ok) {
        await db.from("competitor_channels").update({ status: avail.status, last_error: avail.reason, last_attempt_at: new Date().toISOString() }).eq("id", ch.id);
        outcomes.push({ channel_id: ch.id, platform: ch.platform, status: avail.status, posts: 0, message: avail.reason });
        say(ch.platform, avail.reason);
        continue;
      }
      const provider = providerFor(ch.platform)!;
      await db.from("competitor_channels").update({ status: "synchronizing", last_attempt_at: new Date().toISOString() }).eq("id", ch.id);
      const since = new Date(Date.now() - competitor.history_days * 86400_000);
      let result: CollectResult;
      try {
        result = await provider.collect({ handle: ch.handle ?? "", external_id: ch.external_id }, { since, max: competitor.max_posts }, creds);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Collection failed";
        const status = e instanceof ProviderError ? (e.status === "needs_config" ? "needs_config" : "failed") : "failed";
        await db.from("competitor_channels").update({ status, last_error: message }).eq("id", ch.id);
        outcomes.push({ channel_id: ch.id, platform: ch.platform, status, posts: 0, message });
        say(ch.platform, message);
        continue;
      }
      calls += result.calls;
      const stored = await storeResult(db, competitor, ch, provider.source, result);
      const dates = result.posts.map((p) => p.published_at).filter((d): d is string => Boolean(d)).sort();
      const { count } = await db.from("competitor_content_items").select("id", { count: "exact", head: true }).eq("channel_id", ch.id);
      const status = result.truncated || result.posts.some((p) => p.likes == null && p.comments == null) ? "partial" : "synchronized";
      const coverageNote = `${result.posts.length} posts collected${dates.length ? ` (${dates[0].slice(0, 10)} → ${dates.at(-1)!.slice(0, 10)})` : ""}${result.truncated ? `, limited to ${competitor.max_posts}` : ""}`;
      await db.from("competitor_channels").update({
        status, last_error: null, last_synced_at: new Date().toISOString(), posts_collected: count ?? stored,
        external_id: result.profile.external_id ?? ch.external_id, display_name: result.profile.display_name, bio: result.profile.bio,
        followers_count: result.profile.followers_count, media_count: result.profile.media_count,
        profile_image_url: result.profile.profile_image_url, website: result.profile.website,
        // coverage = the window actually covered by this collection: since the start of the window, or the oldest post when truncated
        coverage_from: result.truncated && dates.length ? dates[0] : since.toISOString(), coverage_to: new Date().toISOString(),
      }).eq("id", ch.id);
      outcomes.push({ channel_id: ch.id, platform: ch.platform, status, posts: result.posts.length, message: [coverageNote, ...result.notes].join(" ") });
      say(ch.platform, coverageNote);
    }
    const ok = outcomes.filter((o) => o.status === "synchronized" || o.status === "partial").length;
    const overall = !outcomes.length ? "needs_config" : ok === outcomes.length ? (outcomes.every((o) => o.status === "synchronized") ? "synchronized" : "partial") : ok ? "partial" : outcomes.every((o) => o.status === "needs_config" || o.status === "unsupported") ? "needs_config" : "failed";
    await db.from("competitor_sync_runs").update({
      status: overall === "synchronized" ? "succeeded" : overall === "partial" ? "partial" : "failed",
      finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), log,
      stats: { calls, outcomes }, error: ok ? null : outcomes.map((o) => `${o.platform}: ${o.message}`).join(" · ").slice(0, 2000) || "No profile to collect",
    }).eq("id", run.id);
    await db.from("competitors").update({ sync_status: overall, ...(ok ? { last_synced_at: new Date().toISOString() } : {}) }).eq("id", competitor.id);
    return { status: overall, outcomes };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Collection failed";
    await db.from("competitor_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message, log }).eq("id", run.id);
    await db.from("competitors").update({ sync_status: "failed" }).eq("id", competitor.id);
    throw e;
  }
}

async function storeResult(db: SupabaseClient, competitor: Competitor, ch: Channel, source: string, result: CollectResult) {
  const now = new Date().toISOString();
  await db.from("competitor_metric_snapshots").insert({
    project_id: competitor.project_id, channel_id: ch.id, followers: result.profile.followers_count, media_count: result.profile.media_count, collected_at: now,
  });
  let stored = 0;
  for (let k = 0; k < result.posts.length; k += 100) {
    const rows = result.posts.slice(k, k + 100).map((p) => ({
      project_id: competitor.project_id, competitor_id: competitor.id, channel_id: ch.id, source, external_id: p.external_id,
      platform: ch.platform, url: p.url, published_at: p.published_at, format: p.format, media_type: p.media_type,
      media_url: p.media_url, thumbnail_url: p.thumbnail_url, caption: p.caption, hook: captionHook(p.caption),
      title: captionHook(p.caption, 120), hashtags: hashtagsOf(p.caption), mentions: mentionsOf(p.caption),
      likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, saves: p.saves, duration_seconds: p.duration_seconds,
      metrics_raw: p.metrics_raw, followers_at_collection: result.profile.followers_count, metrics_updated_at: now,
    }));
    const { data, error } = await db.from("competitor_content_items").upsert(rows, { onConflict: "competitor_id,source,external_id" }).select("id, likes, comments, shares, views, saves");
    if (error) throw error;
    stored += data?.length ?? 0;
    const snaps = (data ?? []).map((d) => ({ project_id: competitor.project_id, channel_id: ch.id, content_item_id: d.id, collected_at: now, likes: d.likes, comments: d.comments, shares: d.shares, views: d.views, saves: d.saves }));
    if (snaps.length) {
      const s = await db.from("competitor_metric_snapshots").insert(snaps);
      if (s.error) throw s.error;
    }
  }
  return stored;
}
