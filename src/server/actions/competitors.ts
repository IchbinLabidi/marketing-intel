"use server";

import { revalidatePath } from "next/cache";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { engagementOfPost, summarize, type AnalysisPost } from "@/lib/competitors/analysis";
import { hashtagsOf, mentionsOf, normalizeWebsite, parseProfileUrl } from "@/lib/competitors/urls";
import { normalizeText, stripRefs } from "@/lib/history/text";
import { captionHook } from "@/lib/meta/normalize";
import { classify, computeScore, isDuplicate, normalizeWeights } from "@/lib/opportunities/scoring";
import type { Signal } from "@/lib/opportunities/signals";
import { competitorSchema, ideaEditSchema, manualPostSchema, type CompetitorInput } from "@/lib/validation/competitors";
import { zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { createClient } from "@/lib/supabase/server";
import { describeAIError } from "@/server/ai/client";
import {
  buildCompetitorPrompt, buildGapPrompt, COMPETITOR_SYSTEM_PROMPT, competitorAnalysisSchema, gapAnalysisSchema, platformLabel, summaryDigest,
  type GapAnalysis,
} from "@/server/ai/competitors";
import { buildProjectContext } from "@/server/ai/context";
import { runStructuredWithMeta } from "@/server/ai/run";
import { startCompetitorSync } from "@/server/competitors/start";
import { getCompetitor, listCompetitors, metricHistory, postsForAnalysis, type CompetitorPost } from "@/server/services/competitors";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { saveAnalysisReport } from "@/server/services/history";
import { insertOpportunities, listOpportunities } from "@/server/services/opportunities";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");
const fail = (e: unknown, fallback: string): ActionResult<never> => {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : fallback;
  return { ok: false, error: /schema cache|does not exist|column .* of relation/.test(m) ? "Competitors needs database migration 0009." : m };
};

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  return { user, project, allowed: canEdit(role) };
}

// --- Competitors and profiles --------------------------------------------------------------------------------

/** Creates or updates a competitor and adds the given profile links (existing profiles are kept). */
export async function saveCompetitorAction(projectId: string, id: string | null, input: CompetitorInput): Promise<ActionResult<{ id: string; started: boolean }>> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = competitorSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { profiles, website, ...fields } = parsed.data;
  const parsedProfiles = profiles.filter(Boolean).map((url) => ({ url, r: parseProfileUrl(url) }));
  const bad = parsedProfiles.find((p) => !p.r.ok);
  if (bad && !bad.r.ok) return { ok: false, error: `${bad.url}: ${bad.r.error}`, fieldErrors: { profiles: bad.r.error } };
  const unique = new Map(parsedProfiles.map((p) => p.r.ok && [`${p.r.profile.platform}:${p.r.profile.handle}`, p.r.profile]).filter(Boolean) as [string, { platform: Platform; handle: string; url: string }][]);
  if (website && !normalizeWebsite(website)) return { ok: false, error: "The website link is not valid.", fieldErrors: { website: "Invalid link" } };
  try {
    const db = await createClient();
    // a profile already tracked in this project (by any competitor) is refused, so posts are never collected twice
    if (unique.size) {
      const { data: taken } = await db.from("competitor_channels").select("platform, handle, competitor_id, competitors(name)").eq("project_id", projectId);
      for (const p of unique.values()) {
        const t = (taken ?? []).find((x) => x.platform === p.platform && (x.handle ?? "").toLowerCase() === p.handle);
        if (t && t.competitor_id !== id) return { ok: false, error: `${p.url} is already tracked for ${(t.competitors as unknown as { name: string } | null)?.name ?? "another competitor"}.` };
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
        if (error.code === "23505") return { ok: false, error: `A competitor named “${fields.name}” already exists.` };
        throw error;
      }
      competitorId = data.id;
    }
    const existing = id ? (await db.from("competitor_channels").select("platform, handle").eq("competitor_id", id)).data ?? [] : [];
    const toAdd = [...unique.values()].filter((p) => !existing.some((e) => e.platform === p.platform && (e.handle ?? "").toLowerCase() === p.handle));
    if (toAdd.length) {
      const { error } = await db.from("competitor_channels").insert(toAdd.map((p) => ({ competitor_id: competitorId, project_id: projectId, platform: p.platform, handle: p.handle, url: p.url })));
      if (error) {
        if (error.code === "23505") return { ok: false, error: "One of these profiles is already tracked in this project." };
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
    return { ok: true, data: { id: competitorId!, started }, message: started ? "Saved. Collecting public posts…" : "Competitor saved" };
  } catch (e) {
    return fail(e, "Could not save the competitor");
  }
}

export async function deleteCompetitorAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error, count } = await db.from("competitors").delete({ count: "exact" }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    if (!count) return { ok: false, error: "Competitor not found." };
    refresh(projectId);
    return { ok: true, message: "Competitor and its collected posts deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}

export async function removeProfileAction(projectId: string, channelId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error, count } = await db.from("competitor_channels").delete({ count: "exact" }).eq("project_id", projectId).eq("id", channelId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Profile not found." };
    refresh(projectId);
    return { ok: true, message: "Profile and its posts removed" };
  } catch (e) {
    return fail(e, "Could not remove the profile");
  }
}

export async function toggleProfileAction(projectId: string, channelId: string, enabled: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error } = await db.from("competitor_channels").update({ enabled }).eq("project_id", projectId).eq("id", channelId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: enabled ? "Profile monitored" : "Profile paused" };
  } catch (e) {
    return fail(e, "Could not update");
  }
}

