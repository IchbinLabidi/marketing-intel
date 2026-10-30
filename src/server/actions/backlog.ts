"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canAdmin, canEdit, PLATFORMS } from "@/lib/domain/constants";
import { bestPublicationTimes } from "@/lib/calendar/insights";
import { isIsoDate, isTime, todayInZone } from "@/lib/calendar/time";
import { CRITERIA, normalizeWeights, weightedScore, type ScoreDetails } from "@/lib/backlog/score";
import { suggestSlot, type SuggestedSlot } from "@/lib/backlog/slots";
import { planCalendar, type PlanIdea, type PlanRequest, type Placement } from "@/lib/backlog/planner";
import { conversionLabel, goalFits, normalizeMix, SEGMENTS, SEGMENT_LABELS, sideOf, SIDE_LABELS, type Segment } from "@/lib/backlog/audience";
import type { ActionResult } from "@/lib/validation/common";
import { describeAIError } from "@/server/ai/client";
import { buildProjectContext } from "@/server/ai/context";
import { runStructuredWithMeta } from "@/server/ai/run";
import { busyDays, listIdeas, type BacklogFilters, type Idea } from "@/server/services/backlog";
import { loadHistoryAnalysis, loadHistoryPerformance } from "@/server/services/history-analysis";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { hasPermission } from "@/server/services/team";
import { reschedulePostAction, type Conflict } from "@/server/actions/calendar";

const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");
const fail = (e: unknown, fallback: string): ActionResult<never> => ({ ok: false, error: e instanceof Error && e.message ? e.message : fallback });
const BULK_MAX = 200;

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  const allowed = canEdit(role) && ((await hasPermission(project.workspace_id, "content.create")) || (await hasPermission(project.workspace_id, "calendar.edit")));
  return { user, project, role, allowed, tz: project.timezone || "Africa/Tunis" };
}
const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role can't edit ideas." };

export async function listIdeasAction(projectId: string, filters: BacklogFilters, page = 0): Promise<ActionResult<{ ideas: Idea[]; total: number }>> {
  await requireUser();
  await getProjectContext(projectId);
  try { return { ok: true, data: await listIdeas(projectId, filters, page) }; } catch (e) { return fail(e, "Could not load ideas"); }
}

// --- Create & edit -----------------------------------------------------------------------------------------

const ideaSchema = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().max(4000).nullish(),
  pillar_id: z.uuid().nullish(),
  format: z.string().max(80).nullish(),
  platform: z.enum(PLATFORMS).nullish(),
  target_platforms: z.array(z.enum(PLATFORMS)).max(8).optional(),
  target_audience: z.string().max(500).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  audience_segment: z.enum(SEGMENTS).nullish(),
  conversion_goal: z.string().max(40).nullish(),
});
export type IdeaInput = z.infer<typeof ideaSchema>;

