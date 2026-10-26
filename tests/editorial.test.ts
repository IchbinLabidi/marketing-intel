import { describe, expect, it } from "vitest";
import { evaluatePublished, kpiValue, learningsFrom, STAGE_KPI } from "@/lib/editorial/feedback";
import { effortOf, optimizeCalendar, type OptItem } from "@/lib/editorial/optimizer";
import { allocate, buildSlots, platformDates, proposePlan, spread, strategyFunnelShares, validatePlan, weekdayOf, type PlanInput } from "@/lib/editorial/plan";
import { crowded, repetitionPairs } from "@/lib/editorial/repetition";
import { assessSources, type SourcesInput } from "@/lib/editorial/sources";

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const P3 = "00000000-0000-4000-8000-000000000003";
const C1 = "00000000-0000-4000-8000-0000000000c1";

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  start: "2026-11-01", end: "2026-11-30", objective: "leads",
  platforms: [{ platform: "instagram", perWeek: 4 }, { platform: "facebook", perWeek: 3 }, { platform: "blog", perWeek: 1 }],
  pillars: [{ id: P1, name: "Pédagogie", target_share: 50 }, { id: P2, name: "Preuves", target_share: 30 }, { id: P3, name: "Offres", target_share: null }],
  strategyFunnel: null,
  campaigns: [{ id: C1, name: "Inscriptions", starts_on: "2026-11-10", ends_on: "2026-11-20", funnel_focus: "conversion" }],
  formatLift: [{ platform: "instagram", format: "Carousel", lift: 1.8, n: 20 }, { platform: "instagram", format: "Reel", lift: 0.7, n: 12 }],
  bestDays: { instagram: [2, 4] },
  seasons: [{ label: "1st-term exams", start: "2026-11-25", end: "2026-12-10" }],
  ...over,
});