export async function collectCompetitorAction(projectId: string, id: string): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const c = await getCompetitor(projectId, id);
    if (!c) return { ok: false, error: "Competitor not found." };
    if (!c.competitor_channels.some((ch) => ch.enabled)) return { ok: false, error: "Add at least one social profile first." };
    const r = await startCompetitorSync(projectId, c, "manual", user.id);
    if (!r.ok) return { ok: false, error: r.error };
    refresh(projectId);
    return { ok: true, message: "Collection started" };
  } catch (e) {
    return fail(e, "Could not start the collection");
  }
}

/** Platforms without a data provider: a person records a post with its original link and the public numbers shown. */
export async function addManualPostAction(projectId: string, input: unknown): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = manualPostSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const p = parsed.data;
  try {
    const db = await createClient();
    const { data: ch } = await db.from("competitor_channels").select("id, competitor_id, platform, followers_count").eq("project_id", projectId).eq("id", p.channel_id).maybeSingle();
    if (!ch) return { ok: false, error: "Profile not found." };
    const { error } = await db.from("competitor_content_items").upsert({
      project_id: projectId, competitor_id: ch.competitor_id, channel_id: ch.id, source: "manual", external_id: p.url.replace(/[?#].*$/, ""),
      platform: ch.platform, url: p.url, published_at: new Date(p.published_at).toISOString(), caption: p.caption, hook: captionHook(p.caption),
      title: captionHook(p.caption, 120), format: p.format, hashtags: hashtagsOf(p.caption), mentions: mentionsOf(p.caption),
      likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, followers_at_collection: ch.followers_count, metrics_updated_at: new Date().toISOString(),
    }, { onConflict: "competitor_id,source,external_id" });
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Post added" };
  } catch (e) {
    return fail(e, "Could not add the post");
  }
}

/**
 * Several manual posts at once for one profile (pasted lines, see lib/competitors/bulk). Each row is validated with
 * the same rules as a single post; valid rows are saved, invalid ones are reported back with their line number.
 * Re-importing the same link updates that post instead of duplicating it.
 */
export async function addManualPostsAction(projectId: string, channelId: string, rows: unknown[]): Promise<ActionResult<{ saved: number; errors: { line: number; error: string }[] }>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "Nothing to import." };
  if (rows.length > 200) return { ok: false, error: "Import at most 200 posts at a time." };
  try {
    const db = await createClient();
    const { data: ch } = await db.from("competitor_channels").select("id, competitor_id, platform, followers_count").eq("project_id", projectId).eq("id", channelId).maybeSingle();
    if (!ch) return { ok: false, error: "Profile not found." };
    const errors: { line: number; error: string }[] = [];
    const now = new Date().toISOString();
    const byId = new Map<string, Record<string, unknown>>();
    rows.forEach((raw, i) => {
      const line = typeof (raw as { line?: unknown })?.line === "number" ? (raw as { line: number }).line : i + 1;
      const parsed = manualPostSchema.safeParse({ ...(raw as object), channel_id: channelId });
      if (!parsed.success) return errors.push({ line, error: parsed.error.issues[0]?.message ?? "Invalid row" });
      const p = parsed.data;
      const externalId = p.url.replace(/[?#].*$/, "");
      byId.set(externalId, {
        project_id: projectId, competitor_id: ch.competitor_id, channel_id: ch.id, source: "manual", external_id: externalId,
        platform: ch.platform, url: p.url, published_at: new Date(p.published_at).toISOString(), caption: p.caption, hook: captionHook(p.caption),
        title: captionHook(p.caption, 120), format: p.format, hashtags: hashtagsOf(p.caption), mentions: mentionsOf(p.caption),
        likes: p.likes, comments: p.comments, shares: p.shares, views: p.views, followers_at_collection: ch.followers_count, metrics_updated_at: now,
      });
    });
    if (byId.size) {
      const { error } = await db.from("competitor_content_items").upsert([...byId.values()], { onConflict: "competitor_id,source,external_id" });
      if (error) throw error;
      refresh(projectId);
    }
    return { ok: true, data: { saved: byId.size, errors }, message: `${byId.size} post${byId.size === 1 ? "" : "s"} saved${errors.length ? `, ${errors.length} line${errors.length === 1 ? "" : "s"} skipped` : ""}` };
  } catch (e) {
    return fail(e, "Could not import the posts");
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
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const c = await getCompetitor(projectId, id);
    if (!c) return { ok: false, error: "Competitor not found." };
    const posts = await postsForAnalysis(projectId, [id], Math.max(30, c.history_days));
    if (posts.length < 5) return { ok: false, error: "Collect at least 5 posts before analysing (Collect now, or add posts manually)." };
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
    return { ok: true, data: { reportId }, message: "Analysis ready" };
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
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const days = [30, 90, 180, 365].includes(input.days) ? input.days : 90;
  try {
    const competitors = (await listCompetitors(projectId)).filter((c) => !input.competitorIds.length || input.competitorIds.includes(c.id));
    if (!competitors.length) return { ok: false, error: "Add a competitor first." };
    const posts = await postsForAnalysis(projectId, competitors.map((c) => c.id), days);
    if (posts.length < 5) return { ok: false, error: "Not enough collected competitor posts in this period (5 needed)." };
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
    return { ok: true, data: { reportId }, message: `${gaps.length} gaps and ${ideas.length} ideas` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/**
 * "Create Content Opportunity": the edited idea becomes a row of the existing opportunities table, keeping the
 * competitor posts as evidence (with their original links). One opportunity per idea; near-duplicates are refused.
 */
export async function createOpportunityFromIdeaAction(projectId: string, reportId: string, index: number, edits: unknown): Promise<ActionResult<{ id: string }>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = ideaEditSchema.safeParse(edits);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const db = await createClient();
    const { data: report, error } = await db.from("analysis_reports").select("id, result").eq("project_id", projectId).eq("id", reportId).eq("kind", "comparison").maybeSingle();
    if (error) throw error;
    const idea = (report?.result as { ideas?: StoredIdea[] } | null)?.ideas?.[index];
    if (!idea) return { ok: false, error: "Idea not found." };
    const existing = await listOpportunities(projectId);
    const already = existing.find((o) => o.analysis_report_id === reportId && (o.focus as { idea_index?: number })?.idea_index === index);
    if (already) return { ok: false, error: `Already created: “${already.title ?? already.idea}”.` };
    const e = parsed.data;
    if (isDuplicate({ title: e.title, creative_angle: e.creative_angle, platform: e.platform }, existing)) return { ok: false, error: "A very similar opportunity already exists. Change the title or angle." };
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
    return { ok: true, data: { id: opp.id }, message: "Content opportunity created" };
  } catch (e) {
    return fail(e, "Could not create the opportunity");
  }
}