/** Every new idea starts in the Backlog: no calendar date, Idea stage. It never reaches the calendar on its own. */
export async function createIdeaAction(projectId: string, input: unknown): Promise<ActionResult<Idea>> {
  const { user, project, allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = ideaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the idea a title (2 to 300 characters)." };
  if (!goalFits(parsed.data.audience_segment, parsed.data.conversion_goal)) return { ok: false, error: "This conversion goal belongs to the other side of the audience (teacher goals and student goals are kept apart)." };
  try {
    const db = await createClient();
    const v = parsed.data;
    const platforms = v.target_platforms?.length ? v.target_platforms : v.platform ? [v.platform] : [];
    const { data, error } = await db.from("content_items").insert({
      project_id: projectId, created_by: user.id, title: v.title, description: v.description ?? null, pillar_id: v.pillar_id ?? null,
      format: v.format ?? null, platform: v.platform ?? platforms[0] ?? null, target_platforms: platforms, target_audience: v.target_audience ?? null,
      tags: v.tags ?? [], status: "idea", production_stage: "idea", idea_source: "manual", language: project.default_language || "fr",
      audience_segment: v.audience_segment ?? null, conversion_goal: v.conversion_goal ?? null,
      scheduled_date: null, scheduled_time: null, scheduled_at: null,
    }).select("*").single();
    if (error) throw error;
    if (v.priority && v.priority !== "medium") await db.from("content_items").update({ priority: v.priority }).eq("id", data.id);
    await computeSlots(projectId, [data as Idea], tz);
    refresh(projectId);
    const { data: fresh } = await db.from("content_items").select("*").eq("id", data.id).single();
    return { ok: true, data: fresh as Idea, message: "Idea added to the Backlog" };
  } catch (e) { return fail(e, "Could not create the idea"); }
}

export async function updateIdeaAction(projectId: string, id: string, input: unknown): Promise<ActionResult<Idea>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = ideaSchema.partial().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some fields are invalid." };
  if ("conversion_goal" in parsed.data && !goalFits(parsed.data.audience_segment, parsed.data.conversion_goal)) return { ok: false, error: "This conversion goal belongs to the other side of the audience (teacher goals and student goals are kept apart)." };
  try {
    const db = await createClient();
    const v = parsed.data;
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "description", "pillar_id", "format", "target_audience", "tags", "priority", "audience_segment", "conversion_goal"] as const) if (k in v) patch[k] = v[k] ?? null;
    if ("tags" in v) patch.tags = v.tags ?? [];
    if (v.target_platforms) { patch.target_platforms = v.target_platforms; if (!("platform" in v)) patch.platform = v.target_platforms[0] ?? null; }
    if ("platform" in v) patch.platform = v.platform ?? null;
    const { data, error } = await db.from("content_items").update(patch).eq("project_id", projectId).eq("id", id).select("*").single();
    if (error) throw error;
    refresh(projectId);
    return { ok: true, data: data as Idea, message: "Idea saved" };
  } catch (e) { return fail(e, "Could not save the idea"); }
}

// --- Scoring -----------------------------------------------------------------------------------------------

const scoreSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    criteria: z.object(Object.fromEntries(CRITERIA.map((c) => [c.key, z.number().min(0).max(100)])) as Record<(typeof CRITERIA)[number]["key"], z.ZodNumber>),
    explanation: z.string().max(600),
  })),
});

/** AI rates each idea on the six criteria; the score is the brand-weighted average. Up to 20 ideas per call. */
export async function scoreIdeasAction(projectId: string, ids: string[]): Promise<ActionResult<{ scored: number }>> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const list = [...new Set(ids)].slice(0, 20);
  if (!list.length) return { ok: false, error: "Select ideas to score." };
  try {
    const db = await createClient();
    const { data: rows } = await db.from("content_items").select("id, title, description, hook, format, platform, target_platforms, target_audience, pillar_id, tags, funnel_stage, audience_segment, conversion_goal").eq("project_id", projectId).in("id", list);
    if (!rows?.length) return { ok: false, error: "Ideas not found." };
    const { bundle, brand, channels } = await loadHistoryAnalysis(projectId);
    const weights = normalizeWeights(project.idea_score_weights as Record<string, unknown> | null);
    const pillar = (id: string | null) => bundle.pillars.find((p) => p.id === id)?.name ?? "none";
    const { data, model } = await runStructuredWithMeta({
      feature: "backlog.score", projectId, workspaceId: project.workspace_id, userId: user.id, schema: scoreSchema, effort: "low",
      system: "You evaluate social media content ideas for one brand. Rate each idea from 0 to 100 on: audience relevance (fits the brand's personas), engagement potential, marketing value (supports the brand's objectives and funnel), originality (not repetitive), educational value, and production feasibility (effort for a small team). Judge each idea for ITS audience segment and conversion goal: for two-sided brands, teacher content (recruitment, activation) is evaluated only against teacher goals and student/parent content only against student-side goals (forum participation, profile visits, lesson requests, bookings); never mix the two. Be calibrated and critical: most ideas land between 40 and 80. Explain in one or two sentences why, citing the strongest and weakest criterion. These are estimates for prioritising ideas, never performance predictions. Return the ids exactly as given.",
      prompt: `${buildProjectContext({ project, brand, channels, strategy: bundle })}\n\nIdeas to rate (JSON):\n${JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title, description: r.description ?? r.hook, format: r.format, platforms: (r.target_platforms as string[])?.length ? r.target_platforms : [r.platform], audience: r.target_audience, segment: r.audience_segment ? SEGMENT_LABELS[r.audience_segment as Segment] : "not set", side: sideOf(r.audience_segment) ? SIDE_LABELS[sideOf(r.audience_segment)!] : "not set", conversion_goal: conversionLabel(r.conversion_goal) ?? "not set", pillar: pillar(r.pillar_id), tags: r.tags, funnel: r.funnel_stage })))}`,
    });
    let scored = 0;
    for (const s of data.ideas) {
      if (!list.includes(s.id)) continue;
      const details: ScoreDetails = { criteria: s.criteria, weights, explanation: s.explanation, source: "ai", model, scored_at: new Date().toISOString() };
      const { error } = await db.from("content_items").update({ idea_score: weightedScore(s.criteria, weights), score_details: details }).eq("project_id", projectId).eq("id", s.id);
      if (!error) scored++;
    }
    refresh(projectId);
    return { ok: true, data: { scored }, message: `${scored} idea${scored === 1 ? "" : "s"} scored. Scores are estimates to rank ideas, not performance predictions.` };
  } catch (e) { return { ok: false, error: describeAIError(e) }; }
}

