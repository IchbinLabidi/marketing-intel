// The CEO layer: turns the measured figures into plain-language conclusions.
// Rules only. Every sentence is built from a number that was measured; when a number is missing or too small to
// judge, the output says so instead of guessing.

import type { overview, production, social, strategyBalance, teamWorkload } from "./compute";
import { createFormatter } from "@/i18n/format";
import type { TFor } from "@/i18n/messages";

export type Tone = "good" | "watch" | "attention" | "neutral";

export type CeoInput = {
  period: { from: string; to: string };
  periodDays: number;
  overview: ReturnType<typeof overview>;
  overviewPrev: ReturnType<typeof overview> | null;
  production: ReturnType<typeof production>;
  productionPrev: ReturnType<typeof production> | null;
  balance: ReturnType<typeof strategyBalance>;
  targetsOff: boolean;
  hasPillarTargets: boolean;
  hasChannelTargets: boolean;
  team: ReturnType<typeof teamWorkload> | null;
  social: ReturnType<typeof social> | null;
  socialPrev: ReturnType<typeof social> | null;
  canSeeSocial: boolean;
  meta: { status: string; lastSyncStatus: string | null; error: string | null } | null;
  /** Connected YouTube / LinkedIn / TikTok accounts. */
  otherConnected?: number;
  /** Connected accounts whose access expired, lacks a permission, or whose last sync failed. */
  failingAccounts?: string[];
  kpiCount: number;
  stageLabel: (s: string) => string;
  links: { strategy: string; calendar: string; overdue: string; production: string; team: string; history: string; settings: string; integrations?: string };
};

const change = (now: number | null | undefined, prev: number | null | undefined) => (now == null || prev == null || prev === 0 ? null : ((now - prev) / prev) * 100);
const REVIEW = new Set(["internal_review", "approval"]);

