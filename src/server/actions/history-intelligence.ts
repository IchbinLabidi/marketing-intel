"use server";

import { revalidatePath } from "next/cache";
import { canEdit, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { upcomingWindows } from "@/lib/history/seasons";
import { normalizeText, stripRefs } from "@/lib/history/text";
import type { ActionResult } from "@/lib/validation/common";
import { calendarRequestSchema, saveCalendarSchema, type CalendarRequest, type DraftItem } from "@/lib/validation/history";
import { zodErrorToResult } from "@/lib/validation/common";
import { describeAIError } from "@/server/ai/client";
import { buildProjectContext } from "@/server/ai/context";
import {
  buildCalendarPrompt,
  buildRecommendationsPrompt,
  calendarDraftSchema,
  historyDigest,
  buildPillarPrompt,
  HISTORY_SYSTEM_PROMPT,
  performanceDigest,
  PILLAR_SYSTEM_PROMPT,
  pillarClassificationSchema,
  recommendationsSchema,
  statsDigest,
} from "@/server/ai/history";
import { createClient } from "@/lib/supabase/server";
import { runStructured, runStructuredWithMeta } from "@/server/ai/run";
import { createCalendarWithItems, deleteCalendar } from "@/server/services/calendar";
import { listHistoryOpportunities, replaceHistoryOpportunities, saveAnalysisReport, setOpportunityState } from "@/server/services/history";
import { linkedPosts } from "@/server/services/opportunities";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

const byName = <T extends { id: string; name: string }>(list: T[], name: string | null) =>
  name ? list.find((x) => normalizeText(x.name) === normalizeText(name))?.id ?? null : null;

async function canEditProject(projectId: string) {
  await requireUser();
  return canEdit((await getProjectContext(projectId)).role);
}

async function load(projectId: string) {
  const user = await requireUser();
  const data = await loadHistoryAnalysis(projectId);
  return { user, ...data, allowed: canEdit(data.role) };
}

/**
 * Runs the AI pass over the imported history. The deterministic statistics are saved with the output in
 * analysis_reports (so every recommendation stays traceable), and each recommendation becomes an opportunity.
 */
export async function generateRecommendationsAction(projectId: string, instruction?: string): Promise<ActionResult<{ count: number }>> {
  const { user, project, items, bundle, channels, brand, stats, performance, citedIds, pillarName, allowed } = await load(projectId);
  if (!allowed) return NO_EDIT;
  if (!items.length) return { ok: false, error: "Connect Meta or import a calendar first: there is no historical content yet." };
  try {
    const digest = historyDigest(items, pillarName, citedIds);
    const refOf = new Map([...digest.refs.entries()].map(([ref, id]) => [id, ref]));
    const context = buildProjectContext({ project, brand, channels, strategy: bundle });
    const { data: out, model } = await runStructuredWithMeta({
      feature: "history.recommendations",
      workspaceId: project.workspace_id,
      projectId,
      userId: user.id,
      system: HISTORY_SYSTEM_PROMPT,
      prompt: buildRecommendationsPrompt({
        context,
        stats: statsDigest(stats, (id) => refOf.get(id)),
        performance: performanceDigest(performance, (id) => refOf.get(id)),
        items: digest.text,
        instruction: instruction?.slice(0, 1000),
      }),
      schema: recommendationsSchema,
    });

    const metricsImported = stats.metrics.coverage.length > 0;
    const recommendations = out.recommendations.map((r) => ({
      ...r,
      title: stripRefs(r.title),
      explanation: stripRefs(r.explanation),
      evidence: r.evidence.map((e) => ({ ...e, note: stripRefs(e.note), item_ids: e.refs.map((ref) => digest.refs.get(ref)).filter((x): x is string => Boolean(x)) })),
    }));
    const reportId = await saveAnalysisReport({
      project_id: projectId,
      kind: "historical",
      title: `Historical analysis · ${new Date().toISOString().slice(0, 10)}`,
      scope: { import_job_ids: [...new Set(items.map((i) => i.import_job_id))], items: items.length, period: [stats.totals.start, stats.totals.end] },
      result: { stats, performance, recommendations, topic_gaps: out.topic_gaps, notes: out.notes, metrics_imported: metricsImported },
      model,
      created_by: user.id,
    });
    await replaceHistoryOpportunities(
      projectId,
      recommendations.map((r) => ({
        title: r.title,
        idea: r.title,
        rationale: r.explanation,
        pillar_id: byName(bundle.pillars, r.pillar),
        persona_id: byName(bundle.personas, r.persona),
        target_audience: r.persona,
        funnel_stage: r.funnel_stage,
        platform: r.platform,
        format: r.format,
        evidence: r.evidence.flatMap((e): { type: string; ref_id: string | null; note: string }[] =>
          e.item_ids.length ? e.item_ids.map((id) => ({ type: "historical", ref_id: id, note: e.note })) : [{ type: e.kind === "strategy" ? "strategy" : "statistic", ref_id: null, note: e.note }],
        ),
        insight_type: r.insight_type,
        confidence: r.confidence,
        suggested_timing: r.timing,
        creative_angle: r.category,
        source: "historical_analysis",
        analysis_report_id: reportId,
        state: "new",
      })),
    );
    refresh(projectId);
    return { ok: true, data: { count: recommendations.length }, message: `${recommendations.length} recommendations generated` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/**
 * Assigns synced/imported posts without a pillar to the strategy's pillars with AI. Assignments are marked
 * pillar_assigned_by = 'ai' and shown as such; pillars set by a person or by the file are never overwritten.
 */
export async function classifyPillarsAction(projectId: string): Promise<ActionResult<{ assigned: number; unmatched: number; remaining: number }>> {
  const { user, project, items, bundle, allowed } = await load(projectId);
  if (!allowed) return NO_EDIT;
  if (!bundle.pillars.length) return { ok: false, error: "Add content pillars to the strategy first." };
  // pillar_assigned_by = 'ai' with no pillar means "AI checked it and no pillar fits": not sent again.
  const pending = items.filter((i) => !i.pillar_id && i.pillar_assigned_by !== "ai" && (i.caption || i.title || i.topic));
  const todo = pending.slice(0, 250);
  if (!todo.length) return { ok: true, data: { assigned: 0, unmatched: 0, remaining: 0 }, message: "Every post with text already has a pillar." };
  try {
    const refs = new Map(todo.map((i, k) => [`P${k + 1}`, i.id]));
    const out = await runStructured({
      feature: "history.pillar_classification",
      workspaceId: project.workspace_id,
      projectId,
      userId: user.id,
      system: PILLAR_SYSTEM_PROMPT,
      prompt: buildPillarPrompt(
        bundle.pillars.map((p) => ({ name: p.name, description: p.description })),
        todo.map((i, k) => ({ ref: `P${k + 1}`, text: [i.title, i.topic, i.caption].filter(Boolean).join(" — ") })),
      ),
      schema: pillarClassificationSchema,
      effort: "low",
    });
    const db = await createClient();
    let assigned = 0;
    const byPillar = new Map<string, string[]>();
    for (const a of out.assignments) {
      const id = refs.get(a.ref);
      const pillarId = byName(bundle.pillars, a.pillar);
      if (id && pillarId) byPillar.set(pillarId, [...(byPillar.get(pillarId) ?? []), id]);
    }
    for (const [pillarId, ids] of byPillar) {
      for (let k = 0; k < ids.length; k += 100) {
        const { error } = await db.from("historical_content_items").update({ pillar_id: pillarId, pillar_assigned_by: "ai" }).eq("project_id", projectId).is("pillar_id", null).in("id", ids.slice(k, k + 100));
        if (error) throw error;
      }
      assigned += ids.length;
    }
    const assignedIds = new Set([...byPillar.values()].flat());
    const unmatchedIds = todo.map((i) => i.id).filter((id) => !assignedIds.has(id));
    for (let k = 0; k < unmatchedIds.length; k += 100) {
      const { error } = await db.from("historical_content_items").update({ pillar_assigned_by: "ai" }).eq("project_id", projectId).is("pillar_id", null).in("id", unmatchedIds.slice(k, k + 100));
      if (error) throw error;
    }
    const remaining = pending.length - todo.length;
    refresh(projectId);
    return {
      ok: true,
      data: { assigned, unmatched: unmatchedIds.length, remaining },
      message: `${assigned} posts assigned to a pillar (AI); ${unmatchedIds.length} fit none${remaining ? `; ${remaining} left` : ""}`,
    };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

export async function setRecommendationStateAction(projectId: string, id: string, state: "new" | "in_progress" | "dismissed"): Promise<ActionResult> {
  if (!(await canEditProject(projectId))) return NO_EDIT;
  try {
    await setOpportunityState(projectId, [id], state);
    refresh(projectId);
    return { ok: true, message: state === "dismissed" ? "Recommendation dismissed" : state === "in_progress" ? "Recommendation saved" : "Restored" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update" };
  }
}

export type CalendarDraft = {
  start: string;
  end: string;
  items: (DraftItem & { rationale: string; pillar_name: string | null; issues: string[] })[];
  dropped: { title: string; reason: string }[];
  notes: { assumptions: string[]; questions: string[] };
};

/** Generates a draft calendar. Nothing is saved: the user reviews and edits it first. */
export async function generateCalendarDraftAction(projectId: string, request: CalendarRequest): Promise<ActionResult<CalendarDraft>> {
  const parsed = calendarRequestSchema.safeParse(request);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { user, project, items, bundle, channels, brand, stats, performance, citedIds, pillarName, allowed } = await load(projectId);
  if (!allowed) return NO_EDIT;
  const req = parsed.data;
  try {
    const days = (Date.parse(req.end) - Date.parse(req.start)) / 86400000 + 1;
    const expectedItems = Math.min(120, Math.max(1, Math.round(req.platforms.reduce((s, p) => s + p.perWeek, 0) * (days / 7))));
    const digest = historyDigest(items, pillarName, citedIds);
    const refOf = new Map([...digest.refs.entries()].map(([ref, id]) => [id, ref]));
    const opportunities = (await listHistoryOpportunities(projectId)).filter((o) => o.state !== "scheduled");
    const recRefs = new Map(opportunities.map((o, k) => [`R${k + 1}`, o.id]));
    const recText = opportunities
      .map((o, k) => `R${k + 1} [${o.insight_type}] ${o.title ?? o.idea} — ${o.rationale} (format: ${o.format ?? "-"}, timing: ${o.suggested_timing ?? "-"}${o.pillar_id ? `, pillar: ${pillarName(o.pillar_id)}` : ""})`)
      .join("\n");
    const out = await runStructured({
      feature: "history.calendar_generation",
      workspaceId: project.workspace_id,
      projectId,
      userId: user.id,
      system: HISTORY_SYSTEM_PROMPT,
      prompt: buildCalendarPrompt({
        context: buildProjectContext({ project, brand, channels, strategy: bundle }),
        stats: statsDigest(stats, (id) => refOf.get(id)),
        performance: performanceDigest(performance, (id) => refOf.get(id)),
        items: digest.text,
        start: req.start,
        end: req.end,
        platforms: req.platforms,
        expectedItems,
        windows: upcomingWindows(req.start, req.end).filter((w) => w.key !== "ramadan" || stats.seasons.some((s) => s.key === "ramadan")),
        recommendations: recText,
        instruction: req.instruction?.slice(0, 1000),
      }),
      schema: calendarDraftSchema,
    });

    const allowedPlatforms = new Set<Platform>(req.platforms.map((p) => p.platform));
    const dropped: CalendarDraft["dropped"] = [];
    const draftItems: CalendarDraft["items"] = [];
    for (const i of out.items) {
      // Out-of-scope items are reported to the user, never silently kept or removed.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date) || i.date < req.start || i.date > req.end) {
        dropped.push({ title: i.title, reason: `date ${i.date} is outside the requested period` });
        continue;
      }
      if (!allowedPlatforms.has(i.platform)) {
        dropped.push({ title: i.title, reason: `${PLATFORM_LABELS[i.platform]} was not selected` });
        continue;
      }
      const pillar_id = byName(bundle.pillars, i.pillar);
      const issues: string[] = [];
      if (i.pillar && !pillar_id) issues.push(`Pillar “${i.pillar}” is not in the strategy`);
      draftItems.push({
        scheduled_date: i.date,
        platform: i.platform,
        title: i.title.slice(0, 300),
        format: i.format || null,
        pillar_id,
        pillar_name: pillar_id ? pillarName(pillar_id) ?? null : null,
        campaign_id: byName(bundle.campaigns, i.campaign),
        funnel_stage: i.funnel_stage,
        hook: i.hook || null,
        creative_brief: i.brief ? stripRefs(i.brief) : null,
        cta: i.cta || null,
        marketing_objective: null,
        opportunity_id: i.recommendation ? recRefs.get(i.recommendation) ?? null : null,
        historical_source_id: i.repurpose_of ? digest.refs.get(i.repurpose_of) ?? null : null,
        rationale: stripRefs(i.rationale),
        issues,
      });
    }
    draftItems.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    return { ok: true, data: { start: req.start, end: req.end, items: draftItems, dropped, notes: out.notes } };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** Saves the reviewed draft as a new editorial calendar (items start as "planned"). */
export async function saveCalendarAction(projectId: string, payload: unknown): Promise<ActionResult<{ calendarId: string }>> {
  const parsed = saveCalendarSchema.safeParse(payload);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { user, bundle, items: history, allowed } = await load(projectId);
  if (!allowed) return NO_EDIT;
  const d = parsed.data;
  const pillarIds = new Set(bundle.pillars.map((p) => p.id));
  const campaignIds = new Set(bundle.campaigns.map((c) => c.id));
  const historyIds = new Set(history.map((h) => h.id));
  const opportunityIds = new Set((await listHistoryOpportunities(projectId)).map((o) => o.id));
  // One content item per opportunity (enforced by the production_guard trigger): the first item keeps the link,
  // and opportunities that already have content are not linked again.
  const taken = new Set((await linkedPosts(projectId)).map((p) => p.opportunity_id));
  for (const i of d.items) {
    if (i.scheduled_date < d.start || i.scheduled_date > d.end) return { ok: false, error: `“${i.title}” is dated outside the calendar period.` };
    if ((i.pillar_id && !pillarIds.has(i.pillar_id)) || (i.campaign_id && !campaignIds.has(i.campaign_id))) return { ok: false, error: "Unknown pillar or campaign." };
    if (i.historical_source_id && !historyIds.has(i.historical_source_id)) i.historical_source_id = null;
    if (i.opportunity_id && (!opportunityIds.has(i.opportunity_id) || taken.has(i.opportunity_id))) i.opportunity_id = null;
    if (i.opportunity_id) taken.add(i.opportunity_id);
  }
  try {
    const calendarId = await createCalendarWithItems(
      projectId,
      user.id,
      { name: d.name, starts_on: d.start, ends_on: d.end, settings: { ...d.settings, source: "historical_insights" } },
      d.items.map((i) => ({ ...i, caption: null })),
    );
    // planned drafts, not scheduled posts: the opportunity is in progress until its content is scheduled
    await setOpportunityState(projectId, [...new Set(d.items.map((i) => i.opportunity_id).filter((x): x is string => Boolean(x)))], "in_progress");
    refresh(projectId);
    return { ok: true, data: { calendarId }, message: `Calendar saved with ${d.items.length} items` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the calendar" };
  }
}

export async function deleteCalendarAction(projectId: string, calendarId: string): Promise<ActionResult> {
  if (!(await canEditProject(projectId))) return NO_EDIT;
  try {
    await deleteCalendar(projectId, calendarId);
    refresh(projectId);
    return { ok: true, message: "Calendar deleted" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete" };
  }
}