export async function setScoreAction(projectId: string, id: string, score: number, note: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!Number.isInteger(score) || score < 0 || score > 100) return { ok: false, error: "Enter a score from 0 to 100." };
  const db = await createClient();
  const { data: row } = await db.from("content_items").select("score_details").eq("project_id", projectId).eq("id", id).maybeSingle();
  const prev = (row?.score_details ?? null) as ScoreDetails | null;
  const details: ScoreDetails = { ...(prev ?? {}), source: "manual", note: note.slice(0, 300), scored_at: new Date().toISOString() };
  const { error } = await db.from("content_items").update({ idea_score: score, score_details: details }).eq("project_id", projectId).eq("id", id);
  if (error) return fail(error, "Could not save the score");
  refresh(projectId);
  return { ok: true, message: "Score set manually" };
}

export async function saveScoreWeightsAction(projectId: string, weights: Record<string, number>): Promise<ActionResult> {
  await requireUser();
  const { project, role } = await getProjectContext(projectId);
  if (!canAdmin(role) && !(await hasPermission(project.workspace_id, "projects.manage"))) return { ok: false, error: "Only administrators can change the scoring weights." };
  const db = await createClient();
  const { error } = await db.from("projects").update({ idea_score_weights: normalizeWeights(weights) }).eq("id", projectId);
  if (error) return fail(error, "Could not save the weights");
  refresh(projectId);
  return { ok: true, message: "Scoring weights saved. Rescore ideas to apply them." };
}

// --- Best time to post -------------------------------------------------------------------------------------

async function computeSlots(projectId: string, ideas: Pick<Idea, "id" | "platform" | "target_platforms" | "format" | "target_audience" | "pillar_id" | "audience_segment">[], tz: string) {
  const db = await createClient();
  const [{ items }, { bundle }] = await Promise.all([loadHistoryPerformance(projectId), loadHistoryAnalysis(projectId)]);
  const timing = bestPublicationTimes(items, tz);
  const today = todayInZone(tz);
  const busy = await busyDays(projectId, today, new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
  const out: Record<string, SuggestedSlot | null> = {};
  for (const i of ideas) {
    const slot = suggestSlot({
      platform: i.platform, targetPlatforms: i.target_platforms, format: i.format, audience: i.target_audience ?? null, segment: i.audience_segment ?? null,
      pillar: bundle.pillars.find((p) => p.id === i.pillar_id)?.name ?? null, today, timing, busy,
    });
    out[i.id] = slot;
    if (slot) busy[slot.date] = (busy[slot.date] ?? 0) + 1; // spread suggestions instead of stacking one day
    await db.from("content_items").update({ suggested_slot: slot }).eq("project_id", projectId).eq("id", i.id);
  }
  return out;
}

/** Recomputes the suggested date/time (cached on the idea; never schedules anything). */
export async function refreshSuggestionsAction(projectId: string, ids: string[]): Promise<ActionResult<Record<string, SuggestedSlot | null>>> {
  const { allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { data } = await db.from("content_items").select("id, platform, target_platforms, format, target_audience, pillar_id, audience_segment").eq("project_id", projectId).in("id", [...new Set(ids)].slice(0, BULK_MAX));
    const out = await computeSlots(projectId, (data ?? []) as Idea[], tz);
    refresh(projectId);
    return { ok: true, data: out, message: "Suggestions updated" };
  } catch (e) { return fail(e, "Could not compute suggestions"); }
}

export async function dismissSuggestionAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { error } = await db.from("content_items").update({ suggested_slot: null }).eq("project_id", projectId).eq("id", id);
  if (error) return fail(error, "Could not dismiss");
  refresh(projectId);
  return { ok: true };
}

