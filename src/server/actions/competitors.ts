"use server";

import { revalidatePath } from "next/cache";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { engagementOfPost, summarize, type AnalysisPost } from "@/lib/competitors/analysis";
import { hashtagsOf, mentionsOf, normalizeWebsite, parseProfileUrl } from "@/lib/competitors/urls";
import { pageIdFromInput } from "@/lib/competitors/bulk";
import { AD_PLATFORMS, adUrl, adsDigest, libraryIdFrom } from "@/lib/competitors/ads";
import { normalizeText, stripRefs } from "@/lib/history/text";
import { captionHook } from "@/lib/meta/normalize";
import { classify, computeScore, isDuplicate, normalizeWeights } from "@/lib/opportunities/scoring";
import type { Signal } from "@/lib/opportunities/signals";
import { competitorSchema, ideaEditSchema, manualPostSchema, type CompetitorInput } from "@/lib/validation/competitors";
import { type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
import { createClient } from "@/lib/supabase/server";
import { describeAIError } from "@/server/ai/client";
import {
  buildCompetitorPrompt, buildGapPrompt, COMPETITOR_SYSTEM_PROMPT, competitorAnalysisSchema, gapAnalysisSchema, platformLabel, summaryDigest,
  type GapAnalysis,
} from "@/server/ai/competitors";
import { buildProjectContext } from "@/server/ai/context";
import { runStructuredWithMeta } from "@/server/ai/run";
import { startCompetitorSync } from "@/server/competitors/start";
import { getCompetitor, listCompetitorAds, listCompetitors, metricHistory, postsForAnalysis, type CompetitorPost } from "@/server/services/competitors";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { saveAnalysisReport } from "@/server/services/history";
import { insertOpportunities, listOpportunities } from "@/server/services/opportunities";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";

type T = TFor<"competitors">;
const noEdit = (t: T): ActionResult<never> => ({ ok: false, error: t("errors.readOnly") });
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");
const fail = (e: unknown, fallback: string, t: T): ActionResult<never> => {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : fallback;
  return { ok: false, error: /schema cache|does not exist|column .* of relation/.test(m) ? t("errors.migration") : m };
};

async function guard(projectId: string) {
  const user = await requireUser();
  const [{ project, role }, t] = await Promise.all([getProjectContext(projectId), getT("competitors")]);
  return { user, project, allowed: canEdit(role), t };
}

// --- Competitors and profiles --------------------------------------------------------------------------------

/** Creates or updates a competitor and adds the given profile links (existing profiles are kept). */
export async function saveCompetitorAction(projectId: string, id: string | null, input: CompetitorInput): Promise<ActionResult<{ id: string; started: boolean }>> {
  const { user, allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  const parsed = competitorSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { profiles, website, ...fields } = parsed.data;
  const parsedProfiles = profiles.filter(Boolean).map((url) => ({ url, r: parseProfileUrl(url, t) }));
  const bad = parsedProfiles.find((p) => !p.r.ok);
  if (bad && !bad.r.ok) return { ok: false, error: `${bad.url}: ${bad.r.error}`, fieldErrors: { profiles: bad.r.error } };
  const unique = new Map(parsedProfiles.map((p) => p.r.ok && [`${p.r.profile.platform}:${p.r.profile.handle}`, p.r.profile]).filter(Boolean) as [string, { platform: Platform; handle: string; url: string }][]);
  if (website && !normalizeWebsite(website)) return { ok: false, error: t("errors.invalidWebsite"), fieldErrors: { website: t("errors.invalidLink") } };
  try {
    const db = await createClient();
    // a profile already tracked in this project (by any competitor) is refused, so posts are never collected twice
    if (unique.size) {
      const { data: taken } = await db.from("competitor_channels").select("platform, handle, competitor_id, competitors(name)").eq("project_id", projectId);
      for (const p of unique.values()) {
        const taken_ = (taken ?? []).find((x) => x.platform === p.platform && (x.handle ?? "").toLowerCase() === p.handle);
        if (taken_ && taken_.competitor_id !== id) return { ok: false, error: t("errors.alreadyTrackedFor", { url: p.url, name: (taken_.competitors as unknown as { name: string } | null)?.name ?? t("errors.anotherCompetitor") }) };
      }
    }
    const values = { ...fields, website: normalizeWebsite(website), project_id: projectId };
    let competitorId = id;
    if (id) {
      const { error } = await db.from("competitors").update(values).eq("project_id", projectId).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await db.from("competitors").insert(values).select("id").single();
      if (error) {
        if (error.code === "23505") return { ok: false, error: t("errors.duplicateName", { name: fields.name }) };
        throw error;
      }
      competitorId = data.id;
    }
    const existing = id ? (await db.from("competitor_channels").select("platform, handle").eq("competitor_id", id)).data ?? [] : [];
    const toAdd = [...unique.values()].filter((p) => !existing.some((e) => e.platform === p.platform && (e.handle ?? "").toLowerCase() === p.handle));
    if (toAdd.length) {
      const { error } = await db.from("competitor_channels").insert(toAdd.map((p) => ({ competitor_id: competitorId, project_id: projectId, platform: p.platform, handle: p.handle, url: p.url })));
      if (error) {
        if (error.code === "23505") return { ok: false, error: t("errors.profileTracked") };
        throw error;
      }
    }
    // first collection starts right away for a new competitor or new profiles
    let started = false;
    if (toAdd.length) {
      const c = await getCompetitor(projectId, competitorId!);
      if (c) started = (await startCompetitorSync(projectId, c, id ? "manual" : "initial", user.id)).ok;
    }
    refresh(projectId);
    return { ok: true, data: { id: competitorId!, started }, message: started ? t("messages.savedCollecting") : t("messages.saved") };
  } catch (e) {
    return fail(e, t("errors.save"), t);
  }
}

export async function deleteCompetitorAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const db = await createClient();
    const { error, count } = await db.from("competitors").delete({ count: "exact" }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    if (!count) return { ok: false, error: t("errors.notFound") };
    refresh(projectId);
    return { ok: true, message: t("messages.deleted") };
  } catch (e) {
    return fail(e, t("errors.delete"), t);
  }
}

export async function removeProfileAction(projectId: string, channelId: string): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const db = await createClient();
    const { error, count } = await db.from("competitor_channels").delete({ count: "exact" }).eq("project_id", projectId).eq("id", channelId);
    if (error) throw error;
    if (!count) return { ok: false, error: t("errors.profileNotFound") };
    refresh(projectId);
    return { ok: true, message: t("messages.profileRemoved") };
  } catch (e) {
    return fail(e, t("errors.removeProfile"), t);
  }
}

