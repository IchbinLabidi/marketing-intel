"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, FUNNEL_STAGES, LANGUAGES, PLATFORMS, type FunnelStage, type Language, type Platform } from "@/lib/domain/constants";
import { bestPublicationTimes, suggestedTime, WEEKDAY_LABELS } from "@/lib/calendar/insights";
import { zonedToUtc } from "@/lib/calendar/time";
import { KPI_LABELS, STAGE_KPI } from "@/lib/editorial/feedback";
import { optimizeCalendar } from "@/lib/editorial/optimizer";
import { addDays, buildSlots, OBJECTIVE_LABELS, OBJECTIVES, proposePlan, validatePlan, weekdayOf, type Plan, type Slot } from "@/lib/editorial/plan";
import { repetitionPairs, type RepFlag, type RepItem } from "@/lib/editorial/repetition";
import { assessSources } from "@/lib/editorial/sources";
import { upcomingWindows } from "@/lib/history/seasons";
import { engagementOf } from "@/lib/history/performance";
import { stripRefs } from "@/lib/history/text";
import { signalsDigest } from "@/lib/opportunities/signals";
import { isDuplicate } from "@/lib/opportunities/scoring";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { describeAIError } from "@/server/ai/client";
import { buildWeekPrompt, EDITORIAL_SYSTEM_PROMPT, REPETITION_SYSTEM_PROMPT, repetitionSchema, weekContentSchema, type PromptSlot, type WeekContent } from "@/server/ai/editorial";
import { buildOpportunitiesPrompt, OPPORTUNITY_SYSTEM_PROMPT, opportunitiesSchema } from "@/server/ai/opportunities";
import { runStructured } from "@/server/ai/run";
import { calendarAICost, engineItems, getEngineCalendar, publishedResults, recentContent, sourceCounts, type EngineItem } from "@/server/services/editorial";
import { insertOpportunities, linkedPosts, listOpportunities } from "@/server/services/opportunities";
import { opportunityRow, prepareOpportunities } from "@/server/services/opportunity-engine";
import { loadSignals } from "@/server/services/opportunity-signals";
import { getBrandProfile, getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

// The Editorial Intelligence Engine, step by step: plan (calculated) → opportunities (AI, scored) → content mix
// (edited by the user) → slots (calculated) → content per week (AI) → repetition + optimizer → approval.

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const fail = (e: unknown, fallback: string): ActionResult<never> => ({ ok: false, error: e instanceof Error ? e.message : fallback });
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  return { user, project, allowed: canEdit(role), tz: project.timezone || "Africa/Tunis" };
}

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
};

const startSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  platforms: z.array(z.object({ platform: z.enum(PLATFORMS), perWeek: z.number().min(0).max(21) })).min(1).max(6),
  objective: z.enum(OBJECTIVES),
  capacityPerWeek: z.number().int().min(1).max(100).nullish(),
  instruction: z.string().trim().max(1000).nullish(),
  customDates: z.array(z.object({ label: z.string().trim().min(1).max(80), date: z.iso.date() })).max(10).default([]),
});
export type StartCalendarInput = z.input<typeof startSchema>;

