import { describe, expect, it } from "vitest";
import { overview, production, social, strategyBalance, type AnalyticsItem, type PerfRow } from "@/lib/analytics/compute";
import { actionCenter, executiveSummary, explain, fiveQuestions, type CeoInput } from "@/lib/analytics/ceo";

const TZ = "UTC";
const P = { from: "2026-10-01", to: "2026-10-28" };
const TODAY = "2026-10-28";
const NOW = "2026-10-28T12:00:00Z";
let seq = 0;
const item = (over: Partial<AnalyticsItem>): AnalyticsItem => ({
  id: `i${++seq}`, title: "T", status: "planned", production_stage: "idea", platform: "instagram", format: "Carousel", pillar_id: "pa", funnel_stage: null,
  campaign_id: null, assignee_id: null, created_at: "2026-09-01T10:00:00Z", scheduled_date: null, published_at: null, due_date: null, approved_at: null, ...over,
});
const perf = (over: Partial<PerfRow>): PerfRow => ({
  id: `p${++seq}`, title: null, platform: "facebook", format: null, pillar_id: null, campaign_id: null, permalink: null, date: "2026-10-10",
  reach: 100, impressions: null, views: null, video_views: null, clicks: null, likes: 2, comments: 0, shares: 0, saves: 0, conversions: null, leads: null, source: "meta_api", ...over,
});
const pillars = [{ id: "pa", name: "Education", target_share: 50 }, { id: "pb", name: "Offers", target_share: 50 }];

function input(items: AnalyticsItem[], over: Partial<CeoInput> = {}): CeoInput {
  const planned = items.filter((i) => i.scheduled_date && i.scheduled_date >= P.from && i.scheduled_date <= P.to);
  return {
    period: P, periodDays: 28,
    overview: overview(items, [], P, TODAY, TZ), overviewPrev: null,
    production: production(items, [], P, TODAY, TZ, NOW), productionPrev: null,
    balance: strategyBalance(planned, [], { pillars, funnel: [], funnelTargets: new Map(), platforms: [{ platform: "instagram", label: "Instagram", postsPerWeek: 5 }], periodDays: 28 }),
    targetsOff: false, hasPillarTargets: true, hasChannelTargets: true, team: null, social: null, socialPrev: null, canSeeSocial: true,
    meta: { status: "active", lastSyncStatus: "succeeded", error: null }, kpiCount: 0, stageLabel: (s) => s,
    links: { strategy: "/s", calendar: "/c", overdue: "/c?overdue=1", production: "/p", team: "/t", history: "/h", settings: "/x" },
    ...over,
  };
}

describe("CEO action center", () => {
  it("raises real issues with their numbers and a link, most serious first", () => {
    const items = [
      ...[...Array(8)].map((_, n) => item({ scheduled_date: `2026-10-0${n + 1}`, pillar_id: "pa" })), // planned, passed, not published
      item({ scheduled_date: "2026-10-10", pillar_id: "pb", status: "published", published_at: "2026-10-10T10:00:00Z" }),
      ...[...Array(5)].map(() => item({ due_date: "2026-10-01", status: "in_production", production_stage: "in_production" })),
    ];
    const issues = actionCenter(input(items));
    const ids = issues.map((i) => i.id);
    expect(ids).toContain("overdue");
    expect(ids).toContain("slipped");
    expect(ids).toContain("pillar-pb");
    expect(issues[0].severity).toBe(1);
    const slipped = issues.find((i) => i.id === "slipped")!;
    expect(slipped.evidence).toContain("1 of 9");
    // Offers: 1 of 9 planned (11%) vs 50% target -> about 4 more items.
    expect(issues.find((i) => i.id === "pillar-pb")!.impact).toContain("4 more items");
    // Channel shortfall is grouped into one issue.
    expect(issues.filter((i) => i.id.startsWith("platform")).length).toBeLessThanOrEqual(1);
  });

  it("produces nothing when the data shows no problem", () => {
    const items = [
      ...[...Array(5)].map((_, n) => item({ scheduled_date: `2026-10-1${n}`, pillar_id: n % 2 ? "pb" : "pa", status: "published", published_at: `2026-10-1${n}T10:00:00Z` })),
      item({ scheduled_date: "2026-10-30", pillar_id: "pb" }),
    ];
    const issues = actionCenter(input(items, { hasChannelTargets: false, balance: strategyBalance(items.slice(0, 5), [], { pillars: [{ id: "pa", name: "A", target_share: 60 }, { id: "pb", name: "B", target_share: 40 }], funnel: [], funnelTargets: new Map(), platforms: [], periodDays: 28 }) }));
    expect(issues).toEqual([]);
  });

  it("flags a missing or failed integration instead of showing empty results", () => {
    expect(actionCenter(input([], { meta: null })).map((i) => i.id)).toContain("no-data");
    expect(actionCenter(input([], { meta: { status: "active", lastSyncStatus: "failed", error: "token" } })).map((i) => i.id)).toContain("sync-failed");
    expect(actionCenter(input([], { meta: null, canSeeSocial: false })).map((i) => i.id)).not.toContain("no-data");
  });
});

