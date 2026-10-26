import { describe, expect, it } from "vitest";
import { computePerformance, usableReach } from "@/lib/history/performance";
import { buildSignals, type Signal, type SignalItem } from "@/lib/opportunities/signals";
import { classify, computeScore, DEFAULT_WEIGHTS, isDuplicate, liftToScore, normalizeWeights, relevanceOf, rescore, UNSUPPORTED_CAP } from "@/lib/opportunities/scoring";

const sig = (over: Partial<Signal>): Signal => ({
  key: "S1", kind: "format_performance", category: "historical", platform: "instagram", pillar_id: null, format: "Carousel",
  statement: "x", method: "m", period: { from: null, to: null }, n: 40, lift: 1.5, gap: null, metrics: {}, ref_ids: [], ...over,
});
const ai = {
  strategic: { score: 80, reason: "fits objective" }, audience: { score: 70, reason: "students" },
  platform: { score: 60, reason: "carousel native" }, differentiation: { score: 90, reason: "unique" },
};

describe("scoring", () => {
  it("maps lifts symmetrically on a log scale", () => {
    expect(liftToScore(1)).toBe(50);
    expect(liftToScore(3)).toBe(100);
    expect(liftToScore(1 / 3)).toBe(0);
    expect(liftToScore(2) - 50).toBe(50 - liftToScore(0.5));
  });

  it("weights the dimensions and excludes differentiation without competitor data", () => {
    const { score, breakdown } = computeScore({ cited: [sig({ lift: 3 })], ai, weights: DEFAULT_WEIGHTS, competitorData: false });
    // historical 100×20 + strategic 80×15 + audience 70×15 + gap 30×10 + platform 60×10, ÷ 70 (the four calendar
    // dimensions are not evaluated without `extra`, differentiation excluded without competitor data)
    expect(score).toBe(Math.round((100 * 20 + 80 * 15 + 70 * 15 + 30 * 10 + 60 * 10) / 70));
    expect(breakdown.dimensions.differentiation.basis).toBe("excluded");
    expect(breakdown.dimensions.historical.basis).toBe("data");
    expect(breakdown.dimensions.strategic.basis).toBe("ai");
  });

  it("uses a neutral historical score when no performance signal is cited", () => {
    const { breakdown } = computeScore({ cited: [], ai, weights: DEFAULT_WEIGHTS, competitorData: true });
    expect(breakdown.dimensions.historical).toMatchObject({ score: 50, basis: "neutral" });
    expect(breakdown.dimensions.differentiation.score).toBe(90);
  });

  it("scores gaps from strategy signals", () => {
    const { breakdown } = computeScore({ cited: [sig({ kind: "pillar_gap", category: "strategy", lift: null, gap: 12 })], ai, weights: DEFAULT_WEIGHTS, competitorData: false });
    expect(breakdown.dimensions.gap.score).toBe(80);
  });

  it("rescores a stored breakdown with new weights", () => {
    const first = computeScore({ cited: [sig({ lift: 3 })], ai, weights: DEFAULT_WEIGHTS, competitorData: false });
    const only = rescore(first.breakdown, { ...DEFAULT_WEIGHTS, historical: 100, strategic: 0, audience: 0, gap: 0, platform: 0, differentiation: 0 });
    expect(only.score).toBe(100);
  });

  it("sanitises stored weights", () => {
    expect(normalizeWeights({ historical: 200, gap: "x" })).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights({ historical: 0, strategic: 0, audience: 0, gap: 0, platform: 0, differentiation: 0, search: 0, campaign: 0, freshness: 0, effort: 0 })).toEqual(DEFAULT_WEIGHTS);
    // weights saved before the calendar dimensions existed keep their values; new dimensions get their defaults
    expect(normalizeWeights({ historical: 40, strategic: 0, audience: 0, gap: 0, platform: 0, differentiation: 0 })).toMatchObject({ historical: 40, search: 5, effort: 5 });
  });

  it("caps ideas without data support and scores the calendar dimensions from data", () => {
    const high = { ...ai, strategic: { score: 100, reason: "" }, audience: { score: 100, reason: "" }, platform: { score: 100, reason: "" } };
    const extra = { serpData: true, campaign: { active: 1, matched: "Rentrée" }, freshness: { similarity: 0, closest: null }, format: "Image post" };
    const unsupported = computeScore({ cited: [], ai: high, weights: DEFAULT_WEIGHTS, competitorData: false, extra });
    expect(unsupported.score).toBe(UNSUPPORTED_CAP);
    expect(unsupported.breakdown.cap).toBe(UNSUPPORTED_CAP);
    expect(rescore(unsupported.breakdown, { ...DEFAULT_WEIGHTS, strategic: 100 }).score).toBeLessThanOrEqual(UNSUPPORTED_CAP);
    expect(unsupported.breakdown.dimensions.campaign).toMatchObject({ score: 90, basis: "data" });
    expect(unsupported.breakdown.dimensions.search).toMatchObject({ score: 30, basis: "data" });
    expect(unsupported.breakdown.dimensions.effort).toMatchObject({ score: 85, basis: "data" });
    const supported = computeScore({ cited: [sig({ lift: 3 })], ai: high, weights: DEFAULT_WEIGHTS, competitorData: false, extra: { ...extra, format: "Reel", freshness: { similarity: 0.5, closest: "Old post" } } });
    expect(supported.score).toBeGreaterThan(UNSUPPORTED_CAP);
    expect(supported.breakdown.dimensions.effort.score).toBe(35);
    expect(supported.breakdown.dimensions.freshness.score).toBe(40);
    const noSerp = computeScore({ cited: [], ai, weights: DEFAULT_WEIGHTS, competitorData: false, extra: { ...extra, serpData: false, campaign: { active: 0, matched: null } } });
    expect(noSerp.breakdown.dimensions.search.basis).toBe("excluded");
    expect(noSerp.breakdown.dimensions.campaign.basis).toBe("excluded");
  });
});