/** Locale-aware number helpers for the generated sentences (same rounding as before, only the language changes). */
function numbers(t: TFor<"analytics">) {
  const fmt = createFormatter(t.locale);
  return {
    /** A 0–100 value as a rounded percentage ("12%" / "12 %"). */
    pct: (v: number) => fmt.percent(Math.round(v) / 100),
    /** A target share as written by the team (up to 2 decimals). */
    target: (v: number) => fmt.percent(v / 100, 2),
    /** A 0–100 rate with exactly 2 decimals ("3.25%"). */
    rate: (v: number) => fmt.number(v / 100, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    /** A number with exactly `d` decimals (like toFixed). */
    fixed: (v: number, d = 1) => fmt.number(v, { minimumFractionDigits: d, maximumFractionDigits: d }),
  };
}
// Posts needed in both periods before comparing how the audience responds.
export const MIN_POSTS = 10;

// ---------------------------------------------------------------------------
// Action center: real issues, ranked. Nothing is produced without the numbers behind it.
// ---------------------------------------------------------------------------
export type Issue = {
  id: string; severity: 1 | 2 | 3; // 1 = act now, 2 = this week, 3 = keep an eye on
  title: string; evidence: string; impact?: string; next: string; href: string; linkLabel: string;
};

export function actionCenter(i: CeoInput, t: TFor<"analytics">): Issue[] {
  const out: Issue[] = [];
  const o = i.overview, pr = i.production, b = i.balance;
  const f = numbers(t);
  const sep = t("labels.listSeparator");

  // Delivery: overdue and slipped publications
  if (o.overdueContent > 0) {
    out.push({
      id: "overdue", severity: o.overdueContent >= 5 ? 1 : 2,
      title: t("issues.overdue.title", { count: o.overdueContent }),
      evidence: `${t("issues.overdue.evidence")}${o.overdueTasks ? ` ${t("issues.overdue.evidenceTasks", { count: o.overdueTasks })}` : ""}`,
      impact: t("issues.overdue.impact"),
      next: t("issues.overdue.next"),
      href: i.links.overdue, linkLabel: t("issues.links.lateItems"),
    });
  }
  const slipped = o.completionBase - Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  if (o.completionBase >= 5 && o.completionRate != null && o.completionRate < 80 && slipped >= 3) {
    out.push({
      id: "slipped", severity: o.completionRate < 50 ? 1 : 2,
      title: t("issues.slipped.title", { count: slipped }),
      evidence: t("issues.slipped.evidence", { done: o.completionBase - slipped, base: o.completionBase, rate: f.pct(o.completionRate) }),
      impact: t("issues.slipped.impact"),
      next: t("issues.slipped.next"),
      href: i.links.calendar, linkLabel: t("issues.links.calendar"),
    });
  }

  // Approval bottleneck
  const review = pr.stages.filter((s) => REVIEW.has(s.stage));
  const waiting = review.reduce((s, x) => s + x.count, 0);
  const longest = Math.max(0, ...review.map((s) => s.medianDays ?? 0));
  if (waiting >= 3 && longest >= 2) {
    out.push({
      id: "approval", severity: longest >= 5 ? 1 : 2,
      title: t("issues.approval.title"),
      evidence: t("issues.approval.evidence", { count: waiting, days: f.fixed(longest) }),
      impact: t("issues.approval.impact"),
      next: t("issues.approval.next"),
      href: i.links.production, linkLabel: t("issues.links.production"),
    });
  } else if (pr.bottleneck && pr.bottleneck.count >= 10 && (pr.bottleneck.medianDays ?? 0) >= 3) {
    out.push({
      id: "bottleneck", severity: 3,
      title: t("issues.bottleneck.title", { stage: i.stageLabel(pr.bottleneck.stage) }),
      evidence: t("issues.bottleneck.evidence", { count: pr.bottleneck.count, days: f.fixed(pr.bottleneck.medianDays!) }),
      next: t("issues.bottleneck.next"),
      href: i.links.production, linkLabel: t("issues.links.production"),
    });
  }

  // Strategy: pillars and channels under target
  if (!i.targetsOff && b.total >= 5) {
    for (const s of b.pillars.filter((x) => x.status === "under")) {
      const needed = Math.max(1, Math.ceil((s.target! / 100) * b.total - s.count));
      out.push({
        id: `pillar-${s.key}`, severity: s.diff! < -10 ? 1 : 2,
        title: t("issues.pillar.title", { label: s.label }),
        evidence: t("issues.pillar.evidence", { share: f.pct(s.share), target: f.target(s.target!), count: s.count, total: b.total }),
        impact: t("issues.pillar.impact", { count: needed }),
        next: t("issues.pillar.next"),
        href: i.links.calendar, linkLabel: t("issues.links.plan"),
      });
    }
    // One issue for all channels behind their posting rhythm, so the same advice isn't repeated per channel.
    const behind = b.platforms.filter((x) => x.target != null && x.target >= 2 && x.count < x.target * 0.7);
    if (behind.length) {
      const names = behind.map((p) => p.label);
      out.push({
        id: "platforms", severity: behind.some((p) => p.count === 0) ? 2 : 3,
        title: behind.length === 1 ? t("issues.platforms.titleOne", { name: names[0] }) : t("issues.platforms.titleMany", { count: behind.length }),
        evidence: t("issues.platforms.evidence", { items: behind.map((p) => t("issues.platforms.evidenceItem", { label: p.label, count: p.count, target: Math.round(p.target!) })).join(sep) }),
        impact: t("issues.platforms.impact"),
        next: behind.length === 1 ? t("issues.platforms.nextOne", { names: names.join(", ") }) : t("issues.platforms.nextMany", { names: names.join(", ") }),
        href: i.links.calendar, linkLabel: t("issues.links.calendar"),
      });
    }
  }

  // Nothing planned ahead
  if (o.upcoming === 0 && i.hasChannelTargets) {
    out.push({
      id: "no-upcoming", severity: 2,
      title: t("issues.noUpcoming.title"),
      evidence: t("issues.noUpcoming.evidence"),
      impact: t("issues.noUpcoming.impact"),
      next: t("issues.noUpcoming.next"),
      href: i.links.calendar, linkLabel: t("issues.links.calendar"),
    });
  }

  // Team balance (only for people allowed to see the team)
  if (i.team && i.team.length >= 2) {
    const loads = i.team.map((x) => x.open + x.inReview);
    const sorted = [...loads].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const busiest = i.team.reduce((a, x) => (x.open + x.inReview > a.open + a.inReview ? x : a));
    const top = busiest.open + busiest.inReview;
    if (top >= 6 && top >= Math.max(2, median) * 2) {
      out.push({
        id: "workload", severity: 2,
        title: t("issues.workload.title"),
        evidence: t("issues.workload.evidence", { name: busiest.name, count: top, median }),
        impact: t("issues.workload.impact"),
        next: t("issues.workload.next"),
        href: i.links.team, linkLabel: t("issues.links.team"),
      });
    }
  }

  // Data availability
  if (i.canSeeSocial) {
    if ((!i.meta || i.meta.status === "disconnected") && !i.otherConnected) {
      out.push({
        id: "no-data", severity: 3,
        title: t("issues.noData.title"),
        evidence: t("issues.noData.evidence"),
        impact: t("issues.noData.impact"),
        next: t("issues.noData.next"),
        href: i.links.integrations ?? i.links.history, linkLabel: t("issues.links.integrations"),
      });
    } else if (i.meta && (i.meta.status === "expired" || i.meta.status === "error" || i.meta.lastSyncStatus === "failed")) {
      out.push({
        id: "sync-failed", severity: 2,
        title: t("issues.syncFailed.title"),
        evidence: i.meta.error ? t("issues.syncFailed.evidenceError", { error: i.meta.error.slice(0, 140) }) : t("issues.syncFailed.evidence"),
        impact: t("issues.syncFailed.impact"),
        next: t("issues.syncFailed.next"),
        href: i.links.integrations ?? i.links.history, linkLabel: t("issues.links.fixConnection"),
      });
    }
  }

  if (i.canSeeSocial && i.failingAccounts?.length) {
    out.push({
      id: "accounts-failing", severity: 2,
      title: t("issues.accountsFailing.title", { count: i.failingAccounts.length }),
      evidence: t("issues.accountsFailing.evidence", { accounts: i.failingAccounts.join(", ") }),
      impact: t("issues.accountsFailing.impact"),
      next: t("issues.accountsFailing.next"),
      href: i.links.integrations ?? i.links.history, linkLabel: t("issues.links.integrations"),
    });
  }

  // Performance trend
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate);
    if (c != null && c <= -15) {
      out.push({
        id: "engagement-down", severity: 3,
        title: t("issues.engagementDown.title"),
        evidence: t("issues.engagementDown.evidence", { now: f.rate(i.social.medianEngagementRate!), prev: f.rate(i.socialPrev.medianEngagementRate!), nowCount: i.social.rateSample, prevCount: i.socialPrev.rateSample }),
        next: t("issues.engagementDown.next"),
        href: i.links.history, linkLabel: t("issues.links.performance"),
      });
    }
  }

  return out.sort((a, b) => a.severity - b.severity);
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------
export type Point = { text: string; tone: Tone };
export type Signal = { label: string; tone: Tone; evidence: string };