export async function toggleProfileAction(projectId: string, channelId: string, enabled: boolean): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const db = await createClient();
    const { error } = await db.from("competitor_channels").update({ enabled }).eq("project_id", projectId).eq("id", channelId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: enabled ? t("messages.profileMonitored") : t("messages.profilePaused") };
  } catch (e) {
    return fail(e, t("errors.update"), t);
  }
}

export async function collectCompetitorAction(projectId: string, id: string): Promise<ActionResult> {
  const { user, allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const c = await getCompetitor(projectId, id);
    if (!c) return { ok: false, error: t("errors.notFound") };
    if (!c.competitor_channels.some((ch) => ch.enabled)) return { ok: false, error: t("errors.noProfile") };
    const r = await startCompetitorSync(projectId, c, "manual", user.id);
    if (!r.ok) return { ok: false, error: t("errors.busy") };
    refresh(projectId);
    return { ok: true, message: t("messages.collectionStarted") };
  } catch (e) {
    return fail(e, t("errors.collect"), t);
  }
}

/** Platforms without a data provider: a person records a post with its original link and the public numbers shown. */
export async function addManualPostAction(projectId: string, input: unknown): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  const parsed = manualPostSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const p = parsed.data;
  try {
    const db = await createClient();
    const { data: ch } = await db.from("competitor_channels").select("id, competitor_id, platform, followers_count").eq("project_id", projectId).eq("id", p.channel_id).maybeSingle();
    if (!ch) return { ok: false, error: t("errors.profileNotFound") };
    const { error } = await db.from("competitor_content_items").upsert({
      project_id: projectId, competitor_id: ch.competitor_id, channel_id: ch.id, source: "manual", external_id: p.url.replace(/[?#].*$/, ""),
      platform: ch.platform, url: p.url, published_at: new Date(p.published_at).toISOString(), caption: p.caption, hook: captionHook(p.caption),
      title: captionHook(p.caption, 120), format: p.format, hashtags: hashtagsOf(p.caption), mentions: mentionsOf(p.caption),
      likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, followers_at_collection: ch.followers_count, metrics_updated_at: new Date().toISOString(),
    }, { onConflict: "competitor_id,source,external_id" });
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: t("messages.postAdded") };
  } catch (e) {
    return fail(e, t("errors.addPost"), t);
  }
}