/** Data behind a plan: strategy, real format performance and timing, seasons; and the data-source report. */
async function planContext(projectId: string, input: z.infer<typeof startSchema>) {
  const { start, end } = monthRange(input.month);
  const [{ project, bundle, items, performance }, brand, counts] = await Promise.all([loadSignals(projectId), getBrandProfile(projectId), sourceCounts(projectId)]);
  const { results } = await publishedResults(projectId, items);
  const tz = project.timezone || "Africa/Tunis";
  const timing = bestPublicationTimes(items, tz);
  const bestDays = Object.fromEntries(timing.map((t) => [t.platform, t.weekdays.filter((w) => (w.lift ?? 0) > 1).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).map((w) => Number(w.key))]));
  const plan = proposePlan({
    start, end, objective: input.objective, platforms: input.platforms,
    pillars: bundle.pillars.map((p) => ({ id: p.id, name: p.name, target_share: p.target_share })),
    strategyFunnel: (bundle.strategy?.funnel ?? null) as Record<string, string> | null,
    campaigns: bundle.campaigns.map((c) => ({ id: c.id, name: c.name, starts_on: c.starts_on, ends_on: c.ends_on, funnel_focus: c.funnel_focus })),
    formatLift: performance.flatMap((p) => p.byFormat.filter((g) => g.lift != null).map((g) => ({ platform: p.platform, format: g.label, lift: g.lift!, n: g.n }))),
    bestDays,
    seasons: upcomingWindows(start, end).filter((w) => w.start <= end).map((w) => ({ label: w.label, start: w.start, end: w.end })),
    customDates: input.customDates.filter((d) => d.date >= start && d.date <= end).map((d) => ({ label: d.label, start: d.date, end: d.date, kind: "custom" as const })),
    capacityPerWeek: input.capacityPerWeek ?? null,
  });
  const withMetrics = items.filter((i) => engagementOf(i) != null);
  const sources = assessSources({
    brand, strategy: bundle.strategy as never, personas: bundle.personas.length,
    pillars: bundle.pillars.map((p) => ({ name: p.name, target_share: p.target_share })),
    campaigns: bundle.campaigns.map((c) => ({ name: c.name, starts_on: c.starts_on, ends_on: c.ends_on })),
    history: { posts: items.length, withMetrics: withMetrics.length, platforms: [...new Set(withMetrics.map((i) => i.platform).filter(Boolean) as string[])], lastDate: items.map((i) => i.actual_publication_date ?? i.publication_date).filter(Boolean).sort().at(-1) ?? null },
    competitors: counts.competitors, serp: counts.serp, importantDates: plan.dates.length, calendars: counts.calendars,
    published: { verified: counts.verified, withMetrics: results.filter((r) => r.value != null).length },
    period: { start, end },
  });
  return { plan, sources, start, end };
}

/** Steps 1–2: month, platforms, frequency and objective → a draft calendar with its proposed content mix. */
export async function startCalendarAction(projectId: string, input: StartCalendarInput): Promise<ActionResult<{ id: string }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const { plan, sources, start, end } = await planContext(projectId, parsed.data);
    const db = await createClient();
    const label = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const { data, error } = await db.from("editorial_calendars").insert({
      project_id: projectId, name: `Editorial calendar · ${label}`, starts_on: start, ends_on: end, status: "draft", objective: parsed.data.objective,
      plan, sources, created_by: user.id,
      settings: { engine: true, platforms: parsed.data.platforms, capacityPerWeek: parsed.data.capacityPerWeek ?? null, instruction: parsed.data.instruction ?? null, customDates: parsed.data.customDates },
    }).select("id").single();
    if (error) throw error;
    refresh(projectId);
    return { ok: true, data: { id: data.id as string }, message: "Plan proposed: review the opportunities and the content mix" };
  } catch (e) {
    return fail(e, "Could not start the calendar");
  }
}

/** Recomputes the proposed mix from the calendar's inputs (after strategy or data changes). */
export async function resetPlanAction(projectId: string, calendarId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const cal = await getEngineCalendar(projectId, calendarId);
    if (!cal || cal.status === "approved" || cal.status === "saved") return { ok: false, error: "This calendar can't be re-planned." };
    const s = cal.settings as { platforms: { platform: Platform; perWeek: number }[]; capacityPerWeek: number | null; customDates?: { label: string; date: string }[] };
    const { plan, sources } = await planContext(projectId, { month: cal.starts_on.slice(0, 7), platforms: s.platforms, objective: (cal.objective ?? "engagement") as Plan["objective"], capacityPerWeek: s.capacityPerWeek, customDates: s.customDates ?? [] });
    const db = await createClient();
    const { error } = await db.from("editorial_calendars").update({ plan, sources }).eq("project_id", projectId).eq("id", calendarId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Content mix recalculated" };
  } catch (e) {
    return fail(e, "Could not recalculate");
  }
}

const countRow = z.object({ count: z.number().int().min(0).max(200) }).passthrough();
const planSchema = z.object({
  platforms: z.array(countRow.extend({ platform: z.enum(PLATFORMS), perWeek: z.number().min(0).max(21) })),
  pillars: z.array(countRow.extend({ pillar_id: z.uuid() })),
  funnel: z.array(countRow.extend({ stage: z.enum(FUNNEL_STAGES) })),
  formats: z.array(countRow.extend({ platform: z.enum(PLATFORMS), format: z.string().trim().min(1).max(60) })),
  campaigns: z.array(countRow.extend({ campaign_id: z.uuid() })),
  capacityPerWeek: z.number().int().min(1).max(100).nullable(),
}).passthrough();

