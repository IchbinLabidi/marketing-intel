import "server-only";
import { canEdit, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { effortLevel } from "@/lib/editorial/optimizer";
import { contentTokens, normalizeText, stripRefs } from "@/lib/history/text";
import type { Signal } from "@/lib/opportunities/signals";
import { classify, computeScore, normalizeWeights, similarity } from "@/lib/opportunities/scoring";
import type { Opportunity, OpportunityEvidence } from "@/types/domain";
import { buildProjectContext } from "@/server/ai/context";
import type { GeneratedOpportunity } from "@/server/ai/opportunities";
import { listFeedback, listOpportunities } from "./opportunities";
import { loadSignals } from "./opportunity-signals";
import { getBrandProfile, getProjectContext } from "./projects";
import { requireUser } from "./session";

// Shared by the Content Opportunities module and the editorial calendar engine: everything one generation needs and
// the conversion of an AI idea into a stored, scored opportunity.

export const byName = <T extends { id: string; name: string }>(list: T[], name: string | null) =>
  name ? list.find((x) => normalizeText(x.name) === normalizeText(name))?.id ?? null : null;

/** Real posts → signals, strategy context, existing ideas, feedback, weights; plus recent post texts for freshness. */
export async function prepareOpportunities(projectId: string, period?: { start: string; end: string }) {
  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  const [{ project, bundle, channels, signals, pillarName, competitorData, serpData, items }, brand, existing, feedback] = await Promise.all([
    loadSignals(projectId),
    getBrandProfile(projectId),
    listOpportunities(projectId),
    listFeedback(projectId, 60),
  ]);
  const titleOf = new Map(existing.map((o) => [o.id, o.title ?? o.idea]));
  const ref = period?.start ?? new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(ref) - 90 * 86400000).toISOString().slice(0, 10);
  const recent = items
    .filter((i) => (i.actual_publication_date ?? i.publication_date ?? "") >= since)
    .map((i) => ({ text: [i.title, i.topic].filter(Boolean).join(" ") || (i.caption ?? "").slice(0, 160), tokens: new Set(contentTokens([i.title, i.topic, (i.caption ?? "").slice(0, 160)].filter(Boolean).join(" "))) }));
  const activeCampaigns = period ? bundle.campaigns.filter((c) => (!c.starts_on || c.starts_on <= period.end) && (!c.ends_on || c.ends_on >= period.start)) : bundle.campaigns;
  return {
    user, project, allowed: canEdit(role), bundle, signals, existing, pillarName, competitorData, serpData, recent, activeCampaigns,
    weights: normalizeWeights(project.opportunity_weights),
    context: buildProjectContext({ project, brand, channels, strategy: bundle }),
    feedbackForPrompt: feedback.map((f) => ({ title: titleOf.get(f.opportunity_id) ?? "?", kind: f.kind, note: f.note })),
  };
}
export type PreparedOpportunities = Awaited<ReturnType<typeof prepareOpportunities>>;

/** AI output → stored row: cited signals snapshot as evidence, class/confidence and every score computed here. */
export function opportunityRow(o: GeneratedOpportunity, ctx: PreparedOpportunities, focus: { pillar_id?: string | null; platform?: Platform | null; funnel_stage?: FunnelStage | null }) {
  const cited: Signal[] = [...new Set(o.signals)].map((k) => ctx.signals.find((s) => s.key === k)).filter((s): s is Signal => Boolean(s));
  const { insight_type, confidence, note } = classify(o.insight_type, cited);
  const campaign_id = byName(ctx.activeCampaigns, o.campaign);
  const tokens = new Set(contentTokens(`${o.title} ${o.angle}`));
  const closest = ctx.recent.map((r) => ({ r, s: similarity(tokens, r.tokens) })).sort((a, b) => b.s - a.s)[0];
  const { score, breakdown } = computeScore({
    cited, ai: o.ratings, weights: ctx.weights, competitorData: ctx.competitorData,
    extra: {
      serpData: ctx.serpData,
      campaign: { active: ctx.activeCampaigns.length, matched: campaign_id ? ctx.activeCampaigns.find((c) => c.id === campaign_id)?.name ?? null : null },
      freshness: { similarity: closest?.s ?? 0, closest: closest?.r.text ?? null },
      format: o.format,
    },
  });
  const evidence: OpportunityEvidence[] = cited.map((s) => ({
    type: s.category, signal: s.key, kind: s.kind, note: s.statement, method: s.method, period: s.period, metrics: s.metrics, ref_ids: s.ref_ids, n: s.n,
    ref_id: s.ref_ids[0] ?? null,
  }));
  const reasoning = [note, ...o.assumptions.map((a) => `Assumption: ${stripRefs(a)}`)].filter(Boolean).join("\n");
  if (reasoning) evidence.push({ type: "ai_reasoning", note: reasoning });
  return {
    title: stripRefs(o.title).slice(0, 300),
    idea: stripRefs(o.title).slice(0, 300),
    rationale: stripRefs(o.rationale),
    target_audience: o.target_audience,
    persona_id: byName(ctx.bundle.personas, o.persona),
    marketing_objective: o.business_objective?.slice(0, 300) || null,
    pillar_id: focus.pillar_id ?? byName(ctx.bundle.pillars, o.pillar),
    funnel_stage: focus.funnel_stage ?? o.funnel_stage,
    platform: focus.platform ?? o.platform,
    format: o.format,
    hook: o.hook,
    creative_angle: stripRefs(o.angle),
    cta: o.cta,
    campaign_id,
    production_effort: effortLevel(o.format),
    evidence,
    insight_type,
    confidence,
    opportunity_score: score,
    score_breakdown: breakdown,
    suggested_timing: o.suggested_timing,
    source: "opportunity_engine",
  } satisfies Partial<Opportunity> & { campaign_id: string | null; production_effort: string };
}