/**
 * Several manual posts at once for one profile (pasted lines, see lib/competitors/bulk). Each row is validated with
 * the same rules as a single post; valid rows are saved, invalid ones are reported back with their line number.
 * Re-importing the same link updates that post instead of duplicating it.
 */
export async function addManualPostsAction(projectId: string, channelId: string, rows: unknown[]): Promise<ActionResult<{ saved: number; errors: { line: number; error: string }[] }>> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: t("errors.nothingToImport") };
  if (rows.length > 200) return { ok: false, error: t("errors.tooManyPosts", { max: 200 }) };
  try {
    const db = await createClient();
    const { data: ch } = await db.from("competitor_channels").select("id, competitor_id, platform, followers_count").eq("project_id", projectId).eq("id", channelId).maybeSingle();
    if (!ch) return { ok: false, error: t("errors.profileNotFound") };
    const errors: { line: number; error: string }[] = [];
    const now = new Date().toISOString();
    const byId = new Map<string, Record<string, unknown>>();
    for (const [i, raw] of rows.entries()) {
      const line = typeof (raw as { line?: unknown })?.line === "number" ? (raw as { line: number }).line : i + 1;
      const parsed = manualPostSchema.safeParse({ ...(raw as object), channel_id: channelId });
      if (!parsed.success) {
        // the schema's messages are validation keys: resolved in the request's language like a form error
        const r = await zodErrorToResult(parsed.error);
        errors.push({ line, error: (!r.ok && Object.values(r.fieldErrors ?? {})[0]) || t("errors.invalidRow") });
        continue;
      }
      const p = parsed.data;
      const externalId = p.url.replace(/[?#].*$/, "");
      byId.set(externalId, {
        project_id: projectId, competitor_id: ch.competitor_id, channel_id: ch.id, source: "manual", external_id: externalId,
        platform: ch.platform, url: p.url, published_at: new Date(p.published_at).toISOString(), caption: p.caption, hook: captionHook(p.caption),
        title: captionHook(p.caption, 120), format: p.format, hashtags: hashtagsOf(p.caption), mentions: mentionsOf(p.caption),
        likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, followers_at_collection: ch.followers_count, metrics_updated_at: now,
      });
    }
    if (byId.size) {
      const { error } = await db.from("competitor_content_items").upsert([...byId.values()], { onConflict: "competitor_id,source,external_id" });
      if (error) throw error;
      refresh(projectId);
    }
    return { ok: true, data: { saved: byId.size, errors }, message: errors.length ? t("messages.postsSavedSkipped", { saved: t("messages.posts", { count: byId.size }), skipped: t("messages.lines", { count: errors.length }) }) : t("messages.postsSaved", { saved: t("messages.posts", { count: byId.size }) }) };
  } catch (e) {
    return fail(e, t("errors.importPosts"), t);
  }
}

/** Saves the numeric Page id of a competitor's Facebook profile (from a pasted Ad Library link), for the Ad Library button. */
export async function setFacebookPageIdAction(projectId: string, channelId: string, input: string): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  const pageId = pageIdFromInput(input);
  if (!pageId) return { ok: false, error: t("errors.pageId") };
  try {
    const db = await createClient();
    const { data: ch } = await db.from("competitor_channels").select("id, platform").eq("project_id", projectId).eq("id", channelId).maybeSingle();
    if (!ch || ch.platform !== "facebook") return { ok: false, error: t("errors.facebookNotFound") };
    const { error } = await db.from("competitor_channels").update({ external_id: pageId }).eq("id", channelId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: t("messages.pageLinked") };
  } catch (e) {
    return fail(e, t("errors.linkPage"), t);
  }
}