describe("executive summary", () => {
  it("says when there isn't enough data to judge", () => {
    const s = executiveSummary(input([]), []);
    expect(s.level).toBe("insufficient");
    expect(s.headline).toMatch(/isn't enough data/);
  });

  it("rates the period by its most serious measured signal", () => {
    const items = [
      ...[...Array(6)].map((_, n) => item({ scheduled_date: `2026-10-0${n + 1}`, status: "published", published_at: `2026-10-0${n + 1}T10:00:00Z`, pillar_id: n % 2 ? "pb" : "pa" })),
      item({ due_date: "2026-10-01", status: "in_production", production_stage: "in_production" }),
    ];
    const i = input(items);
    const s = executiveSummary(i, actionCenter(i));
    expect(s.signals.find((x) => x.label === "Delivering the plan")?.tone).toBe("good");
    expect(s.signals.find((x) => x.label === "Meeting deadlines")?.tone).toBe("watch");
    expect(s.level).toBe("watch");
    expect(s.behind[0].text).toContain("1 piece of content");
  });

  it("does not let audience response alone push the rating to 'needs attention'", () => {
    const now = social([...Array(12)].map(() => perf({ likes: 1 })), P);
    const prev = social([...Array(12)].map(() => perf({ likes: 5, date: "2026-09-10" })), { from: "2026-09-03", to: "2026-09-30" });
    const items = [...Array(6)].map((_, n) => item({ scheduled_date: `2026-10-0${n + 1}`, status: "published", published_at: `2026-10-0${n + 1}T10:00:00Z`, pillar_id: n % 2 ? "pb" : "pa" }));
    const s = executiveSummary(input(items, { social: now, socialPrev: prev }), []);
    expect(s.signals.find((x) => x.label === "Audience response")?.tone).toBe("watch");
    expect(s.level).toBe("watch");
  });
});

describe("five questions and explanations", () => {
  it("answers honestly when objectives have no recorded results", () => {
    const now = social([perf({ clicks: 3 })], P);
    const a = fiveQuestions(input([], { social: now, kpiCount: 4 }), []);
    expect(a[3].answer).toContain("4 strategy objectives have no recorded results");
    expect(a[0].answer).toContain("Nothing has a publication date");
  });

  it("explains completion with the real counts", () => {
    const items = [
      item({ scheduled_date: "2026-10-02", status: "published", published_at: "2026-10-02T10:00:00Z" }),
      item({ scheduled_date: "2026-10-03" }), item({ scheduled_date: "2026-10-04" }),
    ];
    const e = explain(input(items)).completion;
    expect(e.example).toBe("Your team published 1 of the 3 publications planned for past dates in this period. 2 are still unpublished.");
    expect(e.action).toMatch(/delayed, waiting for approval, or no longer needed/);
  });
});