describe("evidence classification", () => {
  it("downgrades data-supported ideas that cite no real data", () => {
    expect(classify("data_supported", [])).toMatchObject({ insight_type: "hypothesis", confidence: "low" });
    expect(classify("data_supported", [sig({ category: "competitor", kind: "competitor_topic", lift: null })]).insight_type).toBe("hypothesis");
  });
  it("sets confidence from the sample size and effect strength", () => {
    expect(classify("data_supported", [sig({ n: 120, lift: 1.6 })]).confidence).toBe("high");
    expect(classify("data_supported", [sig({ n: 12, lift: 1.6 })]).confidence).toBe("medium");
    expect(classify("data_supported", [sig({ n: 120, lift: 1.05 })]).confidence).toBe("medium");
    expect(classify("hypothesis", [sig({ n: 500 })]).confidence).toBe("medium");
    expect(classify("experiment", [sig({ n: 500 })]).confidence).toBe("low");
  });
});

describe("duplicates and relevance", () => {
  it("detects near-identical ideas on the same platform only", () => {
    const existing = [{ title: "Exercice corrigé limites et continuité en carrousel", platform: "instagram" }];
    expect(isDuplicate({ title: "Limites et continuité : exercice corrigé en carrousel", platform: "instagram" }, existing)).toBe(true);
    expect(isDuplicate({ title: "Limites et continuité : exercice corrigé en carrousel", platform: "facebook" }, existing)).toBe(false);
    expect(isDuplicate({ title: "Témoignage d'un élève admis en médecine", platform: "instagram" }, existing)).toBe(false);
  });
  it("adjusts relevance by feedback on the same pillar and format, damped for small samples, within ±20", () => {
    const fb = [
      { opportunity_id: "a", kind: "useful" as const, pillar_id: "p1", format: "Carousel" },
      { opportunity_id: "b", kind: "not_relevant" as const, pillar_id: "p2", format: "Live" },
    ];
    // one vote: 1/(1+2) × 10 per attribute
    expect(relevanceOf({ id: "x", opportunity_score: 60, pillar_id: "p1", format: "carousel" }, fb)).toEqual({ relevance: 67, adjust: 7 });
    expect(relevanceOf({ id: "y", opportunity_score: 60, pillar_id: "p2", format: "Live" }, fb)).toEqual({ relevance: 53, adjust: -7 });
    expect(relevanceOf({ id: "a", opportunity_score: 60, pillar_id: "p1", format: "Carousel" }, fb).adjust).toBe(0); // own feedback ignored
    const many = Array.from({ length: 40 }, (_, k) => ({ opportunity_id: `u${k}`, kind: "useful" as const, pillar_id: "p1", format: "Carousel" }));
    expect(relevanceOf({ id: "x", opportunity_score: 60, pillar_id: "p1", format: "Carousel" }, many).adjust).toBe(19);
  });
});