// --- Ads recorded from Meta's Ad Library ------------------------------------------------------------------

type AdInput = { library_id?: unknown; started_on?: unknown; ended_on?: unknown; platforms?: unknown; body?: unknown; line?: unknown };
const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Saves ads a person copied from Meta's public Ad Library for one competitor. Each line is checked again here;
 * saving the same Library ID again updates that ad (e.g. to record its end date) instead of duplicating it.
 */
export async function saveCompetitorAdsAction(projectId: string, competitorId: string, rows: AdInput[]): Promise<ActionResult<{ saved: number; errors: { line: number; error: string }[] }>> {
  const { user, allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: t("errors.nothingToSave") };
  if (rows.length > 200) return { ok: false, error: t("errors.tooManyAds", { max: 200 }) };
  try {
    const db = await createClient();
    const { data: comp } = await db.from("competitors").select("id").eq("project_id", projectId).eq("id", competitorId).maybeSingle();
    if (!comp) return { ok: false, error: t("errors.notFound") };
    const today = new Date().toISOString().slice(0, 10);
    const errors: { line: number; error: string }[] = [];
    const byId = new Map<string, Record<string, unknown>>();
    rows.forEach((r, i) => {
      const line = typeof r.line === "number" ? r.line : i + 1;
      const id = typeof r.library_id === "string" ? libraryIdFrom(r.library_id) : null;
      const started = isoDate(r.started_on) ? (r.started_on as string) : null;
      const ended = r.ended_on == null || r.ended_on === "" ? null : isoDate(r.ended_on) ? (r.ended_on as string) : "bad";
      const platforms = Array.isArray(r.platforms) ? r.platforms.filter((p): p is string => typeof p === "string" && (AD_PLATFORMS as readonly string[]).includes(p)) : [];
      const body = typeof r.body === "string" ? r.body.slice(0, 5000) : "";
      if (!id) return errors.push({ line, error: t("errors.missingLibraryId") });
      if (!started || started > today) return errors.push({ line, error: t("errors.invalidStart") });
      if (ended === "bad" || (ended && ended < started)) return errors.push({ line, error: t("errors.invalidEnd") });
      byId.set(id, { project_id: projectId, competitor_id: competitorId, library_id: id, url: adUrl(id), started_on: started, ended_on: ended, platforms, body, created_by: user.id });
    });
    if (byId.size) {
      const { error } = await db.from("competitor_ads").upsert([...byId.values()], { onConflict: "competitor_id,library_id" });
      if (error) throw error;
      refresh(projectId);
    }
    return { ok: true, data: { saved: byId.size, errors }, message: errors.length ? t("messages.postsSavedSkipped", { saved: t("messages.ads", { count: byId.size }), skipped: t("messages.lines", { count: errors.length }) }) : t("messages.postsSaved", { saved: t("messages.ads", { count: byId.size }) }) };
  } catch (e) {
    return fail(e, t("errors.saveAds"), t);
  }
}

/** Marks an ad as no longer running (today), or as running again. */
export async function setCompetitorAdEndedAction(projectId: string, adId: string, ended: boolean): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const db = await createClient();
    const { error } = await db.from("competitor_ads").update({ ended_on: ended ? new Date().toISOString().slice(0, 10) : null }).eq("project_id", projectId).eq("id", adId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: ended ? t("messages.adEnded") : t("messages.adActive") };
  } catch (e) {
    return fail(e, t("errors.updateAd"), t);
  }
}

export async function deleteCompetitorAdAction(projectId: string, adId: string): Promise<ActionResult> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const db = await createClient();
    const { error } = await db.from("competitor_ads").delete().eq("project_id", projectId).eq("id", adId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: t("messages.adRemoved") };
  } catch (e) {
    return fail(e, t("errors.removeAd"), t);
  }
}

