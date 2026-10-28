import { describe, expect, it } from "vitest";
import {
  contentType, filterItems, funnelTargets, insights, overview, parseStageEvents, previousPeriod, production, social, strategyBalance, teamWorkload,
  type AnalyticsItem, type AnalyticsTask, type Filters, type PerfRow,
} from "@/lib/analytics/compute";
import { csvCell, toCsv } from "@/lib/analytics/csv";

const TZ = "Africa/Tunis"; // UTC+1, no DST
const P = { from: "2026-10-01", to: "2026-10-28" };
const TODAY = "2026-10-28";
const NO_FILTERS: Filters = { pillar: "", funnel: "", platform: "", format: "", campaign: "", status: "", assignee: "" };

let seq = 0;
const item = (over: Partial<AnalyticsItem>): AnalyticsItem => ({
  id: `i${++seq}`, title: "T", status: "planned", production_stage: "idea", platform: "instagram", format: "Carousel", pillar_id: null, funnel_stage: null,
  campaign_id: null, assignee_id: null, created_at: "2026-09-01T10:00:00Z", scheduled_date: null, published_at: null, due_date: null, approved_at: null, ...over,
});
const task = (over: Partial<AnalyticsTask>): AnalyticsTask => ({
  id: `t${++seq}`, content_item_id: "x", user_id: "u1", task_type: "design", status: "assigned", due_date: null, created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z", ...over,
});
const perf = (over: Partial<PerfRow>): PerfRow => ({
  id: `p${++seq}`, title: null, platform: "facebook", format: null, pillar_id: null, campaign_id: null, permalink: null, date: "2026-10-10",
  reach: null, impressions: null, views: null, video_views: null, clicks: null, likes: null, comments: null, shares: null, saves: null, conversions: null, leads: null, source: "meta_api", ...over,
});