// --- Calendar placement (planning only: nothing is scheduled on a platform or published) -------------------

export async function placeIdeaAction(projectId: string, id: string, input: { date: string; time: string | null; platforms: string[]; force?: boolean }): Promise<ActionResult<{ conflicts?: Conflict[] }>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!isIsoDate(input.date) || (input.time && !isTime(input.time))) return { ok: false, error: "Choose a valid date and time." };
  const platforms = input.platforms.filter((p) => (PLATFORMS as readonly string[]).includes(p));
  const db = await createClient();
  if (platforms.length) {
    const { error } = await db.from("content_items").update({ target_platforms: platforms, platform: platforms[0] }).eq("project_id", projectId).eq("id", id);
    if (error) return fail(error, "Could not save the platforms");
  }
  const r = await reschedulePostAction(projectId, id, input.date, input.time, Boolean(input.force));
  if (!r.ok) return r;
  if (r.data?.conflicts?.length) return { ok: true, data: { conflicts: r.data.conflicts } };
  // an idea placed on the calendar becomes "planned" (production stage and publishing status are unchanged)
  await db.from("content_items").update({ status: "planned" }).eq("project_id", projectId).eq("id", id).eq("status", "idea");
  refresh(projectId);
  return { ok: true, data: {}, message: `Planned for ${input.date}${input.time ? ` at ${input.time}` : ""}. Nothing is published until you publish it.` };
}

/** Back to the Backlog: the calendar date is removed, all content and metadata are kept. */
export async function unplanIdeasAction(projectId: string, ids: string[]): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { error, count } = await db.from("content_items").update({ scheduled_date: null, scheduled_time: null, scheduled_at: null }, { count: "exact" })
    .eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX)).not("status", "in", "(published,scheduled)");
  if (error) return fail(error, "Could not move back to the Backlog");
  await db.from("content_items").update({ status: "idea" }).eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX)).eq("status", "planned");
  refresh(projectId);
  return { ok: true, message: `${count ?? 0} moved back to the Backlog (scheduled and published posts are left as they are)` };
}

// --- Bulk actions ------------------------------------------------------------------------------------------

export async function archiveIdeasAction(projectId: string, ids: string[], archived: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  let q = db.from("content_items").update({ archived_at: archived ? new Date().toISOString() : null }, { count: "exact" })
    .eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX)).neq("status", "published");
  if (archived) q = q.is("scheduled_date", null); // only Backlog ideas are archived; planned posts stay on the calendar
  const { error, count } = await q;
  if (error) return fail(error, "Could not archive");
  refresh(projectId);
  return { ok: true, message: archived ? `${count ?? 0} archived (only Backlog ideas can be archived)` : `${count ?? 0} restored to the Backlog` };
}

/** Deletes ideas permanently, with their stored files (no orphaned files). Published posts are never deleted. */
export async function deleteIdeasAction(projectId: string, ids: string[]): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const list = ids.slice(0, BULK_MAX);
  const { data: items } = await db.from("content_items").select("id, status").eq("project_id", projectId).in("id", list);
  const deletable = (items ?? []).filter((i) => i.status !== "published" && i.status !== "scheduled").map((i) => i.id);
  if (!deletable.length) return { ok: false, error: "Scheduled and published posts can't be deleted from the Backlog." };
  const { data: assets } = await db.from("content_assets").select("body").eq("project_id", projectId).in("content_item_id", deletable).eq("kind", "media");
  const paths = (assets ?? []).map((a) => (a.body as { path?: string }).path).filter((p): p is string => Boolean(p));
  if (paths.length) {
    const { error } = await db.storage.from("production-media").remove(paths);
    if (error) return { ok: false, error: "Stored files couldn't be removed, so nothing was deleted. Try again." };
  }
  const { error, count } = await db.from("content_items").delete({ count: "exact" }).eq("project_id", projectId).in("id", deletable);
  if (error) return fail(error, "Could not delete");
  refresh(projectId);
  return { ok: true, message: `${count ?? 0} deleted permanently${paths.length ? ` with ${paths.length} stored file${paths.length > 1 ? "s" : ""}` : ""}` };
}