export async function postHistoryAction(projectId: string, postId: string) {
  await requireUser();
  await getProjectContext(projectId);
  return metricHistory(projectId, postId);
}

// --- Shared digests ------------------------------------------------------------------------------------------

const toAnalysis = (p: CompetitorPost): AnalysisPost => ({
  id: p.id, account: p.channel_id ?? p.competitor_id, platform: p.platform, published_at: p.published_at, format: p.format, caption: p.caption,
  hashtags: p.hashtags, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, views: p.views, followers: p.followers_at_collection,
  url: p.url, thumbnail_url: p.thumbnail_url,
});

/** Notable posts as C-refs: best by lift, then most recent, capped (hook only, never full captions). */
function postRefs(posts: CompetitorPost[], names: Map<string, string>, max = 120) {
  const s = summarize(posts.map(toAnalysis), { tz: "UTC", periodDays: 3650, minGroup: 1 });
  const liftById = new Map(s.best.map((b) => [b.id, b.lift]));
  // lift for every post (best[] holds the top 10 only)
  const byAccount = new Map<string, number[]>();
  for (const p of posts) { const e = engagementOfPost(p); if (e != null) byAccount.set(p.channel_id ?? "", [...(byAccount.get(p.channel_id ?? "") ?? []), e]); }
  const med = new Map([...byAccount].map(([k, v]) => { const x = [...v].sort((a, b) => a - b); return [k, x.length >= 5 ? x[Math.floor(x.length / 2)] : null]; }));
  const lift = (p: CompetitorPost) => { const e = engagementOfPost(p); const m = med.get(p.channel_id ?? ""); return e != null && m ? Math.round((e / m) * 100) / 100 : liftById.get(p.id) ?? null; };
  const ordered = [...posts].sort((a, b) => (lift(b) ?? 0) - (lift(a) ?? 0));
  const pick = [...ordered.slice(0, Math.floor(max * 0.6)), ...[...posts].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))].filter((p, k, all) => all.findIndex((x) => x.id === p.id) === k).slice(0, max);
  const refs = new Map<string, CompetitorPost & { lift: number | null }>();
  const lines = pick.map((p, k) => {
    const ref = `C${k + 1}`;
    refs.set(ref, { ...p, lift: lift(p) });
    const m = [p.likes != null && `likes=${p.likes}`, p.comments != null && `comments=${p.comments}`, p.shares != null && `shares=${p.shares}`, p.views != null && `views=${p.views}`].filter(Boolean).join(" ");
    return [ref, names.get(p.competitor_id) ?? "?", platformLabel(p.platform), p.published_at?.slice(0, 10) ?? "?", p.format ?? "?", (p.hook ?? captionHook(p.caption) ?? "").replace(/\s+/g, " ").slice(0, 160), m || "no public metrics", `lift ×${lift(p) ?? "?"}`].join(" | ");
  });
  return { text: lines.join("\n"), refs };
}

const cleanRefs = (refs: string[], valid: Map<string, unknown>) => [...new Set(refs)].filter((r) => valid.has(r));

// --- AI: one competitor ---------------------------------------------------------------------------------------

