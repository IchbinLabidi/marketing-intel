import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, normalizeWeights, weightedScore } from "@/lib/backlog/score";
import { audienceOf, examPeriod, suggestSlot } from "@/lib/backlog/slots";
import type { PlatformTiming } from "@/lib/calendar/insights";

describe("idea scoring", () => {
  it("uses the default weights (25/20/20/15/10/10) and rescales custom ones to 100", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const w = normalizeWeights({ audience: 50, engagement: 50, marketing: 0, originality: 0, educational: 0, feasibility: 0 });
    expect(w.audience).toBe(50);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
  it("computes the weighted average and ignores missing criteria", () => {
    expect(weightedScore({ audience: 100, engagement: 100, marketing: 100, originality: 100, educational: 100, feasibility: 100 }, DEFAULT_WEIGHTS)).toBe(100);
    expect(weightedScore({ audience: 80, engagement: 60, marketing: 70, originality: 50, educational: 90, feasibility: 100 }, DEFAULT_WEIGHTS)).toBe(73); // 72.5 rounded
    expect(weightedScore({ audience: 90 }, DEFAULT_WEIGHTS)).toBe(90);
  });
});

const timing = (n: number, lift: number): PlatformTiming => ({
  platform: "facebook", label: "Facebook", posts: 60, metric: "engagement", baseline: 10, weekdays: [], hours: [],
  suggestions: [{ weekday: 2, window: 18, label: "Tuesday 18:00–21:00", n, median: 20, lift }],
} as unknown as PlatformTiming);

describe("best time to post", () => {
  it("uses the brand's real timing first, with confidence from the sample size", () => {
    const s = suggestSlot({ platform: "facebook", today: "2026-10-30", timing: [timing(20, 1.5)] })!;
    expect(s.source).toBe("analytics");
    expect(s.time).toBe("18:00");
    expect(new Date(`${s.date}T00:00:00Z`).getUTCDay()).toBe(2);
    expect(s.confidence).toBe("high");
    expect(s.reason).toMatch(/Correlation, not a guarantee/);
  });
  it("falls back to a labelled heuristic with low confidence when there is no data", () => {
    const s = suggestSlot({ platform: "instagram", format: "Carousel", audience: "Lycéens, Bac", today: "2026-10-30", timing: [] })!;
    expect(s.source).toBe("heuristic");
    expect(s.confidence).toBe("low");
    expect(s.reason).toMatch(/^Heuristic/);
    expect(s.alternatives).toHaveLength(2);
  });
  it("skips days that are already full", () => {
    const first = suggestSlot({ platform: "facebook", today: "2026-10-30", timing: [timing(20, 1.5)] })!;
    const next = suggestSlot({ platform: "facebook", today: "2026-10-30", timing: [timing(20, 1.5)], busy: { [first.date]: 2 } })!;
    expect(next.date).not.toBe(first.date);
  });
  it("targets parents at weekends or after dinner, and knows Tunisian exam periods", () => {
    expect(audienceOf("Parents d'élèves")).toBe("parents");
    expect(audienceOf("الأولياء")).toBe("parents");
    expect(audienceOf("Élèves de 4e année")).toBe("students");
    expect(examPeriod("2026-12-01")).toMatch(/first-term/);
    expect(examPeriod("2026-10-01")).toBeNull();
    const s = suggestSlot({ platform: "facebook", audience: "parents", today: "2026-10-30", timing: [] })!;
    expect(["10:00", "20:30"]).toContain(s.time);
  });
});

import { detectGaps, planCalendar, type PlanIdea } from "@/lib/backlog/planner";

const idea = (id: string, score: number | null, pillar: string | null, extra: Partial<PlanIdea> = {}): PlanIdea =>
  ({ id, title: `Idea ${id}`, score, pillar_id: pillar, format: "Carousel", platform: "facebook", target_platforms: ["facebook"], target_audience: "Bac students", ...extra });

describe("calendar planner", () => {
  it("places N posts per week, best scores first, without writing anything", () => {
    const ideas = [idea("a", 90, "edu"), idea("b", 70, "promo"), idea("c", 85, "edu"), idea("d", 60, "eng")];
    const { placements } = planCalendar(ideas, { from: "2026-11-02", to: "2026-11-08", postsPerWeek: 3, platforms: ["facebook"] }, { timing: [], busy: {}, today: "2026-10-30" });
    expect(placements).toHaveLength(3);
    expect(placements[0].ideaId).toBe("a");
    expect(new Set(placements.map((p) => p.date)).size).toBe(3);
    expect(placements.every((p) => /^\d\d:\d\d$/.test(p.time))).toBe(true);
  });
  it("respects a pillar mix and avoids the same pillar twice in a row", () => {
    const ideas = [idea("e1", 95, "edu"), idea("e2", 94, "edu"), idea("e3", 93, "edu"), idea("p1", 60, "promo"), idea("p2", 59, "promo")];
    const { placements } = planCalendar(ideas, { from: "2026-11-02", to: "2026-11-08", postsPerWeek: 4, platforms: ["facebook"], pillarMix: { edu: 50, promo: 50 } }, { timing: [], busy: {}, today: "2026-10-30" });
    const promos = placements.filter((p) => p.pillar_id === "promo").length;
    expect(promos).toBe(2);
    const noMix = planCalendar(ideas, { from: "2026-11-02", to: "2026-11-08", postsPerWeek: 2, platforms: ["facebook"] }, { timing: [], busy: {}, today: "2026-10-30" }).placements;
    expect(noMix[0].pillar_id).not.toBe(noMix[1].pillar_id);
  });
  it("skips full days and explains when there aren't enough ideas", () => {
    const busy = { "2026-11-03": 2, "2026-11-01": 2 };
    const { placements, notes } = planCalendar([idea("a", 80, null)], { from: "2026-11-01", to: "2026-11-07", postsPerWeek: 3, platforms: ["facebook"] }, { timing: [], busy, today: "2026-10-30" });
    expect(placements.map((p) => p.date)).not.toContain("2026-11-03");
    expect(notes.join(" ")).toMatch(/only 1 matching Backlog idea/);
  });
});

describe("gap detection", () => {
  const post = (id: string, date: string, time: string, extra: Record<string, unknown> = {}) => ({ id, title: id, date, time, platform: "facebook", pillar_id: "edu", format: "Carousel", funnel_stage: null, scheduled_at: `${date}T${time}:00Z`, ...extra });
  it("flags empty days, overloaded days, streaks and conflicts", () => {
    const posts = [
      post("p1", "2026-11-02", "10:00", { funnel_stage: "conversion" }), post("p2", "2026-11-02", "10:30", { funnel_stage: "conversion" }), post("p3", "2026-11-02", "18:00", { funnel_stage: "conversion" }),
    ];
    const gaps = detectGaps(posts, { from: "2026-11-02", to: "2026-11-04", today: "2026-11-01" }, { pillarName: () => "Education", topIdea: { title: "Forum tutorial", score: 88, slot: { date: "2026-11-03", time: "18:30" } }, highUnscheduled: 2 });
    const kinds = gaps.map((g) => g.kind);
    expect(kinds).toEqual(expect.arrayContaining(["empty", "overloaded", "promo_streak", "pillar_streak", "conflict", "unscheduled"]));
    expect(gaps.find((g) => g.kind === "empty")!.message).toMatch(/Forum tutorial/);
  });
});
