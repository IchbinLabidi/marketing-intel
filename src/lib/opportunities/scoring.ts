import type { InsightType } from "@/lib/domain/constants";
import { contentTokens } from "@/lib/history/text";
import type { Signal } from "./signals";

// Transparent opportunity scoring. Two dimensions are calculated from cited signals (historical performance, content
// gap); the others are AI judgments with a written reason, labelled as such. Missing data never invents a number:
// historical performance falls back to a neutral 50 and lowers confidence; differentiation is excluded (its weight
// redistributed) when the project has no competitor data.

export const DIMENSIONS = ["historical", "strategic", "audience", "gap", "platform", "differentiation", "search", "campaign", "freshness", "effort"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  historical: "Historical performance",
  strategic: "Strategic alignment",
  audience: "Audience relevance",
  gap: "Content gap",
  platform: "Platform suitability",
  differentiation: "Competitor differentiation",
  search: "Search demand",
  campaign: "Campaign relevance",
  freshness: "Content freshness",
  effort: "Production effort (lower is better)",
};

export type Weights = Record<Dimension, number>;
export const DEFAULT_WEIGHTS: Weights = { historical: 20, strategic: 15, audience: 15, gap: 10, platform: 10, differentiation: 10, search: 5, campaign: 5, freshness: 5, effort: 5 };
/** Score cap when no data signal (≥3 posts or a SERP analysis) supports an idea: AI judgment alone can't rank it high. */
export const UNSUPPORTED_CAP = 60;

export function normalizeWeights(raw: unknown): Weights {
  const w = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === "object") {
    for (const d of DIMENSIONS) {
      const v = Number((raw as Record<string, unknown>)[d]);
      if (Number.isFinite(v) && v >= 0 && v <= 100) w[d] = Math.round(v);
    }
  }
  return DIMENSIONS.some((d) => w[d] > 0) ? w : { ...DEFAULT_WEIGHTS };
}

export type Basis = "data" | "ai" | "neutral" | "excluded";
export type DimensionScore = { score: number | null; weight: number; basis: Basis; reason: string };
export type ScoreBreakdown = { dimensions: Record<Dimension, DimensionScore>; formula: string; weights: Weights; cap?: number | null };

export type AIRatings = Record<"strategic" | "audience" | "platform" | "differentiation", { score: number; reason: string }>;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
/** lift 1 → 50, ×3 → 100, ÷3 → 0 (log scale, so ×2 and ÷2 are symmetric). */
export const liftToScore = (lift: number) => clamp(50 + (50 * Math.log(lift)) / Math.log(3));

const PERF_KINDS = new Set(["pillar_performance", "format_performance", "topic_performance", "hook_pattern", "cta_pattern", "timing", "top_post", "refresh", "low_post", "published_result"]);
const GAP_KINDS = new Set(["pillar_gap", "pillar_dormant", "funnel_gap", "format_gap", "competitor_topic"]);

function historicalDimension(cited: Signal[]): Omit<DimensionScore, "weight"> {
  const perf = cited.filter((s) => PERF_KINDS.has(s.kind) && s.lift != null && s.lift > 0);
  if (!perf.length) return { score: 50, basis: "neutral", reason: "No historical performance signal supports this idea: neutral 50, confidence lowered." };
  // sample-size-weighted mean of log lifts (a single post counts as 3 so outliers don't dominate a group of 200)
  const weightOf = (s: Signal) => Math.max(3, Math.min(s.n, 300));
  const total = perf.reduce((t, s) => t + weightOf(s), 0);
  const logLift = perf.reduce((t, s) => t + Math.log(s.lift!) * weightOf(s), 0) / total;
  const lift = Math.exp(logLift);
  return {
    score: liftToScore(lift),
    basis: "data",
    reason: `Weighted lift ×${Math.round(lift * 100) / 100} from ${perf.length} cited signal${perf.length > 1 ? "s" : ""} (${perf.map((s) => `${s.key} ×${s.lift}, n=${s.n}`).join("; ")}).`,
  };
}