export async function analyzeCompetitorAction(projectId: string, id: string): Promise<ActionResult<{ reportId: string }>> {
  const { user, project, allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  try {
    const c = await getCompetitor(projectId, id);
    if (!c) return { ok: false, error: t("errors.notFound") };
    const posts = await postsForAnalysis(projectId, [id], Math.max(30, c.history_days));
    if (posts.length < 5) return { ok: false, error: t("errors.needFivePosts") };
    const { bundle, brand, channels } = await loadHistoryAnalysis(projectId);
    const stats = summarize(posts.map(toAnalysis), { tz: project.timezone || "Africa/Tunis", periodDays: c.history_days, ignore: [c.name, ...c.competitor_channels.flatMap((ch) => [ch.display_name ?? "", ch.handle ?? ""])] });
    const digest = postRefs(posts, new Map([[c.id, c.name]]));
    const { data: out, model } = await runStructuredWithMeta({
      feature: "competitors.analyze", workspaceId: project.workspace_id, projectId, userId: user.id, system: COMPETITOR_SYSTEM_PROMPT, schema: competitorAnalysisSchema,
      prompt: buildCompetitorPrompt({
        context: buildProjectContext({ project, brand, channels, strategy: bundle }),
        competitor: c.name,
        profiles: c.competitor_channels.map((ch) => `${platformLabel(ch.platform)} ${ch.url}: ${ch.display_name ?? ch.handle ?? ""}, followers ${ch.followers_count ?? "not available"}, ${ch.posts_collected} posts collected${ch.bio ? `; bio: ${ch.bio.slice(0, 300)}` : ""}`).join("\n") || "(none)",
        stats: summaryDigest(c.name, stats),
        posts: digest.text,
        ads: adsDigest(await listCompetitorAds(projectId, id), new Date().toISOString().slice(0, 10)),
      }),
    });
    // a "fact" must cite at least one real collected post; otherwise it is shown as a hypothesis
    const fix = (list: typeof out.strategy) => list.map((s) => {
      const refs = cleanRefs(s.refs, digest.refs);
      return { ...s, text: stripRefs(s.text), refs: refs.map((r) => digest.refs.get(r)!.id), basis: s.basis === "fact" && !refs.length && !["frequency", "format", "pillar", "topic"].includes(s.category) ? "hypothesis" as const : s.basis };
    });
    const result = { summary: stripRefs(out.summary), strategy: fix(out.strategy), performance: fix(out.performance), weaknesses: fix(out.weaknesses), notes: out.notes, stats, posts_analysed: posts.length };
    const reportId = await saveAnalysisReport({
      project_id: projectId, kind: "competitor", title: `${c.name} · ${new Date().toISOString().slice(0, 10)}`,
      scope: { competitor_ids: [id], period_days: c.history_days, posts: posts.length }, result, model, created_by: user.id,
    });
    refresh(projectId);
    return { ok: true, data: { reportId }, message: t("messages.analysisReady") };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

// --- AI: gaps and ideas -----------------------------------------------------------------------------------------

export type StoredIdea = GapAnalysis["ideas"][number] & {
  pillar_id: string | null; persona_id: string | null; inspired_posts: { id: string; url: string | null; competitor: string; platform: string | null; published_at: string | null; hook: string | null; lift: number | null; engagement: number | null }[];
  opportunity_score: number; confidence: "low" | "medium" | "high"; insight_type_final: "data_supported" | "hypothesis" | "experiment"; score_breakdown: unknown; classification_note: string | null;
};

export async function gapAnalysisAction(projectId: string, input: { competitorIds: string[]; days: number; count?: number }): Promise<ActionResult<{ reportId: string }>> {
  const { user, project, allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  const days = [30, 90, 180, 365].includes(input.days) ? input.days : 90;
  try {
    const competitors = (await listCompetitors(projectId)).filter((c) => !input.competitorIds.length || input.competitorIds.includes(c.id));
    if (!competitors.length) return { ok: false, error: t("errors.addCompetitorFirst") };
    const posts = await postsForAnalysis(projectId, competitors.map((c) => c.id), days);
    if (posts.length < 5) return { ok: false, error: t("errors.notEnoughPosts") };
    const { items, bundle, brand, channels } = await loadHistoryAnalysis(projectId);
    const tz = project.timezone || "Africa/Tunis";
    const since = Date.now() - days * 86400_000;
    const ownPosts: AnalysisPost[] = items
      .filter((i) => { const d = i.published_at ?? i.actual_publication_date ?? i.publication_date; return d && Date.parse(d) >= since; })
      .map((i) => ({ id: i.id, account: `own:${i.platform}`, platform: i.platform, published_at: i.published_at ?? i.actual_publication_date ?? i.publication_date, format: i.format, caption: i.caption ?? i.title, likes: i.likes ?? null, comments: i.comments ?? null, shares: i.shares ?? null, saves: i.saves ?? null, views: i.views ?? null, followers: null }));
    const ours = summarize(ownPosts, { tz, periodDays: days, ignore: [project.name, brand?.brand_name ?? ""] });
    const pillarShare = bundle.pillars.map((p) => {
      const n = items.filter((i) => i.pillar_id === p.id && Date.parse(i.published_at ?? i.publication_date ?? "") >= since).length;
      return `${p.name}: ${n} posts (target ${p.target_share ?? "none"}%)`;
    }).join("; ");
    const names = new Map(competitors.map((c) => [c.id, c.name]));
    const digest = postRefs(posts, names, 150);
    const existing = (await listOpportunities(projectId)).map((o) => o.title ?? o.idea);
    const count = Math.min(10, Math.max(3, input.count ?? 6));
    const { data: out, model } = await runStructuredWithMeta({
      feature: "competitors.gaps", workspaceId: project.workspace_id, projectId, userId: user.id, system: COMPETITOR_SYSTEM_PROMPT, schema: gapAnalysisSchema,
      prompt: buildGapPrompt({
        context: buildProjectContext({ project, brand, channels, strategy: bundle }),
        ours: `${summaryDigest("Our brand", ours)}\nOur pillars in this period: ${pillarShare || "no pillars"}`,
        competitors: competitors.map((c) => summaryDigest(c.name, summarize(posts.filter((p) => p.competitor_id === c.id).map(toAnalysis), { tz, periodDays: days, ignore: [c.name, ...c.competitor_channels.flatMap((ch) => [ch.display_name ?? "", ch.handle ?? ""])] }))).join("\n\n"),
        posts: digest.text, existing, count,
      }),
    });
    const weights = normalizeWeights(project.opportunity_weights);
    const byName = <T extends { id: string; name: string }>(list: T[], n: string | null) => (n ? list.find((x) => normalizeText(x.name) === normalizeText(n))?.id ?? null : null);
    const ideas: StoredIdea[] = out.ideas.map((idea) => {
      const refs = cleanRefs(idea.inspired_by, digest.refs).map((r) => digest.refs.get(r)!);
      const lifts = refs.map((r) => r.lift).filter((x): x is number => x != null).sort((a, b) => a - b);
      const lift = lifts.length ? lifts[Math.floor(lifts.length / 2)] : null;
      // one aggregated competitor signal: n = cited posts, lift = their median lift vs their own account median
      const signal: Signal = {
        key: "C", kind: "competitor_topic", category: "competitor", platform: idea.platform, pillar_id: null, format: idea.format,
        statement: `${refs.length} competitor post${refs.length > 1 ? "s" : ""} (median ×${lift ?? "?"} their own account's median engagement)`,
        method: "Engagement = likes + comments + shares + saves as published; lift = post engagement ÷ the median of the same account's collected posts.",
        period: { from: refs.map((r) => r.published_at).filter(Boolean).sort()[0] ?? null, to: refs.map((r) => r.published_at).filter(Boolean).sort().at(-1) ?? null },
        n: refs.length, lift, gap: 10, metrics: {}, ref_ids: refs.map((r) => r.id),
      };
      const cited = refs.length ? [signal] : [];
      const { insight_type, confidence, note } = classify(idea.insight_type, cited);
      const { score, breakdown } = computeScore({ cited, ai: idea.ratings, weights, competitorData: true });
      return {
        ...idea, title: stripRefs(idea.title), rationale: stripRefs(idea.rationale), original_angle: stripRefs(idea.original_angle), how_it_differs: stripRefs(idea.how_it_differs),
        pillar_id: byName(bundle.pillars, idea.pillar), persona_id: byName(bundle.personas, idea.persona),
        inspired_posts: refs.map((r) => ({ id: r.id, url: r.url, competitor: names.get(r.competitor_id) ?? "?", platform: r.platform, published_at: r.published_at, hook: r.hook, lift: r.lift, engagement: engagementOfPost(r) })),
        opportunity_score: score, confidence, insight_type_final: insight_type, score_breakdown: breakdown, classification_note: note,
      };
    });
    const gaps = out.gaps.map((g) => {
      const refs = cleanRefs(g.refs, digest.refs).map((r) => digest.refs.get(r)!);
      return { ...g, title: stripRefs(g.title), evidence: stripRefs(g.evidence), why: stripRefs(g.why), basis: g.basis === "fact" && !refs.length && g.type !== "we_cover_they_ignore" && g.type !== "underrepresented_pillar" ? "hypothesis" as const : g.basis, pillar_id: byName(bundle.pillars, g.pillar), posts: refs.map((r) => ({ id: r.id, url: r.url, competitor: names.get(r.competitor_id) ?? "?", hook: r.hook, lift: r.lift })) };
    });
    const reportId = await saveAnalysisReport({
      project_id: projectId, kind: "comparison", title: `Gaps vs ${competitors.map((c) => c.name).join(", ")} · ${days} days`,
      scope: { competitor_ids: competitors.map((c) => c.id), period_days: days, competitor_posts: posts.length, own_posts: ownPosts.length },
      result: { gaps, ideas, notes: out.notes, ours: { posts: ours.posts, perWeek: ours.perWeek } }, model, created_by: user.id,
    });
    refresh(projectId);
    return { ok: true, data: { reportId }, message: t("messages.gapsReady", { gaps: t("messages.gaps", { count: gaps.length }), ideas: t("messages.ideas", { count: ideas.length }) }) };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/**
 * "Create Content Opportunity": the edited idea becomes a row of the existing opportunities table, keeping the
 * competitor posts as evidence (with their original links). One opportunity per idea; near-duplicates are refused.
 */
export async function createOpportunityFromIdeaAction(projectId: string, reportId: string, index: number, edits: unknown): Promise<ActionResult<{ id: string }>> {
  const { allowed, t } = await guard(projectId);
  if (!allowed) return noEdit(t);
  const parsed = ideaEditSchema.safeParse(edits);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const db = await createClient();
    const { data: report, error } = await db.from("analysis_reports").select("id, result").eq("project_id", projectId).eq("id", reportId).eq("kind", "comparison").maybeSingle();
    if (error) throw error;
    const idea = (report?.result as { ideas?: StoredIdea[] } | null)?.ideas?.[index];
    if (!idea) return { ok: false, error: t("errors.ideaNotFound") };
    const existing = await listOpportunities(projectId);
    const already = existing.find((o) => o.analysis_report_id === reportId && (o.focus as { idea_index?: number })?.idea_index === index);
    if (already) return { ok: false, error: t("errors.alreadyCreated", { title: already.title ?? already.idea }) };
    const e = parsed.data;
    if (isDuplicate({ title: e.title, creative_angle: e.creative_angle, platform: e.platform }, existing)) return { ok: false, error: t("errors.similarExists") };
    const [opp] = await insertOpportunities(projectId, [{
      title: e.title, idea: e.title, rationale: e.rationale, creative_angle: e.creative_angle, hook: e.hook, cta: e.cta, format: e.format,
      platform: e.platform, pillar_id: e.pillar_id, funnel_stage: e.funnel_stage ?? null, persona_id: idea.persona_id, target_audience: idea.persona,
      insight_type: idea.insight_type_final, confidence: idea.confidence, opportunity_score: idea.opportunity_score,
      score_breakdown: idea.score_breakdown as never, source: "competitor_analysis", analysis_report_id: reportId, state: "new",
      focus: { idea_index: index, instruction: null } as never,
      evidence: [
        ...idea.inspired_posts.map((p) => ({
          type: "competitor", ref_id: p.id, ref_ids: [p.id], n: 1,
          note: `${p.competitor} · ${platformLabel(p.platform)} · ${p.published_at?.slice(0, 10) ?? "?"}: “${(p.hook ?? "").slice(0, 120)}” — engagement ${p.engagement ?? "n/a"}, ×${p.lift ?? "?"} their own median`,
          method: "Engagement as published (likes + comments + shares + saves); lift = ÷ the median of the same account's collected posts.",
          metrics: { source_url: p.url, competitor: p.competitor, lift: p.lift, engagement: p.engagement },
        })),
        { type: "ai_reasoning", note: [`How it differs from the competitor posts: ${idea.how_it_differs}`, idea.classification_note].filter(Boolean).join("\n") },
      ],
    }]);
    refresh(projectId);
    return { ok: true, data: { id: opp.id }, message: t("messages.opportunityCreated") };
  } catch (e) {
    return fail(e, t("errors.createOpportunity"), t);
  }
}
