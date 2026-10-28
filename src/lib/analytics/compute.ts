// Analytics calculations. Pure functions over rows already loaded (and already limited by row-level security),
// so every number on the dashboard can be traced to a definition below and covered by tests.
//
// Dates: every comparison uses calendar dates (YYYY-MM-DD) in the project's time zone.
//   created     = content_items.created_at            (when the idea was added)
//   planned     = content_items.scheduled_date        (planned publication date)
//   published   = content_items.published_at          (actual publication, verified from the platform)
//   deadline    = content_items.due_date / content_assignments.due_date (internal work deadline)
//   approved    = content_items.approved_at           (final approval)

import { utcToZoned, addDays } from "@/lib/calendar/time";
import { engagementOf, engagementRate } from "@/lib/history/performance";
import type { FunnelStage, Platform } from "@/lib/domain/constants";

export type Period = { from: string; to: string };

export type AnalyticsItem = {
  id: string; title: string; status: string; production_stage: string | null; platform: string | null; format: string | null;
  pillar_id: string | null; funnel_stage: string | null; campaign_id: string | null; assignee_id: string | null;
  created_at: string; scheduled_date: string | null; published_at: string | null; due_date: string | null; approved_at: string | null;
};
/** A production stage change from content_activity ("idea → brief"). */
export type StageEvent = { content_item_id: string; from: string; to: string; at: string };
export type AnalyticsTask = {
  id: string; content_item_id: string; user_id: string; task_type: string; status: string; due_date: string | null; created_at: string; updated_at: string;
};
export type PerfRow = {
  id: string; title: string | null; platform: string | null; format: string | null; pillar_id: string | null; campaign_id: string | null; permalink: string | null;
  date: string | null; reach: number | null; impressions: number | null; views: number | null; video_views: number | null; clicks: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null; conversions: number | null; leads: number | null; source: string | null;
  /** YouTube with full access only (minutes). */
  watch_time_minutes?: number | null;
  /** Connected account the post came from (social connection id, or "meta"). */
  account?: string | null;
};
export type Filters = { pillar: string; funnel: string; platform: string; format: string; campaign: string; status: string; assignee: string };

const DONE = new Set(["approved", "scheduled", "published"]);
export const OPEN_STAGES = ["idea", "brief", "in_production", "internal_review", "approval"] as const;
const REVIEW_STAGES = new Set(["internal_review", "approval"]);

export const inPeriod = (d: string | null | undefined, p: Period) => Boolean(d && d >= p.from && d <= p.to);
export const localDate = (iso: string | null | undefined, tz: string) => (iso ? utcToZoned(iso, tz).date : null);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? (n / d) * 100 : null);

/** The period of the same length immediately before `p`. */
export function previousPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

/** Content type from the free-text format (same buckets as the calendar). */
export function contentType(format: string | null) {
  if (!format) return "Post";
  const f = format.toLowerCase();
  if (f.includes("reel")) return "Reel";
  if (f.includes("story")) return "Story";
  if (f.includes("carousel")) return "Carousel";
  if (f.includes("video") || f.includes("short")) return "Video";
  if (f.includes("article") || f.includes("blog")) return "Article";
  if (f.includes("image") || f.includes("photo") || f.includes("caption") || f.includes("post")) return "Post";
  return "Other";
}

/** Applies the shared filters. Collaborator matches the lead or anyone with a task on the item. */
export function filterItems(items: AnalyticsItem[], tasks: AnalyticsTask[], f: Filters) {
  const byCollab = f.assignee && f.assignee !== "none" ? new Set(tasks.filter((t) => t.user_id === f.assignee).map((t) => t.content_item_id)) : null;
  return items.filter((i) =>
    (!f.pillar || (f.pillar === "none" ? !i.pillar_id : i.pillar_id === f.pillar)) &&
    (!f.funnel || i.funnel_stage === f.funnel) &&
    (!f.platform || i.platform === f.platform) &&
    (!f.format || contentType(i.format) === f.format) &&
    (!f.campaign || i.campaign_id === f.campaign) &&
    (!f.status || (i.production_stage ?? "idea") === f.status) &&
    (!f.assignee || (f.assignee === "none" ? !i.assignee_id && !tasks.some((t) => t.content_item_id === i.id) : i.assignee_id === f.assignee || byCollab!.has(i.id))),
  );
}