function gapDimension(cited: Signal[]): Omit<DimensionScore, "weight"> {
  const gaps = cited.filter((s) => GAP_KINDS.has(s.kind));
  if (!gaps.length) return { score: 30, basis: "data", reason: "No coverage gap cited: the idea extends an area already covered." };
  const scoreOf = (s: Signal) =>
    s.kind === "pillar_dormant" ? 85
    : s.kind === "pillar_gap" || s.kind === "funnel_gap" ? clamp(50 + (s.gap ?? 0) * 2.5)
    : s.kind === "format_gap" ? 70
    : s.gap ? 70 : 55; // competitor topic: uncovered by you → 70, covered → 55
  const best = gaps.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
  return { score: scoreOf(best), basis: "data", reason: `${best.key}: ${best.statement}` };
}

/** Search demand from cited SERP signals (real Google results); excluded when the project has no SERP analysis. */
function searchDimension(cited: Signal[], serpData: boolean): Omit<DimensionScore, "weight"> {
  const s = cited.filter((x) => x.kind === "search_demand");
  if (!serpData) return { score: null, basis: "excluded", reason: "No keyword analysed in Google search: excluded, its weight is spread over the other dimensions." };
  if (!s.length) return { score: 30, basis: "data", reason: "No analysed search query is cited for this idea." };
  const best = Math.max(...s.map((x) => 60 + (Number(x.metrics.questions ?? 0) > 0 ? 15 : 0) + (x.metrics.own_position == null ? 15 : Number(x.metrics.own_position) > 3 ? 10 : 0)));
  return { score: clamp(best), basis: "data", reason: `${s.length} analysed search quer${s.length > 1 ? "ies" : "y"}: ${s.map((x) => x.metrics.keyword).join(", ")} (People also ask questions and your current position counted).` };
}

export type ExtraDimensions = {
  /** project has at least one SERP analysis */
  serpData?: boolean;
  /** {active: campaigns active in the period, matched: the idea's campaign is one of them} */
  campaign?: { active: number; matched: string | null } | null;
  /** highest word similarity (0–1) to posts of the last 90 days */
  freshness?: { similarity: number; closest: string | null } | null;
  format?: string | null;
};

