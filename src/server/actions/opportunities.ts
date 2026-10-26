"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, FUNNEL_STAGES, PLATFORMS } from "@/lib/domain/constants";
import { signalsDigest } from "@/lib/opportunities/signals";
import { DIMENSIONS, isDuplicate, normalizeWeights, rescore, type FeedbackKind, type Weights } from "@/lib/opportunities/scoring";
import type { ActionResult } from "@/lib/validation/common";
import type { Opportunity, OpportunityState } from "@/types/domain";
import { describeAIError } from "@/server/ai/client";
import { buildOpportunitiesPrompt, OPPORTUNITY_SYSTEM_PROMPT, opportunitiesSchema, singleOpportunitySchema } from "@/server/ai/opportunities";
import { runStructured } from "@/server/ai/run";
import {
  evidencePosts, getOpportunity, insertFeedback, insertOpportunities, linkedPosts, listOpportunities,
  setOpportunitiesState, setProjectWeights, updateOpportunity,
} from "@/server/services/opportunities";
import { opportunityRow, prepareOpportunities } from "@/server/services/opportunity-engine";
import { competitorPostsByIds } from "@/server/services/competitors";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

const focusSchema = z.object({
  count: z.number().int().min(3).max(12).default(8),
  pillar_id: z.uuid().nullish(),
  platform: z.enum(PLATFORMS).nullish(),
  funnel_stage: z.enum(FUNNEL_STAGES).nullish(),
  instruction: z.string().trim().max(1000).nullish(),
});
export type GenerateOpportunitiesInput = z.input<typeof focusSchema>;

const prepare = (projectId: string) => prepareOpportunities(projectId);
const toRow = opportunityRow;

