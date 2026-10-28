// The CEO layer: turns the measured figures into plain-language conclusions.
// Rules only. Every sentence is built from a number that was measured; when a number is missing or too small to
// judge, the output says so instead of guessing.

import type { overview, production, social, strategyBalance, teamWorkload } from "./compute";

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
  kpiCount: number;
  stageLabel: (s: string) => string;
  links: { strategy: string; calendar: string; overdue: string; production: string; team: string; history: string; settings: string };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (v: number) => `${Math.round(v)}%`;
const change = (now: number | null | undefined, prev: number | null | undefined) => (now == null || prev == null || prev === 0 ? null : ((now - prev) / prev) * 100);
const REVIEW = new Set(["internal_review", "approval"]);
// Posts needed in both periods before comparing how the audience responds.
export const MIN_POSTS = 10;

// ---------------------------------------------------------------------------
// Action center: real issues, ranked. Nothing is produced without the numbers behind it.
// ---------------------------------------------------------------------------
export type Issue = {
  id: string; severity: 1 | 2 | 3; // 1 = act now, 2 = this week, 3 = keep an eye on
  title: string; evidence: string; impact?: string; next: string; href: string; linkLabel: string;
};

export function actionCenter(i: CeoInput): Issue[] {
  const out: Issue[] = [];
  const o = i.overview, pr = i.production, b = i.balance;

  // Delivery: overdue and slipped publications
  if (o.overdueContent > 0) {
    out.push({
      id: "overdue", severity: o.overdueContent >= 5 ? 1 : 2,
      title: `${plural(o.overdueContent, "piece")} of content ${o.overdueContent === 1 ? "is" : "are"} late`,
      evidence: `Their internal deadline has passed and they are not approved yet.${o.overdueTasks ? ` ${plural(o.overdueTasks, "task")} assigned to the team ${o.overdueTasks === 1 ? "is" : "are"} also past due.` : ""}`,
      impact: "Late work pushes back publication dates and leaves gaps in the plan.",
      next: "Ask the content lead which of these can still ship, and which should be rescheduled or dropped.",
      href: i.links.overdue, linkLabel: "See the late items",
    });
  }
  const slipped = o.completionBase - Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  if (o.completionBase >= 5 && o.completionRate != null && o.completionRate < 80 && slipped >= 3) {
    out.push({
      id: "slipped", severity: o.completionRate < 50 ? 1 : 2,
      title: `${plural(slipped, "planned publication")} did not go out`,
      evidence: `${o.completionBase - slipped} of ${o.completionBase} publications planned for dates that have passed were published (${pct(o.completionRate)}).`,
      impact: "What was planned is not reaching your audience on time.",
      next: "Check whether they are waiting for approval, still in production, or no longer needed, and reschedule them.",
      href: i.links.calendar, linkLabel: "Open the calendar",
    });
  }

  // Approval bottleneck
  const review = pr.stages.filter((s) => REVIEW.has(s.stage));
  const waiting = review.reduce((s, x) => s + x.count, 0);
  const longest = Math.max(0, ...review.map((s) => s.medianDays ?? 0));
  if (waiting >= 3 && longest >= 2) {
    out.push({
      id: "approval", severity: longest >= 5 ? 1 : 2,
      title: "Approvals are holding up content",
      evidence: `${plural(waiting, "item")} ${waiting === 1 ? "is" : "are"} waiting for review or approval, with a typical wait of ${longest.toFixed(1)} days.`,
      impact: "Content that is written but not approved can't be published.",
      next: "Set a fixed approval slot each week, or let someone else approve when the usual approver is busy.",
      href: i.links.production, linkLabel: "Open Content Production",
    });
  } else if (pr.bottleneck && pr.bottleneck.count >= 10 && (pr.bottleneck.medianDays ?? 0) >= 3) {
    out.push({
      id: "bottleneck", severity: 3,
      title: `Work is piling up at the “${i.stageLabel(pr.bottleneck.stage)}” step`,
      evidence: `${pr.bottleneck.count} items are at this step now, typically for ${pr.bottleneck.medianDays!.toFixed(1)} days.`,
      next: "Ask the team what is blocking these items, or reduce how many new ideas enter the pipeline.",
      href: i.links.production, linkLabel: "Open Content Production",
    });
  }

  // Strategy: pillars and channels under target
  if (!i.targetsOff && b.total >= 5) {
    for (const s of b.pillars.filter((x) => x.status === "under")) {
      const needed = Math.max(1, Math.ceil((s.target! / 100) * b.total - s.count));
      out.push({
        id: `pillar-${s.key}`, severity: s.diff! < -10 ? 1 : 2,
        title: `“${s.label}” gets less content than your strategy says`,
        evidence: `${pct(s.share)} of planned content vs a target of ${s.target}% (${s.count} of ${b.total} items).`,
        impact: `About ${plural(needed, "more item")} would be needed in this period to reach the target.`,
        next: "Ask the team to plan more content for this theme, or lower the target if priorities changed.",
        href: i.links.calendar, linkLabel: "Plan content",
      });
    }
    // One issue for all channels behind their posting rhythm, so the same advice isn't repeated per channel.
    const behind = b.platforms.filter((x) => x.target != null && x.target >= 2 && x.count < x.target * 0.7);
    if (behind.length) {
      const names = behind.map((p) => p.label);
      out.push({
        id: "platforms", severity: behind.some((p) => p.count === 0) ? 2 : 3,
        title: behind.length === 1 ? `${names[0]} has fewer posts planned than its target` : `${behind.length} channels have fewer posts planned than their target`,
        evidence: behind.map((p) => `${p.label}: ${p.count} planned vs about ${Math.round(p.target!)} expected`).join("; ") + ", based on the posting rhythm set for each channel.",
        impact: "Your brand will be less present on these channels than you decided.",
        next: `Plan the missing posts on ${names.join(", ")}, or lower ${behind.length === 1 ? "its" : "their"} posting target if ${behind.length === 1 ? "it is" : "they are"} no longer a priority.`,
        href: i.links.calendar, linkLabel: "Open the calendar",
      });
    }
  }

  // Nothing planned ahead
  if (o.upcoming === 0 && i.hasChannelTargets) {
    out.push({
      id: "no-upcoming", severity: 2,
      title: "Nothing is planned for the next 7 days",
      evidence: "No unpublished content has a publication date in the coming week.",
      impact: "Your channels will go quiet unless content is added.",
      next: "Ask the team to schedule next week's posts.",
      href: i.links.calendar, linkLabel: "Open the calendar",
    });
  }

  // Team balance (only for people allowed to see the team)
  if (i.team && i.team.length >= 2) {
    const loads = i.team.map((t) => t.open + t.inReview);
    const sorted = [...loads].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const busiest = i.team.reduce((a, t) => (t.open + t.inReview > a.open + a.inReview ? t : a));
    const top = busiest.open + busiest.inReview;
    if (top >= 6 && top >= Math.max(2, median) * 2) {
      out.push({
        id: "workload", severity: 2,
        title: "Work is unevenly spread across the team",
        evidence: `${busiest.name} has ${plural(top, "open task")}, while the typical team member has ${median}.`,
        impact: "One overloaded person can delay many pieces of content at once.",
        next: "Review assignments with the team and move some tasks if it makes sense.",
        href: i.links.team, linkLabel: "Open team workload",
      });
    }
  }

  // Data availability
  if (i.canSeeSocial) {
    if (!i.meta || i.meta.status === "disconnected") {
      out.push({
        id: "no-data", severity: 3,
        title: "Results from social media are not connected",
        evidence: "No Meta (Facebook/Instagram) account is connected to this project.",
        impact: "Without it, the platform can't tell you how your posts perform.",
        next: "Connect the Facebook Page and Instagram account in Content history.",
        href: i.links.history, linkLabel: "Connect Meta",
      });
    } else if (i.meta.status === "expired" || i.meta.status === "error" || i.meta.lastSyncStatus === "failed") {
      out.push({
        id: "sync-failed", severity: 2,
        title: "Social media results stopped updating",
        evidence: `The connection to Meta needs attention${i.meta.error ? ` (${i.meta.error.slice(0, 140)})` : ""}.`,
        impact: "Performance figures may be out of date.",
        next: "Reconnect the account in Content history.",
        href: i.links.history, linkLabel: "Fix the connection",
      });
    }
  }

  // Performance trend
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate);
    if (c != null && c <= -15) {
      out.push({
        id: "engagement-down", severity: 3,
        title: "People are interacting less with your posts",
        evidence: `A typical post got reactions from ${i.social.medianEngagementRate!.toFixed(2)}% of the people who saw it, down from ${i.socialPrev.medianEngagementRate!.toFixed(2)}% in the previous period (${i.social.rateSample} vs ${i.socialPrev.rateSample} posts).`,
        next: "Ask the team which recent posts worked best and plan more like them.",
        href: i.links.history, linkLabel: "See post performance",
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

export function executiveSummary(i: CeoInput, issues: Issue[]) {
  const o = i.overview, p = i.overviewPrev, pr = i.production, b = i.balance;
  const signals: Signal[] = [];

  // Delivery against plan
  if (o.completionBase >= 5 && o.completionRate != null) {
    signals.push({ label: "Delivering the plan", tone: o.completionRate >= 85 ? "good" : o.completionRate >= 60 ? "watch" : "attention", evidence: `${pct(o.completionRate)} of past planned publications went out (${o.completionBase} planned).` });
  }
  // Deadlines
  const open = pr.stages.reduce((s, x) => s + x.count, 0);
  if (open > 0) {
    signals.push({ label: "Meeting deadlines", tone: o.overdueContent === 0 ? "good" : o.overdueContent >= 5 || (o.overdueContent >= 3 && o.overdueContent / open > 0.2) ? "attention" : "watch", evidence: o.overdueContent ? `${plural(o.overdueContent, "item")} past the internal deadline.` : "No content is past its internal deadline." });
  }
  // Strategy balance
  const withTarget = b.pillars.filter((s) => s.target != null);
  if (!i.targetsOff && b.total >= 5 && withTarget.length) {
    const under = withTarget.filter((s) => s.status === "under");
    const over = withTarget.filter((s) => s.status === "over");
    signals.push({ label: "Following the strategy", tone: under.length === 0 ? "good" : under.some((s) => s.diff! < -10) ? "attention" : "watch", evidence: under.length ? `${plural(under.length, "content theme")} below target: ${under.map((s) => s.label).join(", ")}.` : over.length ? `No theme is clearly below target; ${over.map((s) => `${s.label} is above (${pct(s.share)} vs ${s.target}%)`).join(", ")}.` : `All ${withTarget.length} content themes are within 5 points of their target.` });
  }
  // Approvals
  const reviewWait = Math.max(0, ...pr.stages.filter((s) => REVIEW.has(s.stage) && s.count).map((s) => s.medianDays ?? 0));
  const reviewCount = pr.stages.filter((s) => REVIEW.has(s.stage)).reduce((s, x) => s + x.count, 0);
  if (reviewCount > 0) signals.push({ label: "Approvals", tone: reviewWait >= 5 ? "attention" : reviewWait >= 2 ? "watch" : "good", evidence: `${plural(reviewCount, "item")} waiting, typical wait ${reviewWait.toFixed(1)} days.` });
  // Audience response
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate)!;
    // The audience isn't under the team's direct control, so on its own it never raises the rating above "watch".
    signals.push({ label: "Audience response", tone: c >= -5 ? "good" : "watch", evidence: `Interaction rate ${c >= 0 ? "up" : "down"} ${Math.abs(Math.round(c))}% vs the previous period.` });
  }

  const enough = signals.length >= 2;
  const level: "good" | "watch" | "attention" | "insufficient" = !enough ? "insufficient" : signals.some((s) => s.tone === "attention") ? "attention" : signals.some((s) => s.tone === "watch") ? "watch" : "good";
  const headline = {
    good: "Marketing is on track for this period.",
    watch: "Marketing is mostly on track, with a few points to watch.",
    attention: "Marketing needs your attention in this period.",
    insufficient: "There isn't enough data in this period to judge overall marketing health.",
  }[level];

  // Going well
  const wins: Point[] = [];
  if (o.completionBase >= 5 && o.completionRate != null && o.completionRate >= 85) wins.push({ tone: "good", text: `The team published ${pct(o.completionRate)} of what was planned for dates that have passed.` });
  if (p && o.published > p.published && o.published >= 3) wins.push({ tone: "good", text: `${o.published} publications went out, up from ${p.published} in the previous period.` });
  if (o.overdueContent === 0 && open > 0) wins.push({ tone: "good", text: "No content is behind its internal deadline." });
  if (!i.targetsOff && b.total >= 5 && withTarget.length && withTarget.every((s) => s.status === "on")) wins.push({ tone: "good", text: "Planned content matches the theme balance set in your strategy." });
  if (i.productionPrev && pr.medianProductionDays != null && i.productionPrev.medianProductionDays != null && pr.medianProductionDays < i.productionPrev.medianProductionDays * 0.85) wins.push({ tone: "good", text: `Content now takes ${pr.medianProductionDays.toFixed(1)} days from idea to approval, down from ${i.productionPrev.medianProductionDays.toFixed(1)}.` });
  if (i.social && i.socialPrev && i.social.rateSample >= MIN_POSTS && i.socialPrev.rateSample >= MIN_POSTS) {
    const c = change(i.social.medianEngagementRate, i.socialPrev.medianEngagementRate);
    if (c != null && c >= 15) wins.push({ tone: "good", text: `People interact more with your posts: ${i.social.medianEngagementRate!.toFixed(2)}% vs ${i.socialPrev.medianEngagementRate!.toFixed(2)}% before.` });
  }
  if (i.social && i.socialPrev && i.social.reach != null && i.socialPrev.reach != null && i.socialPrev.reach > 0 && i.social.reach > i.socialPrev.reach * 1.15) wins.push({ tone: "good", text: `Posts reached ${i.social.reach.toLocaleString("en")} people (counted per post), up ${Math.round(change(i.social.reach, i.socialPrev.reach)!)}% on the previous period.` });
  if (pr.ideasCreated >= 10) wins.push({ tone: "neutral", text: `The team added ${pr.ideasCreated} new content ideas in the period.` });

  // Needs attention: the top issues that aren't about schedule
  const scheduleIds = new Set(["overdue", "slipped", "approval", "bottleneck", "no-upcoming"]);
  const concerns: Point[] = issues.filter((x) => !scheduleIds.has(x.id)).slice(0, 4).map((x) => ({ tone: x.severity === 1 ? "attention" : "watch", text: `${x.title}. ${x.evidence}` }));

  // Behind schedule
  const behind: Point[] = [];
  if (o.overdueContent) behind.push({ tone: o.overdueContent >= 5 ? "attention" : "watch", text: `${plural(o.overdueContent, "piece")} of content past the internal deadline.` });
  if (o.overdueTasks) behind.push({ tone: "watch", text: `${plural(o.overdueTasks, "team task")} past due.` });
  const slipped = o.completionBase - Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  if (slipped > 0) behind.push({ tone: slipped >= 3 ? "attention" : "watch", text: `${plural(slipped, "planned publication")} not published although the date has passed.` });
  if (reviewCount) behind.push({ tone: reviewWait >= 2 ? "watch" : "neutral", text: `${plural(reviewCount, "item")} waiting for approval (typical wait ${reviewWait.toFixed(1)} days).` });

  return { level, headline, signals, wins: wins.slice(0, 4), concerns, behind, actions: issues.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// The five questions a CEO asks
// ---------------------------------------------------------------------------
export type Answer = { question: string; answer: string; tone: Tone; href?: string };

export function fiveQuestions(i: CeoInput, issues: Issue[]): Answer[] {
  const o = i.overview, b = i.balance;
  const under = b.pillars.filter((s) => s.status === "under");
  const strategy: Answer = i.targetsOff
    ? { question: "Are we executing our marketing strategy?", tone: "neutral", answer: "Filters are applied, so the plan isn't compared with the strategy. Clear the filters to see this answer." }
    : !i.hasPillarTargets
      ? { question: "Are we executing our marketing strategy?", tone: "neutral", answer: "Your strategy has no target share for its content themes yet, so this can't be measured. Add targets in Strategy.", href: i.links.strategy }
      : b.total < 5
        ? { question: "Are we executing our marketing strategy?", tone: "neutral", answer: b.total ? `Only ${plural(b.total, "item")} planned in this period, which is too few to judge. Widen the period.` : "Nothing has a publication date in this period, so the plan can't be compared with the strategy. Choose a period that includes planned content." }
        : under.length
          ? { question: "Are we executing our marketing strategy?", tone: "watch", answer: `Partly. ${under.map((s) => `“${s.label}” is at ${pct(s.share)} vs ${s.target}% planned`).join("; ")}.`, href: i.links.strategy }
          : b.pillars.some((s) => s.status === "over")
            ? { question: "Are we executing our marketing strategy?", tone: "good", answer: `Mostly. No theme is clearly below target, but ${b.pillars.filter((s) => s.status === "over").map((s) => `“${s.label}” takes ${pct(s.share)} vs ${s.target}% planned`).join("; ")}.`, href: i.links.strategy }
            : { question: "Are we executing our marketing strategy?", tone: "good", answer: `Yes. The ${b.total} planned items follow the theme balance in your strategy.` };

  const delivery: Answer = o.completionBase < 5 || o.completionRate == null
    ? { question: "Is my team delivering what was planned?", tone: "neutral", answer: o.completionBase ? `Only ${plural(o.completionBase, "publication")} planned for past dates, too few to judge.${o.overdueContent ? ` ${plural(o.overdueContent, "item")} past deadline.` : ""}` : `No publications were planned for dates that have passed in this period.${o.overdueContent ? ` ${plural(o.overdueContent, "item")} past deadline.` : ""}` }
    : { question: "Is my team delivering what was planned?", tone: o.completionRate >= 85 && !o.overdueContent ? "good" : o.completionRate >= 60 ? "watch" : "attention", answer: `${Math.round((o.completionRate / 100) * o.completionBase)} of ${o.completionBase} planned publications went out (${pct(o.completionRate)}).${o.overdueContent ? ` ${plural(o.overdueContent, "item")} past deadline.` : ""}`, href: i.links.calendar };

  const urgent = issues.filter((x) => x.severity <= 2);
  const problems: Answer = { question: "What problems need my attention?", tone: issues.some((x) => x.severity === 1) ? "attention" : urgent.length ? "watch" : "good", answer: urgent.length ? urgent.slice(0, 3).map((x) => x.title).join("; ") + "." : issues.length ? "Nothing urgent. A few points to keep an eye on are listed below." : "Nothing in the data needs your attention right now." };

  const s = i.social;
  const objectives: Answer = !i.canSeeSocial
    ? { question: "Are we achieving our marketing objectives?", tone: "neutral", answer: "Your role doesn't include performance data, so this can't be answered here." }
    : !s || s.posts === 0
      ? { question: "Are we achieving our marketing objectives?", tone: "neutral", answer: "No performance data for this period, so results can't be judged yet." + (i.kpiCount ? ` Your strategy lists ${plural(i.kpiCount, "objective")}, but their results aren't recorded in the platform.` : ""), href: i.links.history }
      : { question: "Are we achieving our marketing objectives?", tone: "neutral", answer: `${plural(s.posts, "post")} reached ${s.reach != null ? s.reach.toLocaleString("en") : "an unknown number of"} people (counted per post)${s.clicks != null ? ` and generated ${s.clicks.toLocaleString("en")} link clicks` : ""}.${i.kpiCount ? ` Your ${plural(i.kpiCount, "strategy objective")} ${i.kpiCount === 1 ? "has" : "have"} no recorded results, so ${i.kpiCount === 1 ? "it" : "they"} can't be checked automatically yet.` : " No measurable objectives are set in the strategy."}`, href: i.links.history };

  const decisions: Answer = { question: "What decisions should I make today?", tone: issues.length ? (issues[0].severity === 1 ? "attention" : "watch") : "good", answer: issues.length ? issues.slice(0, 3).map((x, n) => `${n + 1}. ${x.next}`).join(" ") : "None required by the data. Keep the current plan." };

  return [strategy, delivery, problems, objectives, decisions];
}

// ---------------------------------------------------------------------------
// KPI explanations: definition, an example from the real figures, why it matters, how to read it, what to do
// ---------------------------------------------------------------------------
export type Explanation = { title: string; simple: string; example: string; why: string; reading: string; tone: Tone; action?: string; formula?: string };

export function explain(i: CeoInput): Record<string, Explanation> {
  const o = i.overview, p = i.overviewPrev, pr = i.production, b = i.balance, s = i.social;
  const done = Math.round(((o.completionRate ?? 0) / 100) * o.completionBase);
  const weeks = i.periodDays / 7;
  const range = `${i.period.from} to ${i.period.to}`;
  const review = pr.stages.filter((x) => REVIEW.has(x.stage));
  const reviewCount = review.reduce((t, x) => t + x.count, 0);
  const reviewWait = Math.max(0, ...review.filter((x) => x.count).map((x) => x.medianDays ?? 0));
  const out: Record<string, Explanation> = {
    planned: {
      title: "Planned in period", simple: "How many pieces of content have a publication date in the selected period.",
      example: `${plural(o.planned, "piece")} of content ${o.planned === 1 ? "is" : "are"} planned between ${range}.${p ? ` In the previous period: ${p.planned}.` : ""}`,
      why: "It shows whether the team is preparing enough content to keep your channels active.",
      reading: o.planned === 0 ? "Nothing is planned in this period. If it's in the future, your channels may go quiet." : "Compare it with the posting rhythm you expect on each channel (see Platforms).",
      tone: o.planned === 0 ? "watch" : "neutral", action: o.planned === 0 ? "Ask the team to plan content for this period." : undefined,
      formula: "Count of content items with planned date between start and end of period.",
    },
    published: {
      title: "Published in period", simple: "How many pieces of content were actually published in the period, confirmed by the platform.",
      example: `${plural(o.published, "publication")} went out between ${range}.${p ? ` Previous period: ${p.published}.` : ""}`,
      why: "Planned content only helps the business once it is published.",
      reading: p ? (o.published > p.published ? "More than the previous period." : o.published < p.published ? "Fewer than the previous period." : "Same as the previous period.") : "Compare with what was planned.",
      tone: "neutral", formula: "Items with status published and a verified publication time in the period (project time zone).",
    },
    completion: {
      title: "Delivered vs planned", simple: "Of everything planned for dates that have already passed, the share that was actually published.",
      example: o.completionBase ? `Your team published ${done} of the ${o.completionBase} publications planned for past dates in this period. ${o.completionBase - done} ${o.completionBase - done === 1 ? "is" : "are"} still unpublished.` : "No publication was planned for a date that has already passed in this period.",
      why: "It tells you if the team delivers what it commits to.",
      reading: o.completionRate == null ? "Not enough to judge yet." : o.completionBase < 5 ? "Too few planned dates to judge reliably." : o.completionRate >= 85 ? "Good: almost everything planned went out." : o.completionRate >= 60 ? "Worth watching: some planned content slipped." : "Concerning: a large part of the plan did not go out.",
      tone: o.completionRate == null || o.completionBase < 5 ? "neutral" : o.completionRate >= 85 ? "good" : o.completionRate >= 60 ? "watch" : "attention",
      action: o.completionBase - done > 0 ? "Check whether the unpublished items are delayed, waiting for approval, or no longer needed." : undefined,
      formula: "Published ÷ items planned on dates ≤ today within the period × 100. Only publications verified from a connected platform count.",
    },
    approvedPerWeek: {
      title: "Approved per week", simple: "How many pieces of content get final approval each week, on average.",
      example: `${plural(o.approvedInPeriod, "item")} ${o.approvedInPeriod === 1 ? "was" : "were"} approved in ${Math.round(i.periodDays)} days, about ${(o.approvedInPeriod / weeks).toFixed(1)} per week.`,
      why: "It is the pace at which content becomes ready to publish.",
      reading: o.approvedInPeriod === 0 ? "Nothing was approved in this period. Either nothing was ready, or approvals are stuck." : "Compare it with how many posts you want per week.",
      tone: o.approvedInPeriod === 0 && reviewCount > 0 ? "watch" : "neutral", formula: "Items with approved_at in the period ÷ weeks in the period.",
    },
    inProduction: {
      title: "Being prepared now", simple: "Content currently being briefed or created.",
      example: `${plural(o.inProduction, "item")} ${o.inProduction === 1 ? "is" : "are"} being prepared today.`,
      why: "This is the work in progress that will feed future publications.",
      reading: "A large number with few approvals can mean work is started but not finished.", tone: "neutral",
      formula: "Current count of items in the Brief or In Production stage (snapshot, not tied to the period).",
    },
    awaitingApproval: {
      title: "Waiting for approval", simple: "Content that is ready and waiting for someone to review or approve it.",
      example: reviewCount ? `${plural(reviewCount, "item")} ${reviewCount === 1 ? "is" : "are"} waiting, typically for ${reviewWait.toFixed(1)} days.` : "Nothing is waiting for approval right now.",
      why: "Approval is often the step where content gets stuck, and it usually depends on managers.",
      reading: reviewCount === 0 ? "Good: nothing is waiting." : reviewWait >= 5 ? "Concerning: content waits a long time to be approved." : reviewWait >= 2 ? "Worth watching: approvals take a few days." : "Fine: approvals are quick.",
      tone: reviewCount === 0 ? "good" : reviewWait >= 5 ? "attention" : reviewWait >= 2 ? "watch" : "good",
      action: reviewWait >= 2 ? "Set a regular approval slot, or name a backup approver." : undefined,
      formula: "Current count of items in Internal Review or Approval; wait = median days since entering the stage.",
    },
    overdue: {
      title: "Late", simple: "Content whose internal deadline has passed and that is still not approved.",
      example: o.overdueContent ? `${plural(o.overdueContent, "piece")} of content ${o.overdueContent === 1 ? "is" : "are"} late, and ${plural(o.overdueTasks, "team task")} ${o.overdueTasks === 1 ? "is" : "are"} past due.` : "Nothing is late today.",
      why: "Late content is the first sign that publications will slip.",
      reading: o.overdueContent === 0 ? "Good: nothing is late." : o.overdueContent >= 5 ? "Concerning: several items are late." : "Worth watching.",
      tone: o.overdueContent === 0 ? "good" : o.overdueContent >= 5 ? "attention" : "watch",
      action: o.overdueContent ? "Ask the team which late items can still ship, and reschedule the rest." : undefined,
      formula: "Items with due_date < today and status not approved/scheduled/published. Overdue tasks: open tasks with due_date < today.",
    },
    upcoming: {
      title: "Next 7 days", simple: "Content planned for the coming week that is not published yet.",
      example: `${plural(o.upcoming, "item")} ${o.upcoming === 1 ? "is" : "are"} planned for the next 7 days.`,
      why: "It shows whether next week is covered.",
      reading: o.upcoming === 0 ? "Nothing is planned for next week." : "Next week has content planned.",
      tone: o.upcoming === 0 ? "watch" : "good", action: o.upcoming === 0 ? "Ask the team to schedule next week's posts." : undefined,
      formula: "Unpublished items with planned date between today and today + 7 days.",
    },
    productionTime: {
      title: "Time from idea to approval", simple: "How long a typical piece of content takes from the moment it's created to final approval.",
      example: pr.medianProductionDays != null ? `For the ${plural(pr.productionSample, "item")} approved in this period, the typical time was ${pr.medianProductionDays.toFixed(1)} days.` : "No item was approved in this period, so this can't be measured.",
      why: "Shorter means the team can react faster to news and opportunities.", reading: pr.medianProductionDays == null ? "Not enough data." : "Compare it with how far ahead you plan your content.",
      tone: "neutral", formula: "Median of (approved_at − created_at) for items approved in the period.",
    },
    approvalTime: {
      title: "Time to approve", simple: "How long content waits between being sent for review and being approved.",
      example: pr.medianApprovalDays != null ? `Typical approval took ${pr.medianApprovalDays.toFixed(1)} days (${plural(pr.approvalSample, "item")}).` : "No reviewed item was approved in this period.",
      why: "Long approvals delay publication even when the team has finished the work.",
      reading: pr.medianApprovalDays == null ? "Not enough data." : pr.medianApprovalDays >= 5 ? "Slow." : pr.medianApprovalDays >= 2 ? "A few days." : "Quick.",
      tone: pr.medianApprovalDays == null ? "neutral" : pr.medianApprovalDays >= 5 ? "attention" : pr.medianApprovalDays >= 2 ? "watch" : "good",
      formula: "Median of (approved_at − first entry into Internal Review or Approval).",
    },
    pillars: {
      title: "Content themes vs strategy", simple: "Your strategy defines content themes (called pillars) and how much of the content each should get. This compares the plan with those targets.",
      example: b.pillars.filter((x) => x.target != null).slice(0, 2).map((x) => `“${x.label}” is ${pct(x.share)} of planned content vs ${x.target}% targeted`).join("; ") || "No theme has a target share yet.",
      why: "If the plan drifts from the strategy, the brand message drifts too.",
      reading: i.targetsOff ? "Filters are applied, so targets aren't compared." : b.pillars.some((x) => x.status === "under") ? `Below target: ${b.pillars.filter((x) => x.status === "under").map((x) => x.label).join(", ")}.` : "All themes are close to target.",
      tone: i.targetsOff ? "neutral" : b.pillars.some((x) => x.status === "under") ? "watch" : "good",
      action: b.pillars.some((x) => x.status === "under") && !i.targetsOff ? "Ask the team to plan more content for the themes below target." : undefined,
      formula: "Share = items in pillar ÷ planned items; flagged when more than 5 points under the pillar's target_share.",
    },
    funnel: {
      title: "Customer journey stages", simple: "Each post aims at a stage of the customer journey: being discovered, building trust, getting people to sign up, keeping them. This shows how the plan is spread across those stages.",
      example: b.funnel.filter((x) => x.count).map((x) => `${x.label} ${pct(x.share)}`).join(", ") || "No planned item has a journey stage.",
      why: "Too much of one stage (for example only awareness) attracts attention but doesn't turn it into customers.",
      reading: "Compare with the percentages written in your strategy, when there are any.", tone: "neutral",
      formula: "Share of planned items with a funnel stage; targets read from percentages in the strategy's funnel notes.",
    },
    platforms: {
      title: "Posts per channel", simple: "Planned posts per social network, compared with how often you said you want to post on each.",
      example: b.platforms.filter((x) => x.target != null).slice(0, 2).map((x) => `${x.label}: ${x.count} planned vs about ${Math.round(x.target!)} expected`).join("; ") || "No channel has a posting target.",
      why: "Regular posting keeps your audience engaged; gaps make channels go quiet.",
      reading: b.platforms.some((x) => x.target != null && x.count < x.target * 0.7) ? "Some channels are below their rhythm." : "Channels are close to or above their rhythm.",
      tone: b.platforms.some((x) => x.target != null && x.count < x.target * 0.7) ? "watch" : "neutral",
      formula: "Expected = target posts per week × weeks in the period.",
    },
    throughput: {
      title: "Weekly flow", simple: "Each week: new ideas added, content approved, and content published.",
      example: `Over the period: ${pr.ideasCreated} ideas added, ${pr.approved} approved, ${pr.published} published.`,
      why: "Many ideas but few approvals or publications means the team is starting more than it finishes.",
      reading: pr.ideasCreated > 0 && pr.approved === 0 ? "Ideas are being added, but nothing reached approval in this period." : "Look for weeks where nothing was approved or published.",
      tone: pr.ideasCreated > 0 && pr.approved === 0 ? "watch" : "neutral",
    },
    waits: {
      title: "Where work is waiting", simple: "How many items sit at each step of production today, and for how long.",
      example: pr.bottleneck ? `The biggest queue is “${i.stageLabel(pr.bottleneck.stage)}”: ${pr.bottleneck.count} items, typically there for ${(pr.bottleneck.medianDays ?? 0).toFixed(1)} days.` : "Nothing is waiting beyond the idea step.",
      why: "The step where work piles up is what slows down everything after it.",
      reading: pr.bottleneck ? "Focus on unblocking this step first." : "No queue.", tone: pr.bottleneck && (pr.bottleneck.medianDays ?? 0) >= 3 ? "watch" : "neutral",
      formula: "Bottleneck = stage with the largest items × median days in stage, excluding ideas.",
    },
  };
  if (s) {
    out.reach = {
      title: "Reach", simple: "How many times people saw your posts (a person seeing two posts counts twice).",
      example: s.reach != null ? `Your ${plural(s.posts, "post")} in this period reached ${s.reach.toLocaleString("en")}.${i.socialPrev?.reach != null ? ` Previous period: ${i.socialPrev.reach.toLocaleString("en")}.` : ""}` : "The connected sources did not report reach for these posts.",
      why: "It's the size of the audience your content gets in front of.", reading: s.reach == null ? "Not available." : "Higher is better; compare with the previous period.", tone: "neutral",
      formula: "Sum of reach of posts published in the period that report reach.",
    };
    out.engagementRate = {
      title: "Interaction rate", simple: "Of the people who saw a post, the share who liked, commented, shared or saved it.",
      example: s.medianEngagementRate != null ? `A typical post got interactions from ${s.medianEngagementRate.toFixed(2)}% of the people who saw it (${plural(s.rateSample, "post")}).` : "Not enough posts report both reach and interactions.",
      why: "It shows whether the content interests your audience, not just whether it was seen.",
      reading: s.medianEngagementRate == null ? "Not available." : i.socialPrev?.medianEngagementRate != null ? `Previous period: ${i.socialPrev.medianEngagementRate.toFixed(2)}%.` : "Compare it over time rather than with other brands.",
      tone: "neutral", formula: "Median over posts of (likes + comments + shares + saves) ÷ reach × 100, for posts whose reach is consistent.",
    };
    out.engagement = {
      title: "Interactions", simple: "Total likes, comments, shares and saves on your posts.",
      example: s.engagement != null ? `${s.engagement.toLocaleString("en")} interactions on ${plural(s.engagementSample, "post")}.` : "Not reported.",
      why: "Interactions show interest and help platforms show your posts to more people.", reading: "Compare with the previous period.", tone: "neutral",
      formula: "Sum of likes + comments + shares + saves, counting only the metrics a post reports.",
    };
    out.clicks = {
      title: "Link clicks", simple: "How many times people clicked a link in your posts, for example to your website.",
      example: s.clicks != null ? `${s.clicks.toLocaleString("en")} clicks${s.ctr != null ? `, about ${s.ctr.toFixed(1)} for every 100 people reached` : ""}.` : "Not reported for these posts.",
      why: "Clicks are the step between seeing a post and becoming a customer.", reading: s.clicks == null ? "Not available." : "Higher is better.", tone: "neutral",
      formula: "Sum of clicks; click-through rate = clicks ÷ reach × 100 for posts reporting both.",
    };
  }
  return out;
}