export function computeScore(input: {
  cited: Signal[];
  ai: AIRatings;
  weights: Weights;
  competitorData: boolean;
  extra?: ExtraDimensions;
}): { score: number; breakdown: ScoreBreakdown } {
  const x = input.extra ?? {};
  const effortPts = /reel|video|short|live/i.test(x.format ?? "") ? 35 : /carousel|article|landing|resource|guide|cluster/i.test(x.format ?? "") ? 55 : 85;
  const dims: Record<Dimension, Omit<DimensionScore, "weight">> = {
    historical: historicalDimension(input.cited),
    gap: gapDimension(input.cited),
    strategic: { score: clamp(input.ai.strategic.score), basis: "ai", reason: input.ai.strategic.reason },
    audience: { score: clamp(input.ai.audience.score), basis: "ai", reason: input.ai.audience.reason },
    platform: { score: clamp(input.ai.platform.score), basis: "ai", reason: input.ai.platform.reason },
    differentiation: input.competitorData
      ? { score: clamp(input.ai.differentiation.score), basis: "ai", reason: input.ai.differentiation.reason }
      : { score: null, basis: "excluded", reason: "No competitor data in this project yet: excluded, its weight is spread over the other dimensions." },
    search: input.extra ? searchDimension(input.cited, Boolean(x.serpData)) : { score: null, basis: "excluded", reason: "Not evaluated for this idea." },
    campaign: !x.campaign || !x.campaign.active
      ? { score: null, basis: "excluded", reason: "No campaign active in the period: excluded." }
      : x.campaign.matched ? { score: 90, basis: "data", reason: `Part of the active campaign "${x.campaign.matched}".` } : { score: 40, basis: "data", reason: `${x.campaign.active} campaign(s) active, this idea belongs to none of them.` },
    freshness: !x.freshness
      ? { score: null, basis: "excluded", reason: "Not evaluated for this idea." }
      : { score: clamp(100 - x.freshness.similarity * 120), basis: "data", reason: x.freshness.similarity >= 0.3 && x.freshness.closest ? `Close to a recent post ("${x.freshness.closest.slice(0, 80)}", ${Math.round(x.freshness.similarity * 100)}% word overlap).` : "No similar post in the last 90 days." },
    effort: input.extra && x.format != null
      ? { score: effortPts, basis: "data", reason: `${x.format}: ${effortPts >= 85 ? "low" : effortPts >= 55 ? "medium" : "high"} production effort (reel/video high, carousel/article medium, image/text low).` }
      : { score: null, basis: "excluded", reason: "Not evaluated for this idea." },
  };
  const active = DIMENSIONS.filter((d) => dims[d].score != null && input.weights[d] > 0);
  const totalWeight = active.reduce((t, d) => t + input.weights[d], 0) || 1;
  let score = clamp(active.reduce((t, d) => t + dims[d].score! * input.weights[d], 0) / totalWeight);
  // No high score without evidence: only AI judgments and neutral values behind it → capped
  const supported = input.cited.some((s) => s.n >= 3 && (s.category !== "competitor" || s.lift != null)) || input.cited.some((s) => s.kind === "search_demand");
  const cap = input.extra && !supported ? UNSUPPORTED_CAP : null;
  if (cap != null) score = Math.min(score, cap);
  const dimensions = Object.fromEntries(DIMENSIONS.map((d) => [d, { ...dims[d], weight: input.weights[d] }])) as Record<Dimension, DimensionScore>;
  return { score, breakdown: { dimensions, weights: input.weights, cap, formula: formulaText(active, input.weights, cap) } };
}

const formulaText = (active: Dimension[], w: Weights, cap: number | null | undefined) =>
  `Σ(score × weight) ÷ Σ(weights) over ${active.map((d) => `${DIMENSION_LABELS[d]} ${w[d]}`).join(", ")}${cap != null ? ` · at most ${cap}: no data signal supports this idea` : ""}`;

/** Recomputes the total from a stored breakdown with new weights (dimension scores stay as generated). */
export function rescore(breakdown: ScoreBreakdown, weights: Weights) {
  const active = DIMENSIONS.filter((d) => breakdown.dimensions[d]?.score != null && weights[d] > 0);
  const total = active.reduce((t, d) => t + weights[d], 0) || 1;
  const raw = clamp(active.reduce((t, d) => t + breakdown.dimensions[d].score! * weights[d], 0) / total);
  const score = breakdown.cap != null ? Math.min(raw, breakdown.cap) : raw;
  return {
    score,
    breakdown: {
      // dimensions added after an opportunity was scored stay absent (not evaluated) rather than invented
      dimensions: Object.fromEntries(DIMENSIONS.filter((d) => breakdown.dimensions[d]).map((d) => [d, { ...breakdown.dimensions[d], weight: weights[d] }])) as Record<Dimension, DimensionScore>,
      weights,
      cap: breakdown.cap ?? null,
      formula: formulaText(active, weights, breakdown.cap),
    },
  };
}

/**
 * Evidence class and confidence are decided here, not by the model:
 * - "data_supported" needs at least one cited historical/strategy signal with ≥3 posts; otherwise it becomes a hypothesis.
 * - confidence follows the largest sample behind a cited performance signal (≥30 high, ≥10 medium), one step down
 *   when the effect is weak (lift within 0.9–1.1); hypotheses are at most medium, experiments always low.
 */