export async function setPriorityAction(projectId: string, ids: string[], priority: "low" | "medium" | "high" | "urgent"): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { error } = await db.from("content_items").update({ priority }).eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX));
  if (error) return fail(error, "Could not change the priority");
  refresh(projectId);
  return { ok: true, message: "Priority updated" };
}

export async function tagIdeasAction(projectId: string, ids: string[], tag: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const t = tag.trim().slice(0, 40);
  if (!t) return { ok: false, error: "Enter a tag." };
  const db = await createClient();
  const { data } = await db.from("content_items").select("id, tags").eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX));
  for (const r of data ?? []) {
    const tags = (r.tags as string[]) ?? [];
    if (!tags.includes(t)) await db.from("content_items").update({ tags: [...tags, t].slice(0, 20) }).eq("id", r.id);
  }
  refresh(projectId);
  return { ok: true, message: `Tagged “${t}”` };
}

/** Sends ideas to Content Production (Brief stage), keeping title, pillar, score, files, date, brand and platforms. */
export async function sendToProductionAction(projectId: string, ids: string[]): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { data } = await db.from("content_items").select("id, revision, production_stage").eq("project_id", projectId).in("id", ids.slice(0, BULK_MAX));
  let moved = 0; const errors: string[] = [];
  for (const r of data ?? []) {
    if (r.production_stage !== "idea") continue;
    const { error } = await db.rpc("production_transition", { p_project: projectId, p_id: r.id, p_revision: r.revision, p_stage: "brief", p_decision: null, p_comment: "" });
    if (error) errors.push(error.message); else moved++;
  }
  refresh(projectId);
  if (!moved && errors.length) return { ok: false, error: errors[0] };
  return { ok: true, message: `${moved} sent to Content Production${errors.length ? ` (${errors.length} failed: ${errors[0]})` : ""}` };
}

export async function duplicateIdeaAction(projectId: string, id: string): Promise<ActionResult<Idea>> {
  const { user, allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const db = await createClient();
  const { data: src } = await db.from("content_items").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (!src) return { ok: false, error: "Idea not found." };
  const { data, error } = await db.from("content_items").insert({
    project_id: projectId, created_by: user.id, title: `${src.title} (copy)`.slice(0, 300), description: src.description, hook: src.hook, caption: src.caption,
    cta: src.cta, hashtags: src.hashtags, creative_brief: src.creative_brief, pillar_id: src.pillar_id, format: src.format, platform: src.platform,
    target_platforms: src.target_platforms, target_audience: src.target_audience, tags: src.tags, funnel_stage: src.funnel_stage, language: src.language,
    audience_segment: src.audience_segment, conversion_goal: src.conversion_goal,
    idea_score: src.idea_score, score_details: src.score_details, status: "idea", production_stage: "idea", idea_source: "manual",
  }).select("*").single();
  if (error) return fail(error, "Could not duplicate");
  await computeSlots(projectId, [data as Idea], tz);
  refresh(projectId);
  return { ok: true, data: data as Idea, message: "Idea duplicated in the Backlog" };
}

// --- Saved filters -----------------------------------------------------------------------------------------

export type FilterPreset = { id: string; name: string; filters: BacklogFilters };

export async function listPresetsAction(projectId: string): Promise<ActionResult<FilterPreset[]>> {
  await requireUser();
  await getProjectContext(projectId);
  const db = await createClient();
  const { data } = await db.from("backlog_filter_presets").select("id, name, filters").eq("project_id", projectId).order("name");
  return { ok: true, data: (data ?? []) as FilterPreset[] };
}
export async function savePresetAction(projectId: string, name: string, filters: BacklogFilters): Promise<ActionResult<FilterPreset>> {
  await requireUser();
  await getProjectContext(projectId);
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: "Name the filter." };
  const db = await createClient();
  const { data, error } = await db.from("backlog_filter_presets").upsert({ project_id: projectId, name: n, filters }, { onConflict: "project_id,user_id,name" }).select("id, name, filters").single();
  if (error) return fail(error, "Could not save the filter");
  return { ok: true, data: data as FilterPreset, message: `Filter “${n}” saved` };
}
export async function deletePresetAction(projectId: string, id: string): Promise<ActionResult> {
  await requireUser();
  const db = await createClient();
  const { error } = await db.from("backlog_filter_presets").delete().eq("project_id", projectId).eq("id", id);
  if (error) return fail(error, "Could not delete the filter");
  return { ok: true };
}

