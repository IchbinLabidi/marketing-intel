// Idea scoring (pure, tested). The AI rates each criterion 0–100; the score is their weighted average with the
// brand's weights. It ranks ideas against each other: it is an estimate, not a performance prediction.

export const CRITERIA = [
  { key: "audience", label: "Audience relevance", weight: 25 },
  { key: "engagement", label: "Engagement potential", weight: 20 },
  { key: "marketing", label: "Marketing value", weight: 20 },
  { key: "originality", label: "Originality", weight: 15 },
  { key: "educational", label: "Educational value", weight: 10 },
  { key: "feasibility", label: "Production feasibility", weight: 10 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];
export type Weights = Record<CriterionKey, number>;
export type CriteriaScores = Record<CriterionKey, number>;
export type ScoreDetails = {
  criteria?: CriteriaScores; weights?: Weights; explanation?: string;
  source: "ai" | "manual"; model?: string; scored_at: string; note?: string;
};

export const DEFAULT_WEIGHTS = Object.fromEntries(CRITERIA.map((c) => [c.key, c.weight])) as Weights;

/** The brand's weights, completed with defaults and rescaled to sum to 100. */
export function normalizeWeights(w: Partial<Record<string, unknown>> | null | undefined): Weights {
  const raw = Object.fromEntries(CRITERIA.map((c) => {
    const v = Number(w?.[c.key]);
    return [c.key, Number.isFinite(v) && v >= 0 ? v : c.weight];
  })) as Weights;
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (!sum) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 10])) as Weights;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function weightedScore(criteria: Partial<CriteriaScores>, weights: Weights): number {
  let total = 0, used = 0;
  for (const c of CRITERIA) {
    const v = criteria[c.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    total += clamp(v) * weights[c.key];
    used += weights[c.key];
  }
  return used ? clamp(total / used) : 0;
}

export const scoreBand = (s: number | null | undefined) => (s == null ? "unscored" : s >= 85 ? "high" : s >= 65 ? "good" : s >= 45 ? "fair" : "low");