export const isOverdue = (i: Pick<AnalyticsItem, "due_date" | "status">, today: string) => Boolean(i.due_date && i.due_date < today && !DONE.has(i.status));

// ---------------------------------------------------------------------------
// A. Overview
// ---------------------------------------------------------------------------
export function overview(items: AnalyticsItem[], tasks: AnalyticsTask[], p: Period, today: string, tz: string) {
  const planned = items.filter((i) => inPeriod(i.scheduled_date, p));
  const published = items.filter((i) => i.status === "published" && inPeriod(localDate(i.published_at, tz), p));
  // Completion: of the planned dates that have already passed in the period, how many are published.
  const due = planned.filter((i) => i.scheduled_date! <= today);
  const dueDone = due.filter((i) => i.status === "published");
  const ids = new Set(items.map((i) => i.id));
  return {
    planned: planned.length,
    published: published.length,
    inProduction: items.filter((i) => i.production_stage === "brief" || i.production_stage === "in_production").length,
    awaitingApproval: items.filter((i) => REVIEW_STAGES.has(i.production_stage ?? "")).length,
    overdueContent: items.filter((i) => isOverdue(i, today)).length,
    overdueTasks: tasks.filter((t) => ids.has(t.content_item_id) && t.due_date && t.due_date < today && t.status !== "approved" && t.status !== "completed").length,
    completionRate: pct(dueDone.length, due.length),
    completionBase: due.length,
    upcoming: items.filter((i) => i.scheduled_date && i.scheduled_date >= today && i.scheduled_date <= addDays(today, 7) && i.status !== "published").length,
    approvedInPeriod: items.filter((i) => inPeriod(localDate(i.approved_at, tz), p)).length,
    created: items.filter((i) => inPeriod(localDate(i.created_at, tz), p)).length,
  };
}

// ---------------------------------------------------------------------------
// B. Strategy balance
// ---------------------------------------------------------------------------
export type Share = { key: string; label: string; count: number; share: number; target: number | null; diff: number | null; status: "under" | "over" | "on" | "no-target" };
const TOLERANCE = 5; // percentage points

function shares(rows: { key: string; label: string }[], counts: Map<string, number>, targets: Map<string, number>): Share[] {
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  return rows.map(({ key, label }) => {
    const count = counts.get(key) ?? 0;
    const share = total ? (count / total) * 100 : 0;
    const target = targets.has(key) ? targets.get(key)! : null;
    const diff = target == null ? null : share - target;
    return { key, label, count, share, target, diff, status: diff == null ? "no-target" : diff < -TOLERANCE ? "under" : diff > TOLERANCE ? "over" : "on" };
  });
}
const countBy = <T,>(list: T[], key: (t: T) => string) => list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>());

/** Pulls an explicit "NN%" from the strategy's funnel notes. Only numbers the team wrote count as targets. */
export function funnelTargets(funnel: Record<string, unknown> | null | undefined) {
  const out = new Map<string, number>();
  for (const [stage, note] of Object.entries(funnel ?? {})) {
    const m = typeof note === "string" ? note.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/) : null;
    if (m) out.set(stage, Number(m[1].replace(",", ".")));
  }
  return out;
}