// --- Calendar Planner (preview first; nothing is saved until the person approves) ---------------------------

export async function previewPlanAction(projectId: string, req: PlanRequest): Promise<ActionResult<{ placements: Placement[]; notes: string[]; options: PlanIdea[] }>> {
  await requireUser();
  const { project } = await getProjectContext(projectId);
  const tz = project.timezone || "Africa/Tunis";
  if (!isIsoDate(req.from) || !isIsoDate(req.to) || req.to < req.from) return { ok: false, error: "Choose a valid date range." };
  if (Date.parse(req.to) - Date.parse(req.from) > 92 * 86_400_000) return { ok: false, error: "Plan at most 3 months at a time." };
  if (!Number.isInteger(req.postsPerWeek) || req.postsPerWeek < 1 || req.postsPerWeek > 14) return { ok: false, error: "Posts per week: 1 to 14." };
  try {
    const db = await createClient();
    const { data } = await db.from("content_items").select("id, title, idea_score, pillar_id, format, platform, target_platforms, target_audience, priority, audience_segment")
      .eq("project_id", projectId).is("scheduled_date", null).is("archived_at", null).neq("status", "published").order("idea_score", { ascending: false, nullsFirst: false }).limit(500);
    const ideas: PlanIdea[] = (data ?? []).map((r) => ({ id: r.id, title: r.title, score: r.idea_score, pillar_id: r.pillar_id, format: r.format, platform: r.platform, target_platforms: (r.target_platforms as string[]) ?? [], target_audience: r.target_audience, priority: r.priority, segment: r.audience_segment }));
    const { items } = await loadHistoryPerformance(projectId);
    const timing = bestPublicationTimes(items, tz);
    const busy = await busyDays(projectId, req.from, req.to);
    const plan = planCalendar(ideas, { ...req, audienceMix: req.audienceMix ?? normalizeMix(project.audience_mix) ?? undefined }, { timing, busy, today: todayInZone(tz) });
    return { ok: true, data: { ...plan, options: ideas } };
  } catch (e) { return fail(e, "Could not prepare the plan"); }
}

/** Saves the approved placements on the calendar (planning only). Each one is independent: failures are reported. */
export async function savePlanAction(projectId: string, placements: { ideaId: string; date: string; time: string; platform: string }[]): Promise<ActionResult<{ saved: number; failed: string[] }>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const failed: string[] = []; let saved = 0;
  for (const p of placements.slice(0, 100)) {
    const r = await placeIdeaAction(projectId, p.ideaId, { date: p.date, time: p.time, platforms: [p.platform], force: true });
    if (r.ok) saved++; else failed.push(r.error);
  }
  refresh(projectId);
  if (!saved && placements.length) return { ok: false, error: failed[0] ?? "Nothing was saved." };
  return { ok: true, data: { saved, failed }, message: `${saved} idea${saved === 1 ? "" : "s"} placed on the calendar${failed.length ? `, ${failed.length} failed (${failed[0]})` : ""}. Nothing is published until you publish it.` };
}

/** The brand's monthly audience distribution (e.g. 60% students & parents, 35% teachers, 5% both). Admins only. */
export async function saveAudienceMixAction(projectId: string, mix: Record<string, number>): Promise<ActionResult> {
  await requireUser();
  const { project, role } = await getProjectContext(projectId);
  if (!canAdmin(role) && !(await hasPermission(project.workspace_id, "projects.manage"))) return { ok: false, error: "Only administrators can change the audience mix." };
  const normalized = normalizeMix(mix);
  if (!normalized) return { ok: false, error: "Give at least one audience a share above 0%." };
  const db = await createClient();
  const { error } = await db.from("projects").update({ audience_mix: normalized }).eq("id", projectId);
  if (error) return fail(error, "Could not save the mix");
  refresh(projectId);
  return { ok: true, message: "Audience mix saved" };
}