export function classify(requested: InsightType, cited: Signal[]): { insight_type: InsightType; confidence: "low" | "medium" | "high"; note: string | null } {
  // competitor signals count as data only when they carry measured performance (lift vs the account's own median)
  const factual = cited.filter((s) => ((s.category !== "competitor" || s.lift != null) && s.n >= 3) || s.kind === "search_demand");
  let insight_type = requested;
  let note: string | null = null;
  if (requested === "data_supported" && !factual.length) {
    insight_type = "hypothesis";
    note = "Classified as a hypothesis: no cited data signal with at least 3 posts supports it.";
  }
  if (insight_type === "experiment") return { insight_type, confidence: "low", note: note ?? "An experiment: run it to find out; no result is predicted." };
  const perf = cited.filter((s) => PERF_KINDS.has(s.kind) && s.lift != null);
  const n = Math.max(0, ...perf.map((s) => s.n), ...factual.filter((s) => !PERF_KINDS.has(s.kind)).map((s) => Math.min(s.n, 10)));
  let level = n >= 30 ? 2 : n >= 10 ? 1 : 0;
  if (perf.length && perf.every((s) => s.lift! > 0.9 && s.lift! < 1.1)) level = Math.max(0, level - 1);
  if (insight_type === "hypothesis") level = Math.min(level, 1);
  return { insight_type, confidence: (["low", "medium", "high"] as const)[level], note: note ?? (insight_type === "hypothesis" ? "A hypothesis: reasoned from the strategy and patterns, not yet validated by results." : null) };
}

// --- Duplicates --------------------------------------------------------------------------------------------
export function ideaTokens(o: { title?: string | null; idea?: string | null; hook?: string | null; creative_angle?: string | null }) {
  return new Set(contentTokens([o.title ?? o.idea, o.creative_angle].filter(Boolean).join(" ")));
}

export function similarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when the idea is nearly identical to one already stored (same platform or no platform set). */
export function isDuplicate(
  candidate: { title: string; creative_angle?: string | null; platform?: string | null },
  existing: { title?: string | null; idea?: string | null; creative_angle?: string | null; platform?: string | null }[],
  threshold = 0.6,
) {
  const c = ideaTokens(candidate);
  return existing.some((e) => (!candidate.platform || !e.platform || candidate.platform === e.platform) && similarity(c, ideaTokens(e)) >= threshold);
}

// --- Feedback-adjusted relevance -----------------------------------------------------------------------------
export type FeedbackKind = "useful" | "not_relevant" | "already_covered" | "not_aligned" | "different_angle";
const FEEDBACK_VALUE: Record<FeedbackKind, number> = { useful: 1, not_relevant: -1, already_covered: -0.5, not_aligned: -1, different_angle: 0 };

/**
 * Relevance = score adjusted by the team's feedback on other opportunities with the same pillar and format:
 * shrunk mean feedback value (Σ values ÷ (n + 2), so one vote counts for a third) × 10 points per attribute,
 * at most ±10 per attribute (±20 in total) once feedback is plentiful and consistent.
 */
export function relevanceOf(
  o: { id: string; opportunity_score: number | null; pillar_id: string | null; format: string | null },
  feedback: { opportunity_id: string; kind: FeedbackKind; pillar_id: string | null; format: string | null }[],
) {
  const others = feedback.filter((f) => f.opportunity_id !== o.id);
  const mean = (list: typeof others) => list.reduce((t, f) => t + FEEDBACK_VALUE[f.kind], 0) / (list.length + 2);
  const byPillar = o.pillar_id ? mean(others.filter((f) => f.pillar_id === o.pillar_id)) : 0;
  const byFormat = o.format ? mean(others.filter((f) => f.format && f.format.toLowerCase() === o.format!.toLowerCase())) : 0;
  const adjust = Math.round(byPillar * 10 + byFormat * 10);
  return { relevance: Math.max(0, Math.min(100, (o.opportunity_score ?? 40) + adjust)), adjust };
}