export function executiveSummary(i: CeoInput, issues: Issue[], t: TFor<"analytics">) {
  const o = i.overview, p = i.overviewPrev, pr = i.production, b = i.balance;
  const f = numbers(t);
  const signals: Signal[] = [];

  // Delivery against plan
  if (o.completionBase >= 5 && o.completionRate != null) {
    signals.push({ label: t("summary.signals.delivery.label"), tone: o.completionRate >= 85 ? "good" : o.completionRate >= 60 ? "watch" : "attention", evidence: t("summary.signals.delivery.evidence", { rate: f.pct(o.completionRate), base: o.completionBase }) });
  }
  // Deadlines
  const open = pr.stages.reduce((s, x) => s + x.count, 0);
  if (open > 0) {
    signals.push({ label: t("summary.signals.deadlines.label"), tone: o.overdueContent === 0 ? "good" : o.overdueContent >= 5 || (o.overdueContent >= 3 && o.overdueContent / open > 0.2) ? "attention" : "watch", evidence: o.overdueContent ? t("summary.signals.deadlines.late", { count: o.overdueContent }) : t("summary.signals.deadlines.none") });
  }
  // Strategy balance
  const withTarget = b.pillars.filter((s) => s.target != null);
  if (!i.targetsOff && b.total >= 5 && withTarget.length) {
    const under = withTarget.filter((s) => s.status === "under");
    const over = withTarget.filter((s) => s.status === "over");
    signals.push({ label: t("summary.signals.strategy.label"), tone: under.length === 0 ? "good" : under.some((s) => s.diff! < -10) ? "attention" : "watch", evidence: under.length ? t("summary.signals.strategy.under", { count: under.length, names: under.map((s) => s.label).join(", ") }) : over.length ? t("summary.signals.strategy.over", { items: over.map((s) => t("summary.signals.strategy.overItem", { label: s.label, share: f.pct(s.share), target: f.target(s.target!) })).join(", ") }) : t("summary.signals.strategy.allOn", { count: withTarget.length }) });
  }
  // Approvals
  const reviewWait = Math.max(0, ...pr.stages.filter((s) => REVIEW.has(s.stage) && s.count).map((s) => s.medianDays ?? 0));
  const reviewCount = pr.stages.filter((s) => REVIEW.has(s.stage)).reduce((s, x) => s + x.count, 0);
  if (reviewCount > 0) signals.push({ label: t("summary.signals.approvals.label"), tone: reviewWait >= 5 ? "attention" : reviewWait >= 2 ? "watch" : "good", evidence: t("summary.signals.approvals.evidence", { count: reviewCount, days: f.fixed(reviewWait) }) });
  // Audience response
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate)!;
    // The audience isn't under the team's direct control, so on its own it never raises the rating above "watch".
    signals.push({ label: t("summary.signals.audience.label"), tone: c >= -5 ? "good" : "watch", evidence: c >= 0 ? t("summary.signals.audience.up", { change: f.pct(Math.abs(Math.round(c))) }) : t("summary.signals.audience.down", { change: f.pct(Math.abs(Math.round(c))) }) });
  }

  const enough = signals.length >= 2;
  const level: "good" | "watch" | "attention" | "insufficient" = !enough ? "insufficient" : signals.some((s) => s.tone === "attention") ? "attention" : signals.some((s) => s.tone === "watch") ? "watch" : "good";
  const headline = t(`summary.headline.${level}`);

  // Going well
  const wins: Point[] = [];
  if (o.completionBase >= 5 && o.completionRate != null && o.completionRate >= 85) wins.push({ tone: "good", text: t("summary.wins.completion", { rate: f.pct(o.completionRate) }) });
  if (p && o.published > p.published && o.published >= 3) wins.push({ tone: "good", text: t("summary.wins.published", { count: o.published, prev: p.published }) });
  if (o.overdueContent === 0 && open > 0) wins.push({ tone: "good", text: t("summary.wins.noLate") });
  if (!i.targetsOff && b.total >= 5 && withTarget.length && withTarget.every((s) => s.status === "on")) wins.push({ tone: "good", text: t("summary.wins.balance") });
  if (i.productionPrev && pr.medianProductionDays != null && i.productionPrev.medianProductionDays != null && pr.medianProductionDays < i.productionPrev.medianProductionDays * 0.85) wins.push({ tone: "good", text: t("summary.wins.faster", { now: f.fixed(pr.medianProductionDays), prev: f.fixed(i.productionPrev.medianProductionDays) }) });
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate);
    if (c != null && c >= 15) wins.push({ tone: "good", text: t("summary.wins.engagement", { now: f.rate(i.social.medianEngagementRate!), prev: f.rate(i.socialPrev.medianEngagementRate!) }) });
  }
  if (i.social && i.socialPrev && i.social.reach != null && i.socialPrev.reach != null && i.socialPrev.reach > 0 && i.social.reach > i.socialPrev.reach * 1.15) wins.push({ tone: "good", text: t("summary.wins.reach", { reach: i.social.reach, change: f.pct(change(i.social.reach, i.socialPrev.reach)!) }) });
  if (pr.ideasCreated >= 10) wins.push({ tone: "neutral", text: t("summary.wins.ideas", { count: pr.ideasCreated }) });

  // Needs attention: the top issues that aren't about schedule
  const scheduleIds = new Set(["overdue", "slipped", "approval", "bottleneck", "no-upcoming"]);
  const concerns: Point[] = issues.filter((x) => !scheduleIds.has(x.id)).slice(0, 4).map((x) => ({ tone: x.severity === 1 ? "attention" : "watch", text: t("summary.concern", { title: x.title, evidence: x.evidence }) }));

  // Behind schedule
  const behind: Point[] = [];
  if (o.overdueContent) behind.push({ tone: o.overdueContent >= 5 ? "attention" : "watch", text: t("summary.behind.late", { count: o.overdueContent }) });
  if (o.overdueTasks) behind.push({ tone: "watch", text: t("summary.behind.tasks", { count: o.overdueTasks }) });
  const slipped = o.completionBase - Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  if (slipped > 0) behind.push({ tone: slipped >= 3 ? "attention" : "watch", text: t("summary.behind.slipped", { count: slipped }) });
  if (reviewCount) behind.push({ tone: reviewWait >= 2 ? "watch" : "neutral", text: t("summary.behind.waiting", { count: reviewCount, days: f.fixed(reviewWait) }) });

  return { level, headline, signals, wins: wins.slice(0, 4), concerns, behind, actions: issues.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// The five questions a CEO asks
// ---------------------------------------------------------------------------
export type Answer = { question: string; answer: string; tone: Tone; href?: string };

export function fiveQuestions(i: CeoInput, issues: Issue[], t: TFor<"analytics">): Answer[] {
  const o = i.overview, b = i.balance;
  const f = numbers(t);
  const sep = t("labels.listSeparator");
  const under = b.pillars.filter((s) => s.status === "under");
  const qStrategy = t("questions.strategy.question");
  const strategy: Answer = i.targetsOff
    ? { question: qStrategy, tone: "neutral", answer: t("questions.strategy.filtered") }
    : !i.hasPillarTargets
      ? { question: qStrategy, tone: "neutral", answer: t("questions.strategy.noTargets"), href: i.links.strategy }
      : b.total < 5
        ? { question: qStrategy, tone: "neutral", answer: b.total ? t("questions.strategy.tooFew", { count: b.total }) : t("questions.strategy.nothing") }
        : under.length
          ? { question: qStrategy, tone: "watch", answer: t("questions.strategy.partly", { items: under.map((s) => t("questions.strategy.partlyItem", { label: s.label, share: f.pct(s.share), target: f.target(s.target!) })).join(sep) }), href: i.links.strategy }
          : b.pillars.some((s) => s.status === "over")
            ? { question: qStrategy, tone: "good", answer: t("questions.strategy.mostly", { items: b.pillars.filter((s) => s.status === "over").map((s) => t("questions.strategy.mostlyItem", { label: s.label, share: f.pct(s.share), target: f.target(s.target!) })).join(sep) }), href: i.links.strategy }
            : { question: qStrategy, tone: "good", answer: t("questions.strategy.yes", { count: b.total }) };

  const qDelivery = t("questions.delivery.question");
  const late = o.overdueContent ? ` ${t("questions.delivery.pastDeadline", { count: o.overdueContent })}` : "";
  const delivery: Answer = o.completionBase < 5 || o.completionRate == null
    ? { question: qDelivery, tone: "neutral", answer: o.completionBase ? `${t("questions.delivery.tooFew", { count: o.completionBase })}${late}` : `${t("questions.delivery.none")}${late}` }
    : { question: qDelivery, tone: o.completionRate >= 85 && !o.overdueContent ? "good" : o.completionRate >= 60 ? "watch" : "attention", answer: `${t("questions.delivery.result", { done: Math.round((o.completionRate / 100) * o.completionBase), base: o.completionBase, rate: f.pct(o.completionRate) })}${late}`, href: i.links.calendar };

  const urgent = issues.filter((x) => x.severity <= 2);
  const problems: Answer = { question: t("questions.problems.question"), tone: issues.some((x) => x.severity === 1) ? "attention" : urgent.length ? "watch" : "good", answer: urgent.length ? t("questions.problems.urgent", { titles: urgent.slice(0, 3).map((x) => x.title).join(sep) }) : issues.length ? t("questions.problems.keepAnEye") : t("questions.problems.none") };

  const s = i.social;
  const qObjectives = t("questions.objectives.question");
  const reachSentence = (posts: number, reach: number | null, clicks: number | null) =>
    reach != null
      ? clicks != null ? t("questions.objectives.reach.knownClicks", { count: posts, reach, clicks }) : t("questions.objectives.reach.known", { count: posts, reach })
      : clicks != null ? t("questions.objectives.reach.unknownClicks", { count: posts, clicks }) : t("questions.objectives.reach.unknown", { count: posts });
  const objectives: Answer = !i.canSeeSocial
    ? { question: qObjectives, tone: "neutral", answer: t("questions.objectives.noRole") }
    : !s || s.posts === 0
      ? { question: qObjectives, tone: "neutral", answer: t("questions.objectives.noData") + (i.kpiCount ? ` ${t("questions.objectives.noDataKpis", { count: i.kpiCount })}` : ""), href: i.links.history }
      : { question: qObjectives, tone: "neutral", answer: `${reachSentence(s.posts, s.reach, s.clicks)} ${i.kpiCount ? t("questions.objectives.kpis", { count: i.kpiCount }) : t("questions.objectives.noKpis")}`, href: i.links.history };

  const decisions: Answer = { question: t("questions.decisions.question"), tone: issues.length ? (issues[0].severity === 1 ? "attention" : "watch") : "good", answer: issues.length ? issues.slice(0, 3).map((x, n) => t("questions.decisions.item", { n: String(n + 1), next: x.next })).join(" ") : t("questions.decisions.none") };

  return [strategy, delivery, problems, objectives, decisions];
}

// ---------------------------------------------------------------------------
// KPI explanations: definition, an example from the real figures, why it matters, how to read it, what to do
// ---------------------------------------------------------------------------
export type Explanation = { title: string; simple: string; example: string; why: string; reading: string; tone: Tone; action?: string; formula?: string };

export function explain(i: CeoInput, t: TFor<"analytics">): Record<string, Explanation> {
  const o = i.overview, p = i.overviewPrev, pr = i.production, b = i.balance, s = i.social;
  const f = numbers(t);
  const sep = t("labels.listSeparator");
  const done = Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  const weeks = i.periodDays / 7;
  const range = t("labels.rangeWords", { from: i.period.from, to: i.period.to });
  const review = pr.stages.filter((x) => REVIEW.has(x.stage));
  const reviewCount = review.reduce((n, x) => n + x.count, 0);
  const reviewWait = Math.max(0, ...review.filter((x) => x.count).map((x) => x.medianDays ?? 0));
  const out: Record<string, Explanation> = {
    planned: {
      title: t("explain.planned.title"), simple: t("explain.planned.simple"),
      example: `${t("explain.planned.example", { count: o.planned, range })}${p ? ` ${t("explain.planned.examplePrev", { count: p.planned })}` : ""}`,
      why: t("explain.planned.why"),
      reading: o.planned === 0 ? t("explain.planned.readingNone") : t("explain.planned.reading"),
      tone: o.planned === 0 ? "watch" : "neutral", action: o.planned === 0 ? t("explain.planned.action") : undefined,
      formula: t("explain.planned.formula"),
    },
    published: {
      title: t("explain.published.title"), simple: t("explain.published.simple"),
      example: `${t("explain.published.example", { count: o.published, range })}${p ? ` ${t("explain.published.examplePrev", { count: p.published })}` : ""}`,
      why: t("explain.published.why"),
      reading: p ? (o.published > p.published ? t("explain.published.readingMore") : o.published < p.published ? t("explain.published.readingFewer") : t("explain.published.readingSame")) : t("explain.published.reading"),
      tone: "neutral", formula: t("explain.published.formula"),
    },
    completion: {
      title: t("explain.completion.title"), simple: t("explain.completion.simple"),
      example: o.completionBase ? `${t("explain.completion.example", { done, base: o.completionBase })} ${t("explain.completion.exampleRemaining", { count: o.completionBase - done })}` : t("explain.completion.exampleNone"),
      why: t("explain.completion.why"),
      reading: o.completionRate == null ? t("explain.completion.readingNotEnough") : o.completionBase < 5 ? t("explain.completion.readingTooFew") : o.completionRate >= 85 ? t("explain.completion.readingGood") : o.completionRate >= 60 ? t("explain.completion.readingWatch") : t("explain.completion.readingBad"),
      tone: o.completionRate == null || o.completionBase < 5 ? "neutral" : o.completionRate >= 85 ? "good" : o.completionRate >= 60 ? "watch" : "attention",
      action: o.completionBase - done > 0 ? t("explain.completion.action") : undefined,
      formula: t("explain.completion.formula"),
    },
    approvedPerWeek: {
      title: t("explain.approvedPerWeek.title"), simple: t("explain.approvedPerWeek.simple"),
      example: t("explain.approvedPerWeek.example", { count: o.approvedInPeriod, days: Math.round(i.periodDays), perWeek: f.fixed(o.approvedInPeriod / weeks) }),
      why: t("explain.approvedPerWeek.why"),
      reading: o.approvedInPeriod === 0 ? t("explain.approvedPerWeek.readingNone") : t("explain.approvedPerWeek.reading"),
      tone: o.approvedInPeriod === 0 && reviewCount > 0 ? "watch" : "neutral", formula: t("explain.approvedPerWeek.formula"),
    },
    inProduction: {
      title: t("explain.inProduction.title"), simple: t("explain.inProduction.simple"),
      example: t("explain.inProduction.example", { count: o.inProduction }),
      why: t("explain.inProduction.why"),
      reading: t("explain.inProduction.reading"), tone: "neutral",
      formula: t("explain.inProduction.formula"),
    },
    awaitingApproval: {
      title: t("explain.awaitingApproval.title"), simple: t("explain.awaitingApproval.simple"),
      example: reviewCount ? t("explain.awaitingApproval.example", { count: reviewCount, days: f.fixed(reviewWait) }) : t("explain.awaitingApproval.exampleNone"),
      why: t("explain.awaitingApproval.why"),
      reading: reviewCount === 0 ? t("explain.awaitingApproval.readingNone") : reviewWait >= 5 ? t("explain.awaitingApproval.readingSlow") : reviewWait >= 2 ? t("explain.awaitingApproval.readingFew") : t("explain.awaitingApproval.readingQuick"),
      tone: reviewCount === 0 ? "good" : reviewWait >= 5 ? "attention" : reviewWait >= 2 ? "watch" : "good",
      action: reviewWait >= 2 ? t("explain.awaitingApproval.action") : undefined,
      formula: t("explain.awaitingApproval.formula"),
    },
    overdue: {
      title: t("explain.overdue.title"), simple: t("explain.overdue.simple"),
      example: o.overdueContent ? t("explain.overdue.example", { late: t("explain.overdue.exampleLate", { count: o.overdueContent }), tasks: t("explain.overdue.exampleTasks", { count: o.overdueTasks }) }) : t("explain.overdue.exampleNone"),
      why: t("explain.overdue.why"),
      reading: o.overdueContent === 0 ? t("explain.overdue.readingNone") : o.overdueContent >= 5 ? t("explain.overdue.readingMany") : t("explain.overdue.reading"),
      tone: o.overdueContent === 0 ? "good" : o.overdueContent >= 5 ? "attention" : "watch",
      action: o.overdueContent ? t("explain.overdue.action") : undefined,
      formula: t("explain.overdue.formula"),
    },
    upcoming: {
      title: t("explain.upcoming.title"), simple: t("explain.upcoming.simple"),
      example: t("explain.upcoming.example", { count: o.upcoming }),
      why: t("explain.upcoming.why"),
      reading: o.upcoming === 0 ? t("explain.upcoming.readingNone") : t("explain.upcoming.reading"),
      tone: o.upcoming === 0 ? "watch" : "good", action: o.upcoming === 0 ? t("explain.upcoming.action") : undefined,
      formula: t("explain.upcoming.formula"),
    },
    productionTime: {
      title: t("explain.productionTime.title"), simple: t("explain.productionTime.simple"),
      example: pr.medianProductionDays != null ? t("explain.productionTime.example", { count: pr.productionSample, days: f.fixed(pr.medianProductionDays) }) : t("explain.productionTime.exampleNone"),
      why: t("explain.productionTime.why"), reading: pr.medianProductionDays == null ? t("explain.notEnough") : t("explain.productionTime.reading"),
      tone: "neutral", formula: t("explain.productionTime.formula"),
    },
    approvalTime: {
      title: t("explain.approvalTime.title"), simple: t("explain.approvalTime.simple"),
      example: pr.medianApprovalDays != null ? t("explain.approvalTime.example", { days: f.fixed(pr.medianApprovalDays), count: pr.approvalSample }) : t("explain.approvalTime.exampleNone"),
      why: t("explain.approvalTime.why"),
      reading: pr.medianApprovalDays == null ? t("explain.notEnough") : pr.medianApprovalDays >= 5 ? t("explain.approvalTime.readingSlow") : pr.medianApprovalDays >= 2 ? t("explain.approvalTime.readingFew") : t("explain.approvalTime.readingQuick"),
      tone: pr.medianApprovalDays == null ? "neutral" : pr.medianApprovalDays >= 5 ? "attention" : pr.medianApprovalDays >= 2 ? "watch" : "good",
      formula: t("explain.approvalTime.formula"),
    },
    pillars: {
      title: t("explain.pillars.title"), simple: t("explain.pillars.simple"),
      example: b.pillars.filter((x) => x.target != null).slice(0, 2).map((x) => t("explain.pillars.exampleItem", { label: x.label, share: f.pct(x.share), target: f.target(x.target!) })).join(sep) || t("explain.pillars.exampleNone"),
      why: t("explain.pillars.why"),
      reading: i.targetsOff ? t("explain.pillars.readingFiltered") : b.pillars.some((x) => x.status === "under") ? t("explain.pillars.readingUnder", { names: b.pillars.filter((x) => x.status === "under").map((x) => x.label).join(", ") }) : t("explain.pillars.reading"),
      tone: i.targetsOff ? "neutral" : b.pillars.some((x) => x.status === "under") ? "watch" : "good",
      action: b.pillars.some((x) => x.status === "under") && !i.targetsOff ? t("explain.pillars.action") : undefined,
      formula: t("explain.pillars.formula"),
    },
    funnel: {
      title: t("explain.funnel.title"), simple: t("explain.funnel.simple"),
      example: b.funnel.filter((x) => x.count).map((x) => t("explain.funnel.exampleItem", { label: x.label, share: f.pct(x.share) })).join(", ") || t("explain.funnel.exampleNone"),
      why: t("explain.funnel.why"),
      reading: t("explain.funnel.reading"), tone: "neutral",
      formula: t("explain.funnel.formula"),
    },
    platforms: {
      title: t("explain.platforms.title"), simple: t("explain.platforms.simple"),
      example: b.platforms.filter((x) => x.target != null).slice(0, 2).map((x) => t("explain.platforms.exampleItem", { label: x.label, count: x.count, target: Math.round(x.target!) })).join(sep) || t("explain.platforms.exampleNone"),
      why: t("explain.platforms.why"),
      reading: b.platforms.some((x) => x.target != null && x.count < x.target * 0.7) ? t("explain.platforms.readingBelow") : t("explain.platforms.reading"),
      tone: b.platforms.some((x) => x.target != null && x.count < x.target * 0.7) ? "watch" : "neutral",
      formula: t("explain.platforms.formula"),
    },
    throughput: {
      title: t("explain.throughput.title"), simple: t("explain.throughput.simple"),
      example: t("explain.throughput.example", { ideas: pr.ideasCreated, approved: pr.approved, published: pr.published }),
      why: t("explain.throughput.why"),
      reading: pr.ideasCreated > 0 && pr.approved === 0 ? t("explain.throughput.readingStuck") : t("explain.throughput.reading"),
      tone: pr.ideasCreated > 0 && pr.approved === 0 ? "watch" : "neutral",
    },
    waits: {
      title: t("explain.waits.title"), simple: t("explain.waits.simple"),
      example: pr.bottleneck ? t("explain.waits.example", { stage: i.stageLabel(pr.bottleneck.stage), count: pr.bottleneck.count, days: f.fixed(pr.bottleneck.medianDays ?? 0) }) : t("explain.waits.exampleNone"),
      why: t("explain.waits.why"),
      reading: pr.bottleneck ? t("explain.waits.reading") : t("explain.waits.readingNone"), tone: pr.bottleneck && (pr.bottleneck.medianDays ?? 0) >= 3 ? "watch" : "neutral",
      formula: t("explain.waits.formula"),
    },
  };
  if (s) {
    out.reach = {
      title: t("explain.reach.title"), simple: t("explain.reach.simple"),
      example: s.reach != null ? `${t("explain.reach.example", { count: s.posts, reach: s.reach })}${i.socialPrev?.reach != null ? ` ${t("explain.reach.examplePrev", { reach: i.socialPrev.reach })}` : ""}` : t("explain.reach.exampleNone"),
      why: t("explain.reach.why"), reading: s.reach == null ? t("explain.notAvailable") : t("explain.reach.reading"), tone: "neutral",
      formula: t("explain.reach.formula"),
    };
    out.engagementRate = {
      title: t("explain.engagementRate.title"), simple: t("explain.engagementRate.simple"),
      example: s.medianEngagementRate != null ? t("explain.engagementRate.example", { rate: f.rate(s.medianEngagementRate), count: s.rateSample }) : t("explain.engagementRate.exampleNone"),
      why: t("explain.engagementRate.why"),
      reading: s.medianEngagementRate == null ? t("explain.notAvailable") : i.socialPrev?.medianEngagementRate != null ? t("explain.engagementRate.readingPrev", { rate: f.rate(i.socialPrev.medianEngagementRate) }) : t("explain.engagementRate.reading"),
      tone: "neutral", formula: t("explain.engagementRate.formula"),
    };
    out.engagement = {
      title: t("explain.engagement.title"), simple: t("explain.engagement.simple"),
      example: s.engagement != null ? t("explain.engagement.example", { total: s.engagement, count: s.engagementSample }) : t("explain.engagement.exampleNone"),
      why: t("explain.engagement.why"), reading: t("explain.comparePrevious"), tone: "neutral",
      formula: t("explain.engagement.formula"),
    };
    out.clicks = {
      title: t("explain.clicks.title"), simple: t("explain.clicks.simple"),
      example: s.clicks != null ? (s.ctr != null ? t("explain.clicks.exampleCtr", { clicks: s.clicks, ctr: f.fixed(s.ctr) }) : t("explain.clicks.example", { clicks: s.clicks })) : t("explain.clicks.exampleNone"),
      why: t("explain.clicks.why"), reading: s.clicks == null ? t("explain.notAvailable") : t("explain.clicks.reading"), tone: "neutral",
      formula: t("explain.clicks.formula"),
    };
  }
  return out;
}