export function strategyBalance(
  planned: AnalyticsItem[],
  published: AnalyticsItem[],
  opts: {
    pillars: { id: string; name: string; target_share: number | null }[];
    funnel: { stage: FunnelStage; label: string }[];
    funnelTargets: Map<string, number>;
    platforms: { platform: Platform; label: string; postsPerWeek: number | null }[];
    periodDays: number;
  },
) {
  const pillarRows = [...opts.pillars.map((p) => ({ key: p.id, label: p.name })), { key: "none", label: "No pillar" }];
  const pillarTargets = new Map(opts.pillars.filter((p) => p.target_share != null).map((p) => [p.id, Number(p.target_share)]));
  const pillars = shares(pillarRows, countBy(planned, (i) => i.pillar_id ?? "none"), pillarTargets).filter((s) => s.key !== "none" || s.count);
  const funnel = shares(opts.funnel.map((f) => ({ key: f.stage, label: f.label })), countBy(planned.filter((i) => i.funnel_stage), (i) => i.funnel_stage!), opts.funnelTargets);
  const platformCounts = countBy(planned, (i) => i.platform ?? "none");
  const weeks = opts.periodDays / 7;
  const platforms = opts.platforms.map((pl) => {
    const count = platformCounts.get(pl.platform) ?? 0;
    const target = pl.postsPerWeek != null ? Math.round(pl.postsPerWeek * weeks * 10) / 10 : null;
    return { key: pl.platform as string, label: pl.label, count, target, diff: target == null ? null : count - target };
  });
  for (const [k, count] of platformCounts) if (k !== "none" && !platforms.some((p) => p.key === k)) platforms.push({ key: k, label: k, count, target: null, diff: null });
  const typeRows = ["Post", "Carousel", "Reel", "Story", "Video", "Article", "Other"].map((t) => ({ key: t, label: t }));
  const types = shares(typeRows, countBy(planned, (i) => contentType(i.format)), new Map()).filter((s) => s.count);
  // Planned vs published mix by pillar
  const pubShares = shares(pillarRows, countBy(published, (i) => i.pillar_id ?? "none"), new Map());
  const mix = pillars.map((s) => ({ key: s.key, label: s.label, planned: s.share, published: pubShares.find((x) => x.key === s.key)?.share ?? 0, plannedCount: s.count, publishedCount: pubShares.find((x) => x.key === s.key)?.count ?? 0 }));
  return { total: planned.length, pillars, funnel, funnelTagged: planned.filter((i) => i.funnel_stage).length, platforms, types, mix, publishedTotal: published.length };
}

// ---------------------------------------------------------------------------
// C. Production performance
// ---------------------------------------------------------------------------
const STAGE_RE = /^([a-z_]+) → ([a-z_]+)$/;
export function parseStageEvents(rows: { content_item_id: string; body: string; created_at: string }[]): StageEvent[] {
  return rows.flatMap((r) => {
    const m = r.body.match(STAGE_RE);
    return m ? [{ content_item_id: r.content_item_id, from: m[1], to: m[2], at: r.created_at }] : [];
  });
}

export function production(items: AnalyticsItem[], events: StageEvent[], p: Period, today: string, tz: string, nowIso: string) {
  const byItem = new Map<string, StageEvent[]>();
  for (const e of events) byItem.set(e.content_item_id, [...(byItem.get(e.content_item_id) ?? []), e]);
  for (const list of byItem.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const ids = new Set(items.map((i) => i.id));
  const ev = events.filter((e) => ids.has(e.content_item_id));
  const entered = (stage: string) => new Set(ev.filter((e) => e.to === stage && inPeriod(localDate(e.at, tz), p)).map((e) => e.content_item_id));

  // Durations, measured only where both timestamps exist.
  const approved = items.filter((i) => i.approved_at && inPeriod(localDate(i.approved_at, tz), p));
  const productionHours = approved.map((i) => hours(i.created_at, i.approved_at!)).filter((h) => h >= 0);
  const approvalHours = approved.flatMap((i) => {
    const firstReview = (byItem.get(i.id) ?? []).find((e) => REVIEW_STAGES.has(e.to));
    return firstReview && firstReview.at <= i.approved_at! ? [hours(firstReview.at, i.approved_at!)] : [];
  });

  // Where items wait now: count and median days since they entered their current stage.
  const stages = OPEN_STAGES.map((stage) => {
    const here = items.filter((i) => (i.production_stage ?? "idea") === stage && i.status !== "published");
    const ages = here.map((i) => {
      const last = [...(byItem.get(i.id) ?? [])].reverse().find((e) => e.to === stage);
      return (Date.parse(nowIso) - Date.parse(last?.at ?? i.created_at)) / 86_400_000;
    });
    return { stage, count: here.length, medianDays: median(ages), overdue: here.filter((i) => isOverdue(i, today)).length };
  });
  const bottleneck = [...stages].filter((s) => s.stage !== "idea" && s.count > 0).sort((a, b) => b.count * (b.medianDays ?? 0) - a.count * (a.medianDays ?? 0))[0] ?? null;

  // Weekly throughput inside the period: created, approved, published.
  const weeks: { week: string; created: number; approved: number; published: number }[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 7)) weeks.push({ week: d, created: 0, approved: 0, published: 0 });
  const bucket = (date: string | null) => (date && inPeriod(date, p) ? Math.floor(daysBetween(p.from, date) / 7) : -1);
  for (const i of items) {
    const c = bucket(localDate(i.created_at, tz)); if (c >= 0) weeks[c].created++;
    const a = bucket(localDate(i.approved_at, tz)); if (a >= 0) weeks[a].approved++;
    const pu = i.status === "published" ? bucket(localDate(i.published_at, tz)) : -1; if (pu >= 0) weeks[pu].published++;
  }

  return {
    ideasCreated: items.filter((i) => inPeriod(localDate(i.created_at, tz), p)).length,
    briefsCompleted: entered("brief").size,
    enteredReview: new Set([...entered("internal_review"), ...entered("approval")]).size,
    approved: approved.length,
    published: items.filter((i) => i.status === "published" && inPeriod(localDate(i.published_at, tz), p)).length,
    overdue: items.filter((i) => isOverdue(i, today)).length,
    medianProductionDays: productionHours.length ? median(productionHours)! / 24 : null,
    productionSample: productionHours.length,
    medianApprovalDays: approvalHours.length ? median(approvalHours)! / 24 : null,
    approvalSample: approvalHours.length,
    stages,
    bottleneck,
    weeks,
  };
}