describe("content plan", () => {
  it("allocates whole numbers that add up exactly", () => {
    expect(allocate(10, [50, 30, 20])).toEqual([5, 3, 2]);
    expect(allocate(7, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(7);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });

  it("respects the strategy's pillar target shares and splits the rest among pillars without one", () => {
    const plan = proposePlan(input());
    expect(plan.total).toBe(plan.platforms.reduce((t, p) => t + p.count, 0));
    const [a, b, c] = plan.pillars;
    expect(a.count).toBeGreaterThan(b.count);
    expect(c.share).toBe(20); // 100 − 50 − 30
    expect(validatePlan(plan)).toEqual([]);
  });

  it("uses the strategy's funnel percentages when written, else the objective's mix", () => {
    expect(strategyFunnelShares({ awareness: "40% reach new students", engagement: "30 %", conversion: "30% — sign-ups" })).toEqual({ awareness: 40, engagement: 30, conversion: 30 });
    expect(strategyFunnelShares({ awareness: "reach" })).toBeNull();
    const plan = proposePlan(input({ strategyFunnel: { awareness: "50%", engagement: "30%", conversion: "20%" } }));
    expect(plan.funnel.map((f) => f.stage)).toEqual(["awareness", "engagement", "conversion"]);
    expect(plan.notes.some((n) => n.includes("percentages written in the strategy"))).toBe(true);
  });

  it("weights formats by measured performance and says when the mix is only a default", () => {
    const plan = proposePlan(input());
    const ig = plan.formats.filter((f) => f.platform === "instagram");
    expect(ig.find((f) => f.format === "Carousel")!.basis).toBe("history");
    expect(ig.find((f) => f.format === "Carousel")!.count).toBeGreaterThan(ig.find((f) => f.format === "Reel")!.count);
    expect(plan.notes.some((n) => n.startsWith("Facebook: format mix is a default"))).toBe(true);
    expect(plan.campaigns[0].count).toBeGreaterThan(0);
    expect(plan.dates.map((d) => d.label)).toContain("1st-term exams");
  });

  it("rejects an edited mix that doesn't add up", () => {
    const plan = proposePlan(input());
    plan.pillars[0].count += 2;
    expect(validatePlan(plan)[0]).toMatch(/Pillars add up/);
  });

  it("spreads equal values apart and dates posts on the platform's best weekdays", () => {
    const s = spread([{ value: "a", count: 3 }, { value: "b", count: 3 }]);
    expect(s.some((v, k) => k > 0 && v === s[k - 1])).toBe(false);
    const dates = platformDates("2026-11-01", "2026-11-30", 8, [2, 4]);
    expect(new Set(dates).size).toBe(8);
    expect(dates.filter((d) => [2, 4].includes(weekdayOf(d))).length).toBeGreaterThanOrEqual(6);
  });

  it("lays out slots that match the plan, keeping locked posts' share", () => {
    const plan = proposePlan(input());
    const slots = buildSlots(plan);
    expect(slots.length).toBe(plan.total);
    for (const p of plan.platforms) expect(slots.filter((s) => s.platform === p.platform).length).toBe(p.count);
    for (const f of plan.funnel) expect(slots.filter((s) => s.funnel_stage === f.stage).length).toBe(f.count);
    expect(slots.filter((s) => s.campaign_id === C1).every((s) => s.date >= "2026-11-10" && s.date <= "2026-11-20")).toBe(true);
    const locked = [{ date: slots[0].date, platform: slots[0].platform, pillar_id: slots[0].pillar_id, funnel_stage: slots[0].funnel_stage, format: slots[0].format, campaign_id: null }];
    const rest = buildSlots(plan, locked);
    expect(rest.length).toBe(plan.total - 1);
    expect(rest.some((s) => s.date === locked[0].date && s.platform === locked[0].platform)).toBe(false);
  });
});

describe("repetition", () => {
  const item = (id: string, title: string, hook = "", date = "2026-11-03", platform = "instagram") => ({ id, title, hook, date, platform, topic: null, angle: null, caption: null });
  it("flags exact repeats and sends close pairs (same topic) to the AI judge", () => {
    const pairs = repetitionPairs(
      [item("a", "Bac informatique : 5 erreurs fréquentes en algorithmique"), item("b", "Bac informatique : erreurs fréquentes algorithmique à éviter"), item("c", "Bac informatique algorithmique : checklist de révision")],
      [item("h", "Offre spéciale cours de maths", "", "2026-09-01")],
    );
    expect(pairs.find((p) => p.a === "a" && p.b === "b")?.kind).toBe("exact");
    expect(pairs.find((p) => p.a === "a" && p.b === "c")?.kind).toBe("possible");
    expect(pairs.some((p) => p.b === "h")).toBe(false);
  });
  it("finds similar posts too close together on one platform", () => {
    expect(crowded([item("a", "Révision bac informatique algorithmique", "", "2026-11-03"), item("b", "Révision bac informatique algorithmique exercices", "", "2026-11-05")])).toHaveLength(1);
    expect(crowded([item("a", "Révision bac informatique algorithmique", "", "2026-11-03"), item("b", "Révision bac informatique algorithmique exercices", "", "2026-11-15")])).toHaveLength(0);
  });
});

describe("optimizer", () => {
  it("warns about unbalanced pillars, missing campaign posts, same-day posts and uncovered dates", () => {
    const plan = proposePlan(input({ platforms: [{ platform: "instagram", perWeek: 2 }] }));
    const items: OptItem[] = Array.from({ length: plan.total }, (_, k) => ({ id: `i${k}`, title: `Post ${k} sujet ${k}`, date: k < 2 ? "2026-11-03" : `2026-11-${String(4 + k).padStart(2, "0")}`, platform: "instagram", pillar_id: P1, funnel_stage: "awareness", format: "Reel", campaign_id: null }));
    const checks = optimizeCalendar(items, plan, () => "Pillar", () => "Campaign");
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by.pillars.status).toBe("warning");
    expect(by.campaigns.status).toBe("warning");
    expect(by.frequency.ids).toEqual(["i0", "i1"]);
    expect(by.dates.status).toBe("warning");
    expect(by.repetition.status).toBe("ok");
    expect(effortOf("Reel")).toBeGreaterThan(effortOf("Image post"));
  });
});

describe("feedback loop", () => {
  const hist = Array.from({ length: 10 }, (_, k) => ({ id: `h${k}`, platform: "instagram" as const, reach: 1000, likes: 50, comments: 5, shares: 5, saves: 10, clicks: 4, publication_date: `2026-0${(k % 9) + 1}-01` }));
  it("judges each post on its objective's KPI, not likes", () => {
    expect(STAGE_KPI.trust).toBe("saves_shares");
    expect(kpiValue("saves_shares", { saves: 30, shares: 10 })).toBe(40);
    expect(kpiValue("conversions", { likes: 900 })).toBeNull();
    const [trust, conversion] = evaluatePublished([
      { id: "a", title: "Carousel", platform: "instagram", format: "Carousel", pillar_id: null, funnel_stage: "trust", metrics: { saves: 40, shares: 8, likes: 10 } },
      { id: "b", title: "Promo", platform: "instagram", format: "Image post", pillar_id: null, funnel_stage: "acquisition", metrics: { likes: 5, clicks: 12 } },
    ], hist);
    expect(trust).toMatchObject({ kpi: "saves_shares", baseline: 15, ratio: 3.2, verdict: "above" });
    expect(conversion).toMatchObject({ kpi: "clicks", ratio: 3, verdict: "above" }); // few likes, but it did its job
  });
  it("needs a baseline and at least two consistent posts before learning anything", () => {
    expect(evaluatePublished([{ id: "a", title: "x", platform: "facebook", format: null, pillar_id: null, funnel_stage: "trust", metrics: { saves: 3 } }], hist)[0].verdict).toBe("no_data");
    const results = evaluatePublished(["a", "b"].map((id) => ({ id, title: id, platform: "instagram" as const, format: "Carousel", pillar_id: null, funnel_stage: "trust" as const, metrics: { saves: 40, shares: 5 } })), hist);
    const [l] = learningsFrom(results);
    expect(l).toMatchObject({ n: 2, direction: "more", platform: "instagram", ref_ids: ["a", "b"] });
    expect(learningsFrom(results.slice(0, 1))).toEqual([]);
  });
});

describe("data sources", () => {
  const base: SourcesInput = {
    brand: null, strategy: null, personas: 0, pillars: [], campaigns: [], history: { posts: 0, withMetrics: 0, platforms: [], lastDate: null },
    competitors: { competitors: 0, posts: 0, withCounts: 0 }, serp: { analyses: 0, keywords: 0, lastDate: null }, importantDates: 0, calendars: 0,
    published: { verified: 0, withMetrics: 0 }, period: { start: "2026-11-01", end: "2026-11-30" },
  };
  it("reports missing data as missing and never as available", () => {
    const s = assessSources(base);
    expect(s.every((x) => x.status === "missing")).toBe(true);
    expect(s.find((x) => x.key === "historical_performance")!.detail).toMatch(/not performance-validated/);
  });
  it("distinguishes partial from available", () => {
    const s = assessSources({ ...base, brand: { mission: "Aider les élèves", personality: "", target_audience: "Lycéens", differentiators: "Profs certifiés" }, pillars: [{ name: "A", target_share: 50 }, { name: "B", target_share: null }], history: { posts: 300, withMetrics: 250, platforms: ["instagram"], lastDate: "2026-10-20" }, campaigns: [{ name: "Old", starts_on: "2026-01-01", ends_on: "2026-02-01" }] });
    const by = Object.fromEntries(s.map((x) => [x.key, x.status]));
    expect(by).toMatchObject({ brand: "available", pillars: "partial", historical_performance: "available", campaigns: "partial", serp: "missing" });
  });
});