describe("truncated reach", () => {
  it("ignores reach that is below the post's interactions or far below the platform's recent reach", () => {
    const p = (date: string, reach: number, likes: number) => ({ likes, comments: 0, shares: 0, saves: 0, reach, publication_date: date, actual_publication_date: null });
    const recent = Array.from({ length: 12 }, (_, k) => p(`2026-0${1 + (k % 9)}-10`, 3000, 30));
    const ok = usableReach([...recent, p("2021-05-01", 25, 20), p("2021-05-02", 10, 23)]);
    expect(ok(recent[0])).toBe(true);
    expect(ok(p("2021-05-01", 25, 20))).toBe(false); // 25 < 10% of 3000: truncated
    expect(ok(p("2026-05-02", 10, 23))).toBe(false); // fewer people reached than interactions
  });
});

describe("signals", () => {
  const post = (k: number, over: Partial<SignalItem>): SignalItem => ({
    id: `p${k}`, platform: "instagram", format: "Image post", title: `post ${k}`, topic: null, caption: null, pillar_id: "edu", content_pillar: null,
    publication_date: `2026-0${1 + (k % 8)}-1${k % 9}`, actual_publication_date: null, likes: 50, comments: 0, shares: 0, saves: 0, reach: 1000,
    views: null, engagements: null, permalink: null, source: "meta_api", pillar_assigned_by: null, ...over,
  });
  const items = [
    ...Array.from({ length: 20 }, (_, k) => post(k, {})),
    ...Array.from({ length: 10 }, (_, k) => post(100 + k, { format: "Carousel", likes: 150, pillar_id: "promo" })),
  ];
  const performance = computePerformance(items, (id) => id);
  const signals = buildSignals({
    items, performance, timing: [], strategyFunnel: [], activePlatforms: ["instagram"], competitorItems: [], today: "2026-10-25",
    pillars: [{ id: "edu", name: "Education", target_share: 50 }, { id: "promo", name: "Promo", target_share: 10 }, { id: "fun", name: "Community", target_share: 30 }],
  });

  it("computes format performance with numbers and supporting posts from the rows", () => {
    const s = signals.find((x) => x.kind === "format_performance" && x.format === "Carousel")!;
    expect(s.n).toBe(10);
    expect(s.lift).toBeGreaterThan(1.25);
    expect(s.ref_ids.every((id) => id.startsWith("p10"))).toBe(true);
    expect(s.statement).toContain("Carousel");
    expect(s.metrics.unit).toBe("engagement rate");
  });
  it("finds pillars below target and formats never used", () => {
    expect(signals.find((x) => x.kind === "pillar_gap" && x.pillar_id === "fun")?.gap).toBe(30);
    expect(signals.some((x) => x.kind === "format_gap" && x.format === "Story")).toBe(true);
  });
  it("emits no competitor signal without competitor posts", () => {
    expect(signals.some((x) => x.category === "competitor")).toBe(false);
  });
  it("numbers signals S1…", () => {
    expect(signals.map((s) => s.key)).toEqual(signals.map((_, k) => `S${k + 1}`));
  });
});