// ---------------------------------------------------------------------------
// D. Team workload (no ranking: alphabetical, with the context of each person's assignments)
// ---------------------------------------------------------------------------
export function teamWorkload(
  tasks: AnalyticsTask[], items: AnalyticsItem[], people: { user_id: string; name: string; roleName: string | null }[], p: Period, today: string, tz: string,
) {
  const ids = new Set(items.map((i) => i.id));
  const scoped = tasks.filter((t) => ids.has(t.content_item_id));
  const closed = (s: string) => s === "approved" || s === "completed";
  const rows = people.map((person) => {
    const mine = scoped.filter((t) => t.user_id === person.user_id);
    const done = mine.filter((t) => closed(t.status) && inPeriod(localDate(t.updated_at, tz), p));
    const open = mine.filter((t) => !closed(t.status));
    const deadlines = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7)).map((t) => t.due_date!);
    const sameDay = [...countBy(deadlines, (d) => d).values()].some((n) => n >= 2);
    const durations = done.map((t) => hours(t.created_at, t.updated_at) / 24).filter((d) => d >= 0);
    return {
      ...person,
      assigned: mine.length,
      open: open.filter((t) => t.status !== "in_review").length,
      inReview: open.filter((t) => t.status === "in_review").length,
      changesRequested: open.filter((t) => t.status === "changes_requested").length,
      completed: done.length,
      overdue: open.filter((t) => t.due_date && t.due_date < today).length,
      dueNext7: deadlines.length,
      overlappingDeadlines: sameDay,
      leadOpen: items.filter((i) => i.assignee_id === person.user_id && !DONE.has(i.status)).length,
      medianCompletionDays: median(durations),
      completionSample: durations.length,
    };
  }).filter((r) => r.assigned || r.leadOpen);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// E. Social performance (only metrics the sources returned)