describe("periods", () => {
  it("compares with the previous period of the same length", () => {
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-28" })).toEqual({ from: "2026-09-03", to: "2026-09-30" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });
});

describe("overview", () => {
  it("counts planned and published by their own dates, in the project time zone", () => {
    const items = [
      item({ scheduled_date: "2026-10-05" }),
      item({ scheduled_date: "2026-10-06", status: "published", published_at: "2026-10-06T09:00:00Z" }),
      // 23:30 UTC on Sep 30 is Oct 1 in Tunis: inside the period.
      item({ scheduled_date: "2026-09-30", status: "published", published_at: "2026-09-30T23:30:00Z" }),
      item({ scheduled_date: "2026-11-02" }),
    ];
    const o = overview(items, [], P, TODAY, TZ);
    expect(o.planned).toBe(2);
    expect(o.published).toBe(2);
    // Completion: 2 planned dates passed in the period, 1 of them published.
    expect(o.completionBase).toBe(2);
    expect(o.completionRate).toBe(50);
    expect(o.upcoming).toBe(1);
  });

  it("does not count a 'published' status without a verified publication time", () => {
    expect(overview([item({ status: "published", published_at: null, scheduled_date: "2026-10-03" })], [], P, TODAY, TZ).published).toBe(0);
  });

  it("reports current workload and overdue work as a snapshot", () => {
    const items = [
      item({ production_stage: "in_production", status: "in_production", due_date: "2026-10-20" }),
      item({ production_stage: "approval", status: "in_review" }),
      item({ production_stage: "ready", status: "approved", due_date: "2026-10-01" }),
    ];
    const tasks = [task({ content_item_id: items[0].id, due_date: "2026-10-27" }), task({ content_item_id: items[0].id, due_date: "2026-10-27", status: "completed" })];
    const o = overview(items, tasks, P, TODAY, TZ);
    expect(o.inProduction).toBe(1);
    expect(o.awaitingApproval).toBe(1);
    expect(o.overdueContent).toBe(1);
    expect(o.overdueTasks).toBe(1);
  });

  it("leaves the completion rate empty when no planned date has passed", () => {
    expect(overview([item({ scheduled_date: "2026-10-30" })], [], { from: "2026-10-29", to: "2026-11-05" }, TODAY, TZ).completionRate).toBeNull();
  });
});

describe("filters", () => {
  it("matches the collaborator as lead or task assignee, and filters by content type", () => {
    const a = item({ assignee_id: "u1" }), b = item({}), c = item({ format: "Instagram Reel" });
    const tasks = [task({ content_item_id: b.id, user_id: "u1" })];
    expect(filterItems([a, b, c], tasks, { ...NO_FILTERS, assignee: "u1" }).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(filterItems([a, b, c], tasks, { ...NO_FILTERS, assignee: "none" }).map((i) => i.id)).toEqual([c.id]);
    expect(filterItems([a, b, c], tasks, { ...NO_FILTERS, format: "Reel" }).map((i) => i.id)).toEqual([c.id]);
    expect(contentType("Facebook video")).toBe("Video");
  });
});

describe("strategy balance", () => {
  const pillars = [{ id: "pa", name: "Education", target_share: 50 }, { id: "pb", name: "Promotion", target_share: 30 }, { id: "pc", name: "Community", target_share: null }];
  const opts = { pillars, funnel: [{ stage: "awareness" as const, label: "Awareness" }, { stage: "conversion" as const, label: "Conversion" }], funnelTargets: new Map([["awareness", 40]]), platforms: [{ platform: "instagram" as const, label: "Instagram", postsPerWeek: 3 }], periodDays: 28 };

  it("compares shares with configured targets only", () => {
    const planned = [...Array(2)].map(() => item({ pillar_id: "pa" })).concat([...Array(5)].map(() => item({ pillar_id: "pb" })), [item({ pillar_id: "pc" }), item({})], [item({ pillar_id: "pa", platform: "facebook" })]);
    const b = strategyBalance(planned, [], opts);
    const edu = b.pillars.find((p) => p.key === "pa")!;
    expect(edu.share).toBe(30);
    expect(edu.status).toBe("under");
    expect(b.pillars.find((p) => p.key === "pb")!.status).toBe("over");
    expect(b.pillars.find((p) => p.key === "pc")!.status).toBe("no-target");
    expect(b.pillars.find((p) => p.key === "none")!.count).toBe(1);
    // 3 posts/week × 4 weeks = 12 expected on Instagram; Facebook has no channel target.
    expect(b.platforms.find((p) => p.key === "instagram")).toMatchObject({ count: 9, target: 12, diff: -3 });
    expect(b.platforms.find((p) => p.key === "facebook")).toMatchObject({ count: 1, target: null });
  });

  it("reads funnel targets only from explicit percentages", () => {
    expect(funnelTargets({ awareness: "About 40% of posts", trust: "Testimonials, case studies", conversion: "10,5 %" })).toEqual(new Map([["awareness", 40], ["conversion", 10.5]]));
    expect(funnelTargets(null).size).toBe(0);
  });
});

describe("production", () => {
  const events = parseStageEvents([
    { content_item_id: "a", body: "idea → brief", created_at: "2026-10-02T09:00:00Z" },
    { content_item_id: "a", body: "in_production → internal_review", created_at: "2026-10-05T09:00:00Z" },
    { content_item_id: "a", body: "Design task: in review", created_at: "2026-10-05T10:00:00Z" },
    { content_item_id: "b", body: "brief → in_production", created_at: "2026-10-20T09:00:00Z" },
  ]);

  it("ignores activity that isn't a stage move", () => {
    expect(events).toHaveLength(3);
  });

  it("measures production and approval time from real timestamps", () => {
    const items = [
      item({ id: "a", created_at: "2026-10-01T09:00:00Z", approved_at: "2026-10-07T09:00:00Z", production_stage: "ready", status: "approved" }),
      item({ id: "b", created_at: "2026-10-10T09:00:00Z", production_stage: "in_production", status: "in_production" }),
    ];
    const pr = production(items, events, P, TODAY, TZ, "2026-10-28T09:00:00Z");
    expect(pr.briefsCompleted).toBe(1);
    expect(pr.enteredReview).toBe(1);
    expect(pr.approved).toBe(1);
    expect(pr.medianProductionDays).toBe(6);
    expect(pr.medianApprovalDays).toBe(2);
    expect(pr.ideasCreated).toBe(2);
    const inProd = pr.stages.find((s) => s.stage === "in_production")!;
    expect(inProd).toMatchObject({ count: 1, medianDays: 8 });
    expect(pr.weeks).toHaveLength(4);
    expect(pr.weeks[0]).toMatchObject({ created: 1, approved: 1 });
  });

  it("returns no duration rather than zero when nothing was approved", () => {
    const pr = production([item({})], [], P, TODAY, TZ, "2026-10-28T09:00:00Z");
    expect(pr.medianProductionDays).toBeNull();
    expect(pr.medianApprovalDays).toBeNull();
    expect(pr.bottleneck).toBeNull();
  });
});

describe("team workload", () => {
  it("lists people alphabetically with their own counts, without ranking", () => {
    const a = item({ assignee_id: "u2", status: "in_production" });
    const tasks = [
      task({ content_item_id: a.id, user_id: "u1", due_date: "2026-10-30" }),
      task({ content_item_id: a.id, user_id: "u1", due_date: "2026-10-30", status: "in_progress" }),
      task({ content_item_id: a.id, user_id: "u1", status: "completed", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }),
      task({ content_item_id: a.id, user_id: "u2", status: "in_review", due_date: "2026-10-20" }),
    ];
    const rows = teamWorkload(tasks, [a], [{ user_id: "u1", name: "Zoé", roleName: null }, { user_id: "u2", name: "Adam", roleName: null }, { user_id: "u3", name: "Idle", roleName: null }], P, TODAY, TZ);
    expect(rows.map((r) => r.name)).toEqual(["Adam", "Zoé"]);
    expect(rows[1]).toMatchObject({ open: 2, completed: 1, dueNext7: 2, overlappingDeadlines: true, medianCompletionDays: 2 });
    expect(rows[0]).toMatchObject({ inReview: 1, overdue: 1, leadOpen: 1 });
  });
});

describe("social performance", () => {
  it("separates unavailable metrics from zero", () => {
    const s = social([perf({ likes: 0, comments: 0, reach: 0 }), perf({ likes: 10, comments: 2, reach: 100, clicks: 4 }), perf({ date: "2026-08-01", likes: 99 })], P);
    expect(s.posts).toBe(2);
    expect(s.reach).toBe(100);
    expect(s.impressions).toBeNull();
    expect(s.available.impressions).toBe(0);
    expect(s.engagement).toBe(12);
    expect(s.ctr).toBe(4);
    expect(s.conversions).toBeNull();
  });

  it("returns nothing invented for an empty period", () => {
    const s = social([], P);
    expect([s.posts, s.reach, s.engagement, s.medianEngagementRate]).toEqual([0, null, null, null]);
  });
});

describe("insights", () => {
  it("states the figures and period behind each insight", () => {
    const planned = [...Array(8)].map(() => item({ pillar_id: "pb", scheduled_date: "2026-10-10" })).concat([item({ pillar_id: "pa", scheduled_date: "2026-10-10", due_date: "2026-10-01", status: "in_production" })]);
    const balance = strategyBalance(planned, [], { pillars: [{ id: "pa", name: "Education", target_share: 40 }, { id: "pb", name: "Promotion", target_share: 60 }], funnel: [], funnelTargets: new Map(), platforms: [], periodDays: 28 });
    const out = insights({
      period: P, balance, overview: overview(planned, [], P, TODAY, TZ), production: production(planned, [], P, TODAY, TZ, "2026-10-28T09:00:00Z"), team: null, social: null,
      links: { strategy: "/s", production: "/p", calendar: "/c?view=list", team: "/t", history: "/h" }, stageLabel: (s) => s,
    });
    const pillar = out.find((i) => i.id === "pillar-pa")!;
    expect(pillar.figures).toContain("11% planned vs 40% target (1 of 9 items, 2026-10-01 – 2026-10-28)");
    expect(pillar.href).toBe("/s");
    expect(out.find((i) => i.id === "overdue")?.href).toBe("/c?view=list&overdue=1");
  });

  it("produces no insight from too little data", () => {
    const balance = strategyBalance([item({ pillar_id: "pb" })], [], { pillars: [{ id: "pa", name: "A", target_share: 50 }, { id: "pb", name: "B", target_share: 50 }], funnel: [], funnelTargets: new Map(), platforms: [], periodDays: 28 });
    const out = insights({ period: P, balance, overview: overview([], [], P, TODAY, TZ), production: production([], [], P, TODAY, TZ, "2026-10-28T09:00:00Z"), team: null, social: null, links: { strategy: "", production: "", calendar: "", team: "", history: "" }, stageLabel: (s) => s });
    expect(out).toEqual([]);
  });
});

describe("csv", () => {
  it("quotes separators and neutralises formulas", () => {
    expect(csvCell('Say "hi", then go')).toBe('"Say ""hi"", then go"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(toCsv([["a", "b"], [1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"');
  });
});