/** Step 4: the user's edited content mix. Every distribution must add up to the total. */
export async function savePlanAction(projectId: string, calendarId: string, edited: unknown): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = planSchema.safeParse(edited);
  if (!parsed.success) return { ok: false, error: "Invalid content mix." };
  try {
    const cal = await getEngineCalendar(projectId, calendarId);
    if (!cal?.plan || cal.status === "approved" || cal.status === "saved") return { ok: false, error: "This calendar's mix can't be edited." };
    const e = parsed.data;
    // structure and labels stay the calculated ones; only counts (and capacity, frequency) change
    const plan: Plan = {
      ...cal.plan,
      platforms: cal.plan.platforms.map((p) => { const x = e.platforms.find((y) => y.platform === p.platform); return x ? { ...p, count: x.count, perWeek: x.perWeek } : p; }),
      pillars: cal.plan.pillars.map((p) => ({ ...p, count: e.pillars.find((y) => y.pillar_id === p.pillar_id)?.count ?? p.count })),
      funnel: cal.plan.funnel.map((p) => ({ ...p, count: e.funnel.find((y) => y.stage === p.stage)?.count ?? p.count })),
      formats: cal.plan.formats.map((p) => ({ ...p, count: e.formats.find((y) => y.platform === p.platform && y.format === p.format)?.count ?? p.count })),
      campaigns: cal.plan.campaigns.map((p) => ({ ...p, count: e.campaigns.find((y) => y.campaign_id === p.campaign_id)?.count ?? p.count })),
      capacityPerWeek: e.capacityPerWeek,
    };
    plan.total = plan.platforms.reduce((t, p) => t + p.count, 0);
    const errors = validatePlan(plan);
    if (errors.length) return { ok: false, error: errors.join(" ") };
    const db = await createClient();
    const { error } = await db.from("editorial_calendars").update({ plan, status: cal.status === "draft" ? "planned" : cal.status }).eq("project_id", projectId).eq("id", calendarId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Content mix saved" };
  } catch (e) {
    return fail(e, "Could not save the mix");
  }
}