// ---------------------------------------------------------------------------
const METRIC_KEYS = ["reach", "impressions", "views", "video_views", "clicks", "conversions", "leads", "watch_time_minutes"] as const;
export function social(rows: PerfRow[], p: Period) {
  const inP = rows.filter((r) => inPeriod(r.date, p));
  const available = Object.fromEntries(METRIC_KEYS.map((k) => [k, inP.filter((r) => r[k] != null).length])) as Record<(typeof METRIC_KEYS)[number], number>;
  const sum = (k: (typeof METRIC_KEYS)[number]) => (available[k] ? inP.reduce((s, r) => s + (r[k] ?? 0), 0) : null);
  const engaged = inP.map((r) => ({ r, e: engagementOf(r) })).filter((x) => x.e != null);
  const rates = inP.map((r) => engagementRate(r)).filter((x): x is number => x != null);
  const clicksWithReach = inP.filter((r) => r.clicks != null && r.reach);
  const group = (key: (r: PerfRow) => string) => {
    const m = new Map<string, PerfRow[]>();
    for (const r of inP) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m].map(([k, list]) => {
      const es = list.map((r) => engagementOf(r)).filter((x): x is number => x != null);
      const rs = list.map((r) => engagementRate(r)).filter((x): x is number => x != null);
      const sumOf = (f: (r: PerfRow) => number | null | undefined) => (list.some((r) => f(r) != null) ? list.reduce((s, r) => s + (f(r) ?? 0), 0) : null);
      return {
        key: k, posts: list.length, medianEngagement: median(es), medianRate: median(rs), rateSample: rs.length,
        reach: sumOf((r) => r.reach), views: sumOf((r) => r.video_views ?? r.views), engagement: es.length ? es.reduce((s, x) => s + x, 0) : null,
      };
    }).sort((a, b) => b.posts - a.posts);
  };
  const ranked = engaged.sort((a, b) => b.e! - a.e!);
  return {
    posts: inP.length,
    available,
    reach: sum("reach"), impressions: sum("impressions"), views: sum("views"), videoViews: sum("video_views"),
    clicks: sum("clicks"), conversions: sum("conversions"), leads: sum("leads"), watchTime: sum("watch_time_minutes"),
    engagement: engaged.length ? engaged.reduce((s, x) => s + x.e!, 0) : null,
    engagementSample: engaged.length,
    medianEngagementRate: median(rates),
    rateSample: rates.length,
    ctr: clicksWithReach.length ? (clicksWithReach.reduce((s, r) => s + r.clicks!, 0) / clicksWithReach.reduce((s, r) => s + r.reach!, 0)) * 100 : null,
    byPlatform: group((r) => r.platform ?? "unknown"),
    byFormat: group((r) => contentType(r.format)),
    byPillar: group((r) => r.pillar_id ?? "none"),
    top: ranked.slice(0, 5).map((x) => ({ ...x.r, engagement: x.e })),
    bottom: ranked.length > 10 ? ranked.slice(-5).reverse().map((x) => ({ ...x.r, engagement: x.e })) : [],
  };
}

/** Interactions per week and platform inside the period (only posts that report interactions). */
export function socialWeekly(rows: PerfRow[], p: Period) {
  const inP = rows.filter((r) => inPeriod(r.date, p));
  const platforms = [...new Set(inP.map((r) => r.platform ?? "unknown"))];
  const weeks: ({ week: string } & Record<string, number | string>)[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 7)) weeks.push({ week: d, ...Object.fromEntries(platforms.map((pl) => [pl, 0])) });
  for (const r of inP) {
    const e = engagementOf(r);
    if (e == null) continue;
    const w = weeks[Math.floor(daysBetween(p.from, r.date!) / 7)];
    if (w) w[r.platform ?? "unknown"] = (w[r.platform ?? "unknown"] as number) + e;
  }
  return { platforms, weeks };
}

/**
 * Audience growth per connected account from daily snapshots: first and last recorded follower count inside the
 * period. The change is null with a single snapshot, since growth can't be measured from one point.
 */
export function audienceGrowth(snapshots: { connection_id: string; snapshot_date: string; followers: number | null }[], p: Period) {
  const by = new Map<string, { date: string; followers: number }[]>();
  for (const s of snapshots) if (s.followers != null && inPeriod(s.snapshot_date, p)) by.set(s.connection_id, [...(by.get(s.connection_id) ?? []), { date: s.snapshot_date, followers: s.followers }]);
  return [...by].map(([id, list]) => {
    const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0], last = sorted[sorted.length - 1];
    return { connection_id: id, from: first.date, to: last.date, start: first.followers, end: last.followers, change: sorted.length > 1 ? last.followers - first.followers : null, points: sorted.length };
  });
}

// ---------------------------------------------------------------------------
// Insights: measured facts with their figures, plus a suggested next step (labelled as a suggestion)
// ---------------------------------------------------------------------------
export type Insight = { id: string; tone: "warning" | "info" | "positive"; fact: string; figures: string; action?: string; href?: string };