export async function generateOpportunitiesAction(projectId: string, input: GenerateOpportunitiesInput): Promise<ActionResult<{ created: number; skipped: number }>> {
  const parsed = focusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const f = parsed.data;
  const ctx = await prepare(projectId);
  if (!ctx.allowed) return NO_EDIT;
  if (!ctx.bundle.pillars.length) return { ok: false, error: "Add content pillars to the strategy first: opportunities are built on them." };
  try {
    const out = await runStructured({
      feature: "opportunities.generate",
      workspaceId: ctx.project.workspace_id,
      projectId,
      userId: ctx.user.id,
      system: OPPORTUNITY_SYSTEM_PROMPT,
      prompt: buildOpportunitiesPrompt({
        context: ctx.context,
        signals: signalsDigest(ctx.signals, ctx.pillarName),
        existing: ctx.existing.map((o) => ({ title: o.title ?? o.idea, platform: o.platform, state: o.state })),
        feedback: ctx.feedbackForPrompt,
        count: f.count,
        focus: { pillar: f.pillar_id ? ctx.pillarName(f.pillar_id) ?? null : null, platform: f.platform ?? null, funnel: f.funnel_stage ?? null, instruction: f.instruction ?? null },
      }),
      schema: opportunitiesSchema,
    });
    const generationId = crypto.randomUUID();
    const kept: ReturnType<typeof toRow>[] = [];
    let skipped = 0;
    for (const o of out.opportunities) {
      const row = toRow(o, ctx, f);
      // near-identical to an existing (any status, dismissed included) or to another idea of this batch
      if (isDuplicate(row, [...ctx.existing, ...kept])) { skipped++; continue; }
      kept.push(row);
    }
    await insertOpportunities(projectId, kept.map((r) => ({ ...r, generation_id: generationId, state: "new", focus: { pillar_id: f.pillar_id ?? null, platform: f.platform ?? null, funnel_stage: f.funnel_stage ?? null, instruction: f.instruction ?? null } })));
    refresh(projectId);
    return { ok: true, data: { created: kept.length, skipped }, message: `${kept.length} opportunities added${skipped ? ` (${skipped} near-duplicates skipped)` : ""}` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** Regenerate (new angle) or refine (with an instruction) one opportunity, in place. */
export async function regenerateOpportunityAction(projectId: string, id: string, instruction?: string | null): Promise<ActionResult<{ opportunity: Opportunity }>> {
  const ctx = await prepare(projectId);
  if (!ctx.allowed) return NO_EDIT;
  const current = ctx.existing.find((o) => o.id === id);
  if (!current) return { ok: false, error: "Opportunity not found." };
  if (current.state === "scheduled" || current.state === "published") return { ok: false, error: "It is already in the calendar: edit the post there instead." };
  try {
    const out = await runStructured({
      feature: instruction ? "opportunities.refine" : "opportunities.regenerate",
      workspaceId: ctx.project.workspace_id,
      projectId,
      userId: ctx.user.id,
      system: OPPORTUNITY_SYSTEM_PROMPT,
      prompt: buildOpportunitiesPrompt({
        context: ctx.context,
        signals: signalsDigest(ctx.signals, ctx.pillarName),
        existing: ctx.existing.filter((o) => o.id !== id).map((o) => ({ title: o.title ?? o.idea, platform: o.platform, state: o.state })),
        feedback: ctx.feedbackForPrompt,
        count: 1,
        focus: { pillar: null, platform: null, funnel: null, instruction: null },
        target: { title: current.title ?? current.idea, rationale: current.rationale, hook: current.hook, angle: current.creative_angle, instruction: instruction?.slice(0, 1000) ?? null },
      }),
      schema: singleOpportunitySchema,
      effort: "low",
    });
    const row = toRow(out.opportunity, ctx, {});
    if (isDuplicate(row, ctx.existing.filter((o) => o.id !== id))) return { ok: false, error: "The new version is too close to another opportunity. Try again with a more specific instruction." };
    const opportunity = await updateOpportunity(projectId, id, { ...row, state: "new", status_changed_at: new Date().toISOString() });
    refresh(projectId);
    return { ok: true, data: { opportunity }, message: instruction ? "Opportunity refined" : "New angle generated" };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** Manual status changes. "Added to calendar" and "Published" follow the linked calendar post and can't be set here. */
export async function setOpportunityStateAction(projectId: string, id: string, state: Extract<OpportunityState, "new" | "in_progress" | "dismissed">): Promise<ActionResult> {
  await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  if (!["new", "in_progress", "dismissed"].includes(state)) return { ok: false, error: "Invalid status." };
  try {
    const current = await getOpportunity(projectId, id);
    if (!current) return { ok: false, error: "Opportunity not found." };
    if ((current.state === "scheduled" || current.state === "published") && state !== "dismissed") return { ok: false, error: "Its status follows the calendar post." };
    await setOpportunitiesState(projectId, [id], state);
    refresh(projectId);
    return { ok: true, message: state === "dismissed" ? "Dismissed" : state === "in_progress" ? "Marked in progress" : "Restored" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update" };
  }
}

const FEEDBACK_KINDS = ["useful", "not_relevant", "already_covered", "not_aligned", "different_angle"] as const satisfies readonly FeedbackKind[];

/**
 * Stores feedback. It is used (1) in later generation prompts, (2) to adjust relevance of similar ideas
 * (same pillar / format). Negative feedback also dismisses the idea; "different angle" is followed by a regeneration.
 */
export async function opportunityFeedbackAction(projectId: string, id: string, kind: FeedbackKind, note?: string | null): Promise<ActionResult> {
  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Invalid feedback." };
  try {
    const current = await getOpportunity(projectId, id);
    if (!current) return { ok: false, error: "Opportunity not found." };
    await insertFeedback(projectId, { opportunity_id: id, user_id: user.id, kind, note: note?.trim().slice(0, 1000) || null });
    if (["not_relevant", "already_covered", "not_aligned"].includes(kind) && current.state === "new") await setOpportunitiesState(projectId, [id], "dismissed");
    refresh(projectId);
    return { ok: true, message: kind === "useful" ? "Thanks: similar ideas will rank higher" : kind === "different_angle" ? "Feedback saved" : "Feedback saved; the idea was dismissed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save feedback" };
  }
}

/** Saves the project's weights and recomputes every stored score from its dimension scores. */
export async function saveWeightsAction(projectId: string, raw: Partial<Weights>): Promise<ActionResult<{ rescored: number }>> {
  await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  const weights = normalizeWeights(raw);
  if (DIMENSIONS.every((d) => !weights[d])) return { ok: false, error: "At least one weight must be above 0." };
  try {
    await setProjectWeights(projectId, weights);
    const all = await listOpportunities(projectId);
    let rescored = 0;
    for (const o of all) {
      if (!o.score_breakdown?.dimensions) continue;
      const r = rescore(o.score_breakdown, weights);
      if (r.score !== o.opportunity_score) {
        await updateOpportunity(projectId, o.id, { opportunity_score: r.score, score_breakdown: r.breakdown });
        rescored++;
      }
    }
    refresh(projectId);
    return { ok: true, data: { rescored }, message: `Weights saved${rescored ? `; ${rescored} scores updated` : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save weights" };
  }
}

/** Supporting posts of an opportunity's evidence (project-scoped), and its calendar post if any. */
export async function opportunityEvidenceAction(projectId: string, id: string) {
  await requireUser();
  await getProjectContext(projectId); // 404 for non-members
  const o = await getOpportunity(projectId, id);
  if (!o) return { ok: false as const, error: "Opportunity not found." };
  const idsOf = (pred: (type: string) => boolean) => o.evidence.filter((e) => pred(e.type)).flatMap((e) => e.ref_ids ?? (e.ref_id ? [e.ref_id] : []));
  const [own, competitor, linked] = await Promise.all([
    evidencePosts(projectId, idsOf((t) => t !== "competitor")),
    competitorPostsByIds(projectId, idsOf((t) => t === "competitor")),
    linkedPosts(projectId, [id]),
  ]);
  // competitor posts in the same shape as our own posts, with their original link and competitor name
  const posts = [
    ...own,
    ...competitor.map((p) => ({
      id: p.id, platform: p.platform, title: `${(p.competitors as unknown as { name: string } | null)?.name ?? "Competitor"}: ${p.hook ?? p.caption?.slice(0, 80) ?? ""}`,
      caption: p.caption, format: p.format, publication_date: null, actual_publication_date: null, published_at: p.published_at,
      permalink: p.url, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, reach: null, views: p.views, pillar_id: null, topic: null,
    })),
  ];
  return { ok: true as const, posts, linked };
}