/** Step 3: AI content opportunities for this month (scored with evidence), attached to the calendar. */
export async function calendarOpportunitiesAction(projectId: string, calendarId: string, instruction?: string | null): Promise<ActionResult<{ created: number; skipped: number }>> {
  const cal = await getEngineCalendar(projectId, calendarId);
  if (!cal?.plan) return { ok: false, error: "Calendar not found." };
  const ctx = await prepareOpportunities(projectId, { start: cal.starts_on, end: cal.ends_on });
  if (!ctx.allowed) return NO_EDIT;
  if (!ctx.bundle.pillars.length) return { ok: false, error: "Add content pillars to the strategy first: opportunities are built on them." };
  const plan = cal.plan;
  const count = Math.min(12, Math.max(6, Math.ceil(plan.total / 2)));
  const platforms = plan.platforms.filter((p) => p.count > 0).map((p) => p.platform);
  try {
    const out = await runStructured({
      feature: "editorial.opportunities", workspaceId: ctx.project.workspace_id, projectId, userId: ctx.user.id, calendarId,
      system: OPPORTUNITY_SYSTEM_PROMPT, schema: opportunitiesSchema,
      prompt: buildOpportunitiesPrompt({
        context: ctx.context,
        // only signals relevant to the calendar's platforms (plus cross-platform ones): no full history is sent
        signals: signalsDigest(ctx.signals.filter((s) => !s.platform || platforms.includes(s.platform)), ctx.pillarName),
        existing: ctx.existing.map((o) => ({ title: o.title ?? o.idea, platform: o.platform, state: o.state })),
        feedback: ctx.feedbackForPrompt,
        count,
        focus: {
          pillar: null, platform: null, funnel: null,
          instruction: [
            `Opportunities for the editorial calendar of ${cal.starts_on} → ${cal.ends_on} on ${platforms.join(", ")}. Business objective: ${OBJECTIVE_LABELS[(cal.objective ?? "engagement") as Plan["objective"]]}.`,
            ctx.activeCampaigns.length ? `Active campaigns: ${ctx.activeCampaigns.map((c) => `${c.name}${c.objective ? ` (${c.objective})` : ""}`).join("; ")}.` : "No active campaign.",
            plan.dates.length ? `Important dates: ${plan.dates.map((d) => `${d.label} ${d.start}${d.end !== d.start ? `→${d.end}` : ""}`).join("; ")}.` : "",
            `Only these platforms: ${platforms.join(", ")}.`,
            instruction ?? (cal.settings as { instruction?: string | null }).instruction ?? "",
          ].filter(Boolean).join(" "),
        },
      }),
    });
    const generationId = crypto.randomUUID();
    const kept: ReturnType<typeof opportunityRow>[] = [];
    let skipped = 0;
    for (const o of out.opportunities) {
      if (!platforms.includes(o.platform)) { skipped++; continue; }
      const row = opportunityRow(o, ctx, {});
      if (isDuplicate(row, [...ctx.existing, ...kept])) { skipped++; continue; }
      kept.push(row);
    }
    await insertOpportunities(projectId, kept.map((r) => ({ ...r, generation_id: generationId, state: "new", calendar_id: calendarId, focus: { instruction: `Editorial calendar ${cal.starts_on} → ${cal.ends_on}` } })));
    refresh(projectId);
    return { ok: true, data: { created: kept.length, skipped }, message: `${kept.length} opportunities${skipped ? ` (${skipped} duplicates or off-plan skipped)` : ""}` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** Attach a backlog opportunity to the calendar, or detach one (it stays in the backlog). */
export async function attachOpportunityAction(projectId: string, calendarId: string, opportunityId: string, attach: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error, count } = await db.from("opportunities").update({ calendar_id: attach ? calendarId : null }, { count: "exact" }).eq("project_id", projectId).eq("id", opportunityId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Opportunity not found." };
    refresh(projectId);
    return { ok: true, message: attach ? "Added to this calendar" : "Removed from this calendar" };
  } catch (e) {
    return fail(e, "Could not update");
  }
}

// --- Generation -------------------------------------------------------------------------------------------------

type Scope = { kind: "all" } | { kind: "week"; start: string } | { kind: "post"; id: string };

const isArticle = (platform: Platform, format: string) => platform === "blog" || /article|landing|faq|resource|cluster/i.test(format);

/** Opportunity per slot: best unused one on the same platform, preferring the same pillar, funnel stage and format. */
function assignOpportunities(slots: Slot[], opps: { id: string; platform: string | null; pillar_id: string | null; funnel_stage: string | null; format: string | null; opportunity_score: number | null }[]) {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const s of slots) {
    const best = opps
      .filter((o) => !used.has(o.id) && (!o.platform || o.platform === s.platform))
      .map((o) => ({ o, fit: (o.platform === s.platform ? 3 : 0) + (o.pillar_id && o.pillar_id === s.pillar_id ? 2 : 0) + (o.funnel_stage === s.funnel_stage ? 1 : 0) + (o.format && o.format.toLowerCase() === s.format.toLowerCase() ? 1 : 0) + (o.opportunity_score ?? 40) / 100 }))
      .sort((a, b) => b.fit - a.fit)[0];
    if (best && best.fit >= 4) { used.add(best.o.id); out.set(s.key, best.o.id); }
  }
  return out;
}

/**
 * Steps 5–6: writes posts for the plan's slots (all, one week, or one post). Locked posts are never touched and
 * their slots count towards the plan. AI content is produced first; unlocked posts are only replaced once it's ready.
 */
export async function generateCalendarAction(projectId: string, calendarId: string, scope: Scope, instruction?: string | null): Promise<ActionResult<{ created: number; cost: number }>> {
  const { user, project, allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const cal = await getEngineCalendar(projectId, calendarId);
  if (!cal?.plan) return { ok: false, error: "Calendar not found." };
  if (cal.status === "approved" || cal.status === "saved") return { ok: false, error: "This calendar is approved: edit posts in the calendar or production instead." };
  const errors = validatePlan(cal.plan);
  if (errors.length) return { ok: false, error: `Fix the content mix first: ${errors[0]}` };
  try {
    const plan = cal.plan;
    const items = await engineItems(projectId, calendarId);
    const editable = (i: EngineItem) => !i.locked && (i.status === "planned" || i.status === "idea");
    let replace: EngineItem[];
    let slots: Slot[];
    if (scope.kind === "all") {
      replace = items.filter(editable);
      const kept = items.filter((i) => !editable(i));
      slots = buildSlots(plan, kept.filter((i) => i.scheduled_date && i.platform).map((i) => ({ date: i.scheduled_date!, platform: i.platform!, pillar_id: i.pillar_id, funnel_stage: i.funnel_stage, format: i.format, campaign_id: i.campaign_id })));
    } else {
      const end = scope.kind === "week" ? addDays(scope.start, 6) : null;
      replace = items.filter((i) => editable(i) && (scope.kind === "post" ? i.id === scope.id : i.scheduled_date != null && i.scheduled_date >= scope.start && i.scheduled_date <= end!));
      if (!replace.length) return { ok: false, error: scope.kind === "post" ? "This post is locked or already in production." : "No unlocked post in this week." };
      // keep each post's slot (date, platform, pillar, funnel, format, campaign): only the content changes
      slots = replace.map((i, k) => ({ key: `P${k + 1}`, date: i.scheduled_date ?? cal.starts_on, platform: i.platform ?? "instagram", pillar_id: i.pillar_id, funnel_stage: i.funnel_stage ?? "awareness", format: i.format ?? "Image post", campaign_id: i.campaign_id, occasion: plan.dates.find((d) => i.scheduled_date && i.scheduled_date >= d.start && i.scheduled_date <= d.end)?.label ?? null }));
    }
    if (!slots.length) return { ok: false, error: "Every slot of the plan is already filled by a locked post." };

    const ctx = await prepareOpportunities(projectId, { start: cal.starts_on, end: cal.ends_on });
    const freed = new Set(replace.map((i) => i.opportunity_id).filter(Boolean) as string[]);
    const candidates = (await listOpportunities(projectId)).filter((o) => o.calendar_id === calendarId && o.state !== "dismissed");
    // one content item per opportunity (database rule): skip those linked to a post that is not being replaced
    const linked = await linkedPosts(projectId, candidates.map((o) => o.id));
    const linkedElsewhere = new Set(linked.filter((p) => !replace.some((r) => r.id === p.id)).map((p) => p.opportunity_id));
    const opps = candidates.filter((o) => !linkedElsewhere.has(o.id) || freed.has(o.id));
    const oppFor = assignOpportunities(slots, opps);
    const oppKey = new Map([...new Set(oppFor.values())].map((id, k) => [id, `O${k + 1}`]));
    const pillarName = (id: string | null) => (id ? ctx.pillarName(id) ?? null : null);
    const campaignName = (id: string | null) => (id ? ctx.bundle.campaigns.find((c) => c.id === id)?.name ?? null : null);
    const { learnings } = await publishedResults(projectId, (await loadSignals(projectId)).items);
    const missing = (cal.sources ?? []).filter((s) => s.status === "missing").map((s) => `- ${s.label}: ${s.detail}`);
    const recent = await recentContent(projectId, addDays(cal.starts_on, -180), calendarId);
    const timing = bestPublicationTimes((await loadSignals(projectId)).items, tz);

    // one AI call per week (≤ 14 slots), at most 2 at a time; only the signals for that week's platforms/pillars/formats
    const weeks = new Map<string, Slot[]>();
    for (const s of slots) { const w = addDays(cal.starts_on, Math.floor((Date.parse(s.date) - Date.parse(cal.starts_on)) / 86400000 / 7) * 7); weeks.set(w, [...(weeks.get(w) ?? []), s]); }
    const batches = [...weeks.values()].flatMap((list) => (list.length > 14 ? [list.slice(0, 14), list.slice(14)] : [list]));
    const otherPlanned = items.filter((i) => !replace.includes(i)).map((i) => `${i.scheduled_date ?? ""} ${i.platform ?? ""}: ${i.title}${i.content_angle ? ` — ${i.content_angle}` : ""}`);
    const results: { slot: Slot; c: WeekContent }[] = [];
    const runBatch = async (batch: Slot[]) => {
      const relevant = ctx.signals.filter((s) => (!s.platform || batch.some((b) => b.platform === s.platform)) && (!s.pillar_id || batch.some((b) => b.pillar_id === s.pillar_id)) && (!s.format || batch.some((b) => b.format.toLowerCase() === s.format!.toLowerCase())));
      const oppLines = batch.map((s) => oppFor.get(s.key)).filter(Boolean).map((id) => { const o = opps.find((x) => x.id === id)!; return `${oppKey.get(id!)} | ${o.title ?? o.idea} — ${o.rationale}${o.hook ? ` | hook: ${o.hook}` : ""}${o.creative_angle ? ` | angle: ${o.creative_angle}` : ""}${o.cta ? ` | CTA: ${o.cta}` : ""}`; });
      const prompt = buildWeekPrompt({
        context: ctx.context, objective: OBJECTIVE_LABELS[(cal.objective ?? "engagement") as Plan["objective"]],
        signals: signalsDigest(relevant, ctx.pillarName),
        learnings: learnings.map((l) => `- ${l.statement}`).join("\n"),
        opportunities: [...new Set(oppLines)].join("\n"),
        slots: batch.map((s): PromptSlot => ({ key: s.key, date: s.date, weekday: WEEKDAY_LABELS[weekdayOf(s.date)], platform: s.platform, format: s.format, pillar: pillarName(s.pillar_id), funnel: s.funnel_stage, campaign: campaignName(s.campaign_id), occasion: s.occasion, opportunity: oppFor.has(s.key) ? oppKey.get(oppFor.get(s.key)!)! : null, kpi: KPI_LABELS[STAGE_KPI[s.funnel_stage]].toLowerCase() })),
        recent: recent.map((r) => `${r.date ?? ""} ${r.platform ?? ""}: ${r.title}${r.hook ? ` | hook: ${r.hook}` : ""}`),
        planned: [...otherPlanned, ...results.map((r) => `${r.slot.date} ${r.slot.platform}: ${r.c.title} — ${r.c.angle}`)],
        instruction: instruction ?? (cal.settings as { instruction?: string | null }).instruction ?? null,
        missing,
      });
      const out = await runStructured({ feature: scope.kind === "post" ? "editorial.regenerate_post" : "editorial.generate_week", workspaceId: project.workspace_id, projectId, userId: user.id, calendarId, system: EDITORIAL_SYSTEM_PROMPT, prompt, schema: weekContentSchema });
      for (const s of batch) {
        const c = out.items.find((x) => x.slot === s.key);
        if (c) results.push({ slot: s, c });
      }
    };
    for (let k = 0; k < batches.length; k += 2) await Promise.all(batches.slice(k, k + 2).map(runBatch));
    if (!results.length) return { ok: false, error: "The AI returned no usable post. Try again." };

    // Replace the unlocked posts (content is ready), then insert the new ones
    const db = await createClient();
    if (replace.length) {
      const { error } = await db.from("content_items").delete().eq("project_id", projectId).in("id", replace.map((i) => i.id));
      if (error) throw error;
    }
    const language = (LANGUAGES as readonly string[]).includes(project.default_language) ? (project.default_language as Language) : "fr";
    const rows = results.map(({ slot: s, c }, position) => {
      const time = suggestedTime(timing.find((t) => t.platform === s.platform), weekdayOf(s.date));
      const article = isArticle(s.platform, s.format);
      return {
        project_id: projectId, calendar_id: calendarId, created_by: user.id, status: "planned", position,
        opportunity_id: oppFor.get(s.key) ?? null, scheduled_date: s.date, scheduled_time: time, scheduled_at: time ? zonedToUtc(s.date, time, tz) : null,
        platform: s.platform, format: s.format, pillar_id: s.pillar_id, campaign_id: s.campaign_id, funnel_stage: s.funnel_stage as FunnelStage,
        marketing_objective: OBJECTIVE_LABELS[(cal.objective ?? "engagement") as Plan["objective"]],
        title: stripRefs(c.title).slice(0, 300), topic: stripRefs(c.topic).slice(0, 300), hook: c.hook, content_angle: stripRefs(c.angle), cta: c.cta,
        caption: article ? null : c.caption, creative_brief: article ? c.caption : null, hashtags: c.hashtags.map((h) => h.replace(/^#*/, "")).filter(Boolean).slice(0, 30),
        visual_direction: c.creative_direction, rationale: stripRefs(c.rationale) + (c.signals.length ? "" : " (strategy-based, not performance-validated)"),
        format_details: c.reel ? { kind: "reel", ...c.reel } : c.carousel ? { kind: "carousel", ...c.carousel } : c.story ? { kind: "story", ...c.story } : c.article ? { kind: "article", ...c.article } : null,
        objective_kpi: STAGE_KPI[s.funnel_stage], language,
      };
    });
    const ins = await db.from("content_items").insert(rows);
    if (ins.error) throw ins.error;
    await db.from("editorial_calendars").update({ status: "generated" }).eq("project_id", projectId).eq("id", calendarId);
    await checkCalendar(projectId, calendarId, { userId: user.id, workspaceId: project.workspace_id });
    refresh(projectId);
    const cost = await calendarAICost(calendarId);
    return { ok: true, data: { created: rows.length, cost: cost.cost }, message: `${rows.length} post${rows.length > 1 ? "s" : ""} written${replace.length ? ` (${replace.length} replaced, locked posts kept)` : ""}` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** Repetition (exact + AI-judged semantic) and optimizer checks; stores flags on posts and the report on the calendar. */
async function checkCalendar(projectId: string, calendarId: string, ai: { userId: string; workspaceId: string } | null) {
  const cal = await getEngineCalendar(projectId, calendarId);
  if (!cal?.plan) return;
  const items = await engineItems(projectId, calendarId);
  const prior = await recentContent(projectId, addDays(cal.starts_on, -180), calendarId);
  const asRep = (i: EngineItem): RepItem => ({ id: i.id, date: i.scheduled_date, platform: i.platform, title: i.title, topic: i.topic, hook: i.hook, angle: i.content_angle, caption: i.caption, format: i.format });
  const pairs = repetitionPairs(items.map(asRep), prior);
  const titleOf = new Map([...items.map((i) => [i.id, i.title] as const), ...prior.map((p) => [p.id, p.title] as const)]);
  const flags = new Map<string, RepFlag[]>();
  const flag = (a: string, b: string, kind: RepFlag["kind"], similarity: number, note: string) => {
    // the later (or the calendar's) post carries the flag
    flags.set(a, [...(flags.get(a) ?? []), { with: b, with_title: titleOf.get(b) ?? "", kind, similarity: Math.round(similarity * 100) / 100, note }]);
  };
  for (const p of pairs.filter((x) => x.kind === "exact")) flag(p.scope === "calendar" ? p.b : p.a, p.scope === "calendar" ? p.a : p.b, "exact", p.similarity, "Same wording as another post.");
  const possible = pairs.filter((x) => x.kind === "possible");
  if (ai && possible.length) {
    try {
      const textOf = (id: string) => { const i = items.find((x) => x.id === id) ?? prior.find((x) => x.id === id); if (!i) return "?"; const it = i as Partial<EngineItem & RepItem>; return `${it.platform ?? ""} ${it.format ?? ""}: ${i.title}${it.topic ? ` | topic: ${it.topic}` : ""}${it.hook ? ` | hook: ${it.hook}` : ""}${(it as EngineItem).content_angle ?? it.angle ? ` | angle: ${(it as EngineItem).content_angle ?? it.angle}` : ""}`; };
      const out = await runStructured({
        feature: "editorial.repetition", workspaceId: ai.workspaceId, projectId, userId: ai.userId, calendarId, system: REPETITION_SYSTEM_PROMPT, schema: repetitionSchema, effort: "low",
        prompt: possible.map((p, k) => `R${k + 1}\n  first: ${textOf(p.b)}\n  second: ${textOf(p.a)}`).join("\n"),
      });
      out.pairs.forEach((r) => {
        const p = possible[Number(r.pair.replace(/\D/g, "")) - 1];
        if (p && r.verdict === "repeat") flag(p.scope === "calendar" ? p.b : p.a, p.scope === "calendar" ? p.a : p.b, "semantic", p.similarity, r.note);
      });
    } catch {
      // the semantic check is optional: exact repeats are still flagged
    }
  }
  const db = await createClient();
  for (const i of items) {
    const next = flags.get(i.id) ?? null;
    if (JSON.stringify(next) !== JSON.stringify(i.repetition ?? null) && !i.locked && i.status !== "published") await db.from("content_items").update({ repetition: next }).eq("project_id", projectId).eq("id", i.id);
  }
  const fresh = await engineItems(projectId, calendarId);
  const bundle = (await loadSignals(projectId)).bundle;
  const checks = optimizeCalendar(
    fresh.map((i) => ({ id: i.id, title: i.title, date: i.scheduled_date, platform: i.platform, pillar_id: i.pillar_id, funnel_stage: i.funnel_stage, format: i.format, campaign_id: i.campaign_id, topic: i.topic, hook: i.hook, angle: i.content_angle, locked: i.locked, repetition: i.repetition })),
    cal.plan,
    (id) => bundle.pillars.find((p) => p.id === id)?.name ?? "?",
    (id) => bundle.campaigns.find((c) => c.id === id)?.name ?? "?",
  );
  await db.from("editorial_calendars").update({ optimizer: { checks, at: new Date().toISOString() } }).eq("project_id", projectId).eq("id", calendarId);
}

/** Re-runs the checks after manual edits (dates, deletions). `semantic` also asks the cheap model about close pairs. */
export async function recheckCalendarAction(projectId: string, calendarId: string, semantic = false): Promise<ActionResult> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    await checkCalendar(projectId, calendarId, semantic ? { userId: user.id, workspaceId: project.workspace_id } : null);
    refresh(projectId);
    return { ok: true, message: "Calendar checked" };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

export async function setLockedAction(projectId: string, itemId: string, locked: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error, count } = await db.from("content_items").update({ locked }, { count: "exact" }).eq("project_id", projectId).eq("id", itemId);
    if (error) throw error;
    if (!count) return { ok: false, error: "Post not found." };
    refresh(projectId);
    return { ok: true, message: locked ? "Locked: regeneration keeps this post" : "Unlocked" };
  } catch (e) {
    return fail(e, "Could not update");
  }
}

/** Step 7: approve the calendar and move its planned posts into production (Brief stage). Nothing is scheduled or published. */
export async function approveCalendarAction(projectId: string, calendarId: string): Promise<ActionResult<{ moved: number }>> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const cal = await getEngineCalendar(projectId, calendarId);
    if (!cal || cal.status !== "generated") return { ok: false, error: "Generate the calendar before approving it." };
    const db = await createClient();
    const { data, error } = await db.from("content_items").update({ status: "brief_ready" }).eq("project_id", projectId).eq("calendar_id", calendarId).eq("status", "planned").select("id");
    if (error) throw error;
    const up = await db.from("editorial_calendars").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("project_id", projectId).eq("id", calendarId);
    if (up.error) throw up.error;
    refresh(projectId);
    return { ok: true, data: { moved: data?.length ?? 0 }, message: `Calendar approved: ${data?.length ?? 0} posts moved to production (Brief)` };
  } catch (e) {
    return fail(e, "Could not approve");
  }
}

/** Deletes a calendar that isn't approved, with its draft posts (posts already in production are kept, unlinked). */
export async function deleteEngineCalendarAction(projectId: string, calendarId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const cal = await getEngineCalendar(projectId, calendarId);
    if (!cal || cal.status === "approved" || cal.status === "saved") return { ok: false, error: "Only calendars that are not approved can be deleted here." };
    const db = await createClient();
    const items = await db.from("content_items").delete().eq("project_id", projectId).eq("calendar_id", calendarId).in("status", ["planned", "idea"]);
    if (items.error) throw items.error;
    await db.from("opportunities").update({ calendar_id: null }).eq("project_id", projectId).eq("calendar_id", calendarId);
    const { error } = await db.from("editorial_calendars").delete().eq("project_id", projectId).eq("id", calendarId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Calendar deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}