export function insights(input: {
  period: Period;
  balance: ReturnType<typeof strategyBalance>;
  overview: ReturnType<typeof overview>;
  production: ReturnType<typeof production>;
  team: ReturnType<typeof teamWorkload> | null;
  social: { now: ReturnType<typeof social>; prev: ReturnType<typeof social> } | null;
  links: { strategy: string; production: string; calendar: string; team: string; history: string };
  stageLabel: (s: string) => string;
}): Insight[] {
  const out: Insight[] = [];
  const { balance, overview: o, production: pr, links } = input;
  const range = `${input.period.from} – ${input.period.to}`;
  if (balance.total >= 5) {
    for (const s of balance.pillars.filter((x) => x.status === "under")) {
      out.push({ id: `pillar-${s.key}`, tone: "warning", fact: `“${s.label}” is below its target share of planned content.`, figures: `${s.share.toFixed(0)}% planned vs ${s.target}% target (${s.count} of ${balance.total} items, ${range}).`, action: "Plan more content for this pillar, or revisit the target in the strategy.", href: links.strategy });
    }
    const topFunnel = [...balance.funnel].sort((a, b) => b.share - a.share)[0];
    if (topFunnel && balance.funnelTagged >= 5 && topFunnel.share >= 60 && balance.funnel.filter((x) => x.count).length > 1) {
      out.push({ id: "funnel-concentration", tone: "info", fact: `Most planned content with a funnel stage targets ${topFunnel.label}.`, figures: `${topFunnel.share.toFixed(0)}% of ${balance.funnelTagged} tagged items (${range}).`, action: "Check that the other stages of the funnel get enough content.", href: links.calendar });
    }
    for (const pl of balance.platforms.filter((x) => x.target != null && x.target >= 2 && x.count < x.target * 0.7)) {
      out.push({ id: `platform-${pl.key}`, tone: "warning", fact: `${pl.label} has fewer planned posts than its target rhythm.`, figures: `${pl.count} planned vs ${pl.target} expected from the channel target (${range}).`, action: "Add posts for this channel in the calendar.", href: links.calendar });
    }
  }
  if (o.overdueContent > 0) {
    out.push({ id: "overdue", tone: "warning", fact: `${o.overdueContent} item${o.overdueContent === 1 ? " is" : "s are"} past the internal deadline and not yet approved.`, figures: `${o.overdueTasks} open task${o.overdueTasks === 1 ? "" : "s"} are also past due (as of today).`, action: "Review overdue work in the calendar.", href: `${links.calendar}&overdue=1` });
  }
  if (pr.bottleneck && pr.bottleneck.count >= 3) {
    out.push({ id: "bottleneck", tone: REVIEW_STAGES.has(pr.bottleneck.stage) ? "warning" : "info", fact: `Content waits longest in ${input.stageLabel(pr.bottleneck.stage)}.`, figures: `${pr.bottleneck.count} items there now, median ${pr.bottleneck.medianDays?.toFixed(1) ?? "?"} days since they arrived.`, action: REVIEW_STAGES.has(pr.bottleneck.stage) ? "Schedule review time, or add a reviewer." : "Check what blocks these items.", href: links.production });
  }
  if (o.completionBase >= 5 && o.completionRate != null && o.completionRate < 70) {
    out.push({ id: "completion", tone: "warning", fact: "Fewer posts were published than planned for dates that have passed.", figures: `${o.completionRate.toFixed(0)}% published (${Math.round((o.completionRate / 100) * o.completionBase)} of ${o.completionBase}, ${range}). Only publications verified from a connected platform count.`, action: "Verify publications in the calendar, or reschedule what slipped.", href: links.calendar });
  }
  for (const m of input.team?.filter((t) => t.overlappingDeadlines) ?? []) {
    out.push({ id: `team-${m.user_id}`, tone: "info", fact: `${m.name} has several task deadlines on the same day in the next week.`, figures: `${m.dueNext7} deadlines in the next 7 days, ${m.open + m.inReview} open tasks.`, action: "Consider spreading these deadlines.", href: links.team });
  }
  if (input.social && input.social.now.rateSample >= 5 && input.social.prev.rateSample >= 5) {
    const a = input.social.now.medianEngagementRate!, b = input.social.prev.medianEngagementRate!;
    const change = b ? ((a - b) / b) * 100 : null;
    if (change != null && Math.abs(change) >= 15) {
      out.push({ id: "social-trend", tone: change > 0 ? "positive" : "warning", fact: `Median engagement rate is ${change > 0 ? "up" : "down"} versus the previous period.`, figures: `${a.toFixed(2)}% (${input.social.now.rateSample} posts) vs ${b.toFixed(2)}% (${input.social.prev.rateSample} posts). A change in rate doesn't say why it changed.`, href: links.history });
    }
  }
  return out;
}
