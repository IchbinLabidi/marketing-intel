import { FUNNEL_STAGES, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { EXPECTED_FORMATS } from "@/lib/history/analysis";
import { normalizeFormat } from "@/lib/history/parse";
import { engagementOf, engagementRate, usableReach, type PerfItem, type PlatformPerformance } from "@/lib/history/performance";
import { contentTokens } from "@/lib/history/text";
import { captionHook } from "@/lib/meta/normalize";
import { windowLabel, type PlatformTiming } from "@/lib/calendar/insights";
import type { TFor } from "@/i18n/messages";

// Signals are the only facts the opportunity engine may cite. Every one is computed here from database rows, carries
// the numbers, period, method and supporting post ids, and is shown verbatim under "View evidence". The AI chooses
// which signals an idea builds on; it never writes statistics of its own.

export type SignalKind =
  | "pillar_performance" | "format_performance" | "topic_performance" | "hook_pattern" | "cta_pattern" | "timing"
  | "top_post" | "low_post" | "refresh" | "pillar_gap" | "pillar_dormant" | "funnel_gap" | "format_gap" | "competitor_topic"
  | "search_demand" | "published_result";

export type Signal = {
  key: string; // S1, S2… (stable within one generation)
  kind: SignalKind;
  category: "historical" | "strategy" | "competitor" | "search" | "results";
  platform: Platform | null;
  pillar_id: string | null;
  format: string | null;
  statement: string;
  method: string;
  period: { from: string | null; to: string | null };
  /** posts behind the number; the sample size of a performance signal */
  n: number;
  /** median of the group ÷ platform median (performance signals only) */
  lift: number | null;
  /** percentage points below target (gap signals only) */
  gap: number | null;
  metrics: Record<string, number | string | null>;
  ref_ids: string[];
};

export type SignalItem = PerfItem & { published_at?: string | null; funnel_stage?: string | null };

export type SignalInput = {
  items: SignalItem[];
  performance: PlatformPerformance[];
  timing: PlatformTiming[];
  pillars: { id: string; name: string; target_share: number | null }[];
  /** funnel stages the strategy describes (non-empty text) */
  strategyFunnel: FunnelStage[];
  activePlatforms: Platform[];
  competitorItems: { id: string; competitor: string; platform: Platform | null; title: string | null; topic: string | null; caption: string | null; likes: number | null; comments: number | null; shares: number | null; published_at: string | null }[];
  today: string; // YYYY-MM-DD
  /** latest SERP analysis per keyword (Google search), real Google results */
  searchItems?: { id: string; keyword: string; country: string; language: string; intent: string | null; ownPosition: number | null; questions: string[]; related: string[]; resultsRead: number; date: string }[];
  /** results of published calendar posts vs their objective (editorial feedback loop) */
  learnings?: { key: string; statement: string; n: number; ratio: number; platform: Platform; format: string | null; ref_ids: string[] }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const dateOf = (i: SignalItem) => i.actual_publication_date ?? i.publication_date ?? i.published_at?.slice(0, 10) ?? null;
const LIFT_STRONG = 1.25;
const LIFT_WEAK = 0.8;

function periodOf(list: SignalItem[]) {
  const d = list.map(dateOf).filter((x): x is string => Boolean(x)).sort();
  return { from: d[0] ?? null, to: d.at(-1) ?? null };
}

/**
 * Statements and methods are written with `t` (the "opportunities" translator) and `td` ("domain", for funnel stages).
 * The engine builds them in English (they are given to the AI and stored as evidence); the signals panel rebuilds them
 * in the viewer's language. Metrics stay language-neutral.
 */
export function buildSignals(input: SignalInput, t: TFor<"opportunities">, td: TFor<"domain">): Signal[] {
  const out: Omit<Signal, "key">[] = [];
  const S = (key: Parameters<typeof t>[0], values?: Record<string, string | number>) => t(key, values as never);
  const pct = (n: number) => S("signals.percent", { value: r1(n) });
  const periodText = (p: { from: string | null; to: string | null }) => (p.from ? `${p.from} → ${p.to}` : S("signals.undated"));
  const formula = S("signals.engagementFormula");
  const RATE_METHOD = S("signals.method.rate", { formula });
  const ENG_METHOD = S("signals.method.engagement", { formula });
  const weekday = (d: number) => new Intl.DateTimeFormat(t.locale, { weekday: "long", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + d));

  for (const perf of input.performance) {
    const platform = perf.platform;
    const label = PLATFORM_LABELS[platform];
    const useRate = perf.metric === "engagement_rate";
    // metrics.unit stays an English code; the statement uses the translated unit
    const unitCode = useRate ? "engagement rate" : "interactions per post";
    const unit = useRate ? S("signals.unit.rate") : S("signals.unit.interactions");
    const fmtScore = (v: number | null) => (v == null ? "?" : useRate ? S("signals.percent", { value: v }) : S("signals.number", { value: v }));
    const platformItems = input.items.filter((i) => i.platform === platform && engagementOf(i) != null);
    const reachOk = usableReach(platformItems);
    // same pool as computePerformance: rate-ranked posts need a usable reach
    const scoreOf = (i: SignalItem) => (useRate ? (reachOk(i) ? engagementRate(i) : null) : engagementOf(i));
    const pool = platformItems.filter((i) => scoreOf(i) != null);
    const period = periodOf(pool);
    const method = useRate ? RATE_METHOD : ENG_METHOD;
    const topIds = (list: SignalItem[], k = 8) => [...list].sort((a, b) => (scoreOf(b) ?? 0) - (scoreOf(a) ?? 0)).slice(0, k).map((i) => i.id);

    // Pillars and formats that out- or under-perform (≥5 posts, lift outside 0.8–1.25)
    for (const g of perf.byPillar) {
      if (g.n < 5 || g.lift == null || (g.lift < LIFT_STRONG && g.lift > LIFT_WEAK)) continue;
      const list = pool.filter((i) => i.pillar_id === g.key);
      out.push({
        kind: "pillar_performance", category: "historical", platform, pillar_id: g.key, format: null,
        statement: S("signals.statement.pillarPerformance", { platform: label, group: g.label, unit, score: fmtScore(g.medianScore), baseline: fmtScore(perf.baseline), lift: g.lift, count: g.n, period: periodText(periodOf(list)) }),
        method, period: periodOf(list), n: g.n, lift: g.lift, gap: null,
        metrics: { group_median: g.medianScore, platform_median: perf.baseline, median_engagement: g.medianEngagement, unit: unitCode },
        ref_ids: topIds(list),
      });
    }
    for (const g of perf.byFormat) {
      if (g.n < 5 || g.lift == null || (g.lift < LIFT_STRONG && g.lift > LIFT_WEAK)) continue;
      const list = pool.filter((i) => normalizeFormat(i.format) === g.key);
      out.push({
        kind: "format_performance", category: "historical", platform, pillar_id: null, format: g.key,
        statement: S("signals.statement.formatPerformance", { platform: label, group: g.label.replace(/ posts?$/i, ""), unit, score: fmtScore(g.medianScore), baseline: fmtScore(perf.baseline), lift: g.lift, count: g.n, period: periodText(periodOf(list)) }),
        method, period: periodOf(list), n: g.n, lift: g.lift, gap: null,
        metrics: { group_median: g.medianScore, platform_median: perf.baseline, median_engagement: g.medianEngagement, unit: unitCode },
        ref_ids: topIds(list),
      });
    }
    // Topics (content words in ≥5 posts)
    for (const tp of perf.topics) {
      if (tp.n < 5 || tp.lift == null || (tp.lift < 1.3 && tp.lift > 0.7)) continue;
      const list = pool.filter((i) => contentTokens(`${i.title ?? ""} ${i.topic ?? ""} ${captionHook(i.caption) ?? ""}`).includes(tp.topic));
      out.push({
        kind: "topic_performance", category: "historical", platform, pillar_id: null, format: null,
        statement: S("signals.statement.topicPerformance", { platform: label, topic: tp.topic, unit, score: fmtScore(tp.medianScore), baseline: fmtScore(perf.baseline), lift: tp.lift, count: tp.n }),
        method: S("signals.method.topic", { method }), period: periodOf(list), n: tp.n, lift: tp.lift, gap: null,
        metrics: { group_median: tp.medianScore, platform_median: perf.baseline, unit: unitCode },
        ref_ids: topIds(list),
      });
    }
    for (const h of perf.hooks.patterns) {
      if (h.n < 10 || h.lift == null || (h.lift < LIFT_STRONG && h.lift > LIFT_WEAK)) continue;
      out.push({
        kind: "hook_pattern", category: "historical", platform, pillar_id: null, format: null,
        statement: S("signals.statement.hookPattern", { platform: label, hook: h.label, unit, score: fmtScore(h.medianScore), baseline: fmtScore(perf.baseline), lift: h.lift, count: h.n }),
        method: S("signals.method.hook", { method }), period, n: h.n, lift: h.lift, gap: null,
        metrics: { group_median: h.medianScore, platform_median: perf.baseline, unit: unitCode }, ref_ids: [],
      });
    }
    for (const c of perf.ctas) {
      if (c.n < 10 || c.lift == null || (c.lift < LIFT_STRONG && c.lift > LIFT_WEAK)) continue;
      out.push({
        kind: "cta_pattern", category: "historical", platform, pillar_id: null, format: null,
        statement: S("signals.statement.ctaPattern", { platform: label, cta: c.label, unit, score: fmtScore(c.medianScore), baseline: fmtScore(perf.baseline), lift: c.lift, count: c.n }),
        method: S("signals.method.cta", { method }), period, n: c.n, lift: c.lift, gap: null,
        metrics: { group_median: c.medianScore, platform_median: perf.baseline, unit: unitCode }, ref_ids: [],
      });
    }
    // Outliers: the 3 best posts more than 3× the median, the 3 weakest
    for (const p of perf.top.slice(0, 3)) {
      if (perf.baseline == null || p.score == null || p.score < perf.baseline * 3) continue;
      out.push({
        kind: "top_post", category: "historical", platform, pillar_id: null, format: p.format,
        statement: S(useRate ? "signals.statement.topPostRate" : "signals.statement.topPostCount", {
          title: p.title.slice(0, 90), details: [label, p.date ?? S("signals.undated"), p.format].filter(Boolean).join(", "), score: useRate ? fmtScore(p.score) : p.score, lift: r1(p.score / perf.baseline),
        }),
        method, period: { from: p.date, to: p.date }, n: 1, lift: r1(p.score / perf.baseline), gap: null,
        metrics: { score: p.score, platform_median: perf.baseline, engagement: p.engagement, reach: p.raw.reach ?? null, unit: unitCode }, ref_ids: [p.id],
      });
    }
    for (const p of perf.bottom.slice(0, 3)) {
      if (perf.baseline == null || p.score == null) continue;
      out.push({
        kind: "low_post", category: "historical", platform, pillar_id: null, format: p.format,
        statement: S("signals.statement.lowPost", { title: p.title.slice(0, 90), platform: label, date: p.date ?? S("signals.undated"), unit, score: fmtScore(p.score), baseline: fmtScore(perf.baseline) }),
        method, period: { from: p.date, to: p.date }, n: 1, lift: perf.baseline ? r1(p.score / perf.baseline) : null, gap: null,
        metrics: { score: p.score, platform_median: perf.baseline, unit: unitCode }, ref_ids: [p.id],
      });
    }
    for (const p of perf.refreshCandidates.slice(0, 4)) {
      out.push({
        kind: "refresh", category: "historical", platform, pillar_id: null, format: p.format,
        statement: S("signals.statement.refresh", { title: p.title.slice(0, 90), platform: label, date: p.date ?? S("signals.undated") }),
        method: S("signals.method.refresh", { method }),
        period: { from: p.date, to: p.date }, n: 1, lift: perf.baseline && p.score != null ? r1(p.score / perf.baseline) : null, gap: null,
        metrics: { score: p.score, platform_median: perf.baseline, unit: unitCode }, ref_ids: [p.id],
      });
    }
  }

  // Timing (interactions per post) — the suggestions already require ≥5 posts and ≥1% of the history
  for (const tm of input.timing) {
    const best = tm.suggestions[0];
    if (!best) continue;
    out.push({
      kind: "timing", category: "historical", platform: tm.platform, pillar_id: null, format: null,
      statement: S("signals.statement.timing", { platform: tm.label, weekday: weekday(best.weekday), window: windowLabel(best.window), lift: best.lift ?? 0, count: best.n, total: tm.posts }),
      method: S("signals.method.timing", { formula }),
      period: periodOf(input.items.filter((i) => i.platform === tm.platform && i.published_at)), n: best.n, lift: best.lift, gap: null,
      metrics: { window: best.label, median: best.median, platform_median: tm.baseline }, ref_ids: [],
    });
  }

  // --- Strategy gaps -----------------------------------------------------------------------------------------
  const withPillar = input.items.filter((i) => i.pillar_id);
  const recentFrom = shiftDays(input.today, -90);
  for (const p of input.pillars) {
    const list = withPillar.filter((i) => i.pillar_id === p.id);
    const actual = withPillar.length ? (list.length / withPillar.length) * 100 : 0;
    if (p.target_share != null && withPillar.length >= 20) {
      const target = Number(p.target_share);
      if (target - actual >= 5) {
        out.push({
          kind: "pillar_gap", category: "strategy", platform: null, pillar_id: p.id, format: null,
          statement: S("signals.statement.pillarGap", { pillar: p.name, actual: pct(actual), target: S("signals.percent", { value: target }), count: list.length, total: withPillar.length }),
          method: S("signals.method.pillarGap"),
          period: periodOf(withPillar), n: withPillar.length, lift: null, gap: r1(target - actual),
          metrics: { actual_share: r1(actual), target_share: target, posts: list.length }, ref_ids: [],
        });
      }
    }
    const recent = list.filter((i) => (dateOf(i) ?? "") >= recentFrom).length;
    if (withPillar.length >= 20 && recent === 0) {
      out.push({
        kind: "pillar_dormant", category: "strategy", platform: null, pillar_id: p.id, format: null,
        statement: S("signals.statement.pillarDormant", { pillar: p.name, since: recentFrom, count: list.length }),
        method: S("signals.method.pillarDormant"),
        period: { from: recentFrom, to: input.today }, n: list.length, lift: null, gap: p.target_share != null ? Number(p.target_share) : 10,
        metrics: { posts_last_90_days: 0, posts_total: list.length }, ref_ids: list.slice(-3).map((i) => i.id),
      });
    }
  }

  // Funnel stages: only when enough posts record a stage, otherwise the share would be meaningless
  const withFunnel = input.items.filter((i) => i.funnel_stage && (FUNNEL_STAGES as readonly string[]).includes(i.funnel_stage));
  if (withFunnel.length >= 30 && withFunnel.length >= input.items.length * 0.3) {
    for (const stage of input.strategyFunnel) {
      const n = withFunnel.filter((i) => i.funnel_stage === stage).length;
      const share = (n / withFunnel.length) * 100;
      if (share < 10) {
        out.push({
          kind: "funnel_gap", category: "strategy", platform: null, pillar_id: null, format: null,
          statement: S("signals.statement.funnelGap", { stage: td(`funnel.${stage}`), share: pct(share), count: n, total: withFunnel.length }),
          method: S("signals.method.funnelGap"),
          period: periodOf(withFunnel), n: withFunnel.length, lift: null, gap: r1(10 - share), metrics: { share: r1(share), posts: n }, ref_ids: [],
        });
      }
    }
  }

  // Formats expected on an active platform but never used
  for (const platform of input.activePlatforms) {
    const list = input.items.filter((i) => i.platform === platform);
    if (list.length < 20) continue;
    const used = new Set(list.map((i) => normalizeFormat(i.format)).filter(Boolean));
    for (const f of (EXPECTED_FORMATS[platform] ?? []).filter((f) => !used.has(f))) {
      out.push({
        kind: "format_gap", category: "strategy", platform, pillar_id: null, format: f,
        statement: S("signals.statement.formatGap", { format: f, platform: PLATFORM_LABELS[platform], count: list.length }),
        method: S("signals.method.formatGap"),
        period: periodOf(list), n: list.length, lift: null, gap: 10, metrics: { posts: list.length }, ref_ids: [],
      });
    }
  }

  // --- Competitors: frequency always; engagement only when real counts exist ----------------------------------
  if (input.competitorItems.length >= 5) {
    const counts = new Map<string, Set<string>>();
    for (const c of input.competitorItems) for (const w of new Set(contentTokens(`${c.title ?? ""} ${c.topic ?? ""} ${captionHook(c.caption) ?? ""}`))) counts.set(w, (counts.get(w) ?? new Set()).add(c.id));
    const ownTokens = new Set(input.items.flatMap((i) => contentTokens(`${i.title ?? ""} ${i.topic ?? ""}`)));
    const frequent = [...counts.entries()].filter(([, ids]) => ids.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 8);
    for (const [topic, ids] of frequent) {
      const list = input.competitorItems.filter((c) => ids.has(c.id));
      const withCounts = list.filter((c) => c.likes != null || c.comments != null || c.shares != null);
      const eng = withCounts.map((c) => (c.likes ?? 0) + (c.comments ?? 0) + (c.shares ?? 0)).sort((a, b) => a - b);
      const competitors = [...new Set(list.map((c) => c.competitor))];
      out.push({
        kind: "competitor_topic", category: "competitor", platform: null, pillar_id: null, format: null,
        statement: S("signals.statement.competitorTopic", {
          topic, count: ids.size, competitors: competitors.slice(0, 3).join(", "),
          own: ownTokens.has(topic) ? "" : S("signals.statement.competitorNotOwn"),
          engagement: withCounts.length >= 3 ? S("signals.statement.competitorEngagement", { median: eng[Math.floor(eng.length / 2)]!, count: withCounts.length }) : S("signals.statement.competitorNoCounts"),
        }),
        method: S("signals.method.competitor"),
        period: { from: list.map((c) => c.published_at?.slice(0, 10)).filter(Boolean).sort()[0] ?? null, to: list.map((c) => c.published_at?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null },
        n: ids.size, lift: null, gap: ownTokens.has(topic) ? null : 10, metrics: { competitor_posts: ids.size, own_coverage: ownTokens.has(topic) ? "yes" : "none" }, ref_ids: [],
      });
    }
  }

  // --- Search demand: real Google results for keywords analysed in Google search ---------------------------
  for (const q of (input.searchItems ?? []).slice(0, 12)) {
    out.push({
      kind: "search_demand", category: "search", platform: "blog", pillar_id: null, format: null,
      statement: S("signals.statement.searchDemand", {
        country: q.country.toUpperCase(), language: q.language, keyword: q.keyword,
        intent: S(`signals.intent.${q.intent === "informational" || q.intent === "commercial" || q.intent === "transactional" || q.intent === "navigational" ? q.intent : "unknown"}`),
        position: q.ownPosition ? S("signals.statement.ranks", { position: q.ownPosition }) : S("signals.statement.notInResults"),
        questions: q.questions.length ? S("signals.statement.peopleAlsoAsk", { list: q.questions.slice(0, 3).map((x) => `"${x}"`).join(", ") }) : "",
        related: q.related.length ? S("signals.statement.related", { list: q.related.slice(0, 3).join(", ") }) : "",
      }),
      method: S("signals.method.search"),
      period: { from: q.date, to: q.date }, n: q.resultsRead, lift: null, gap: q.ownPosition ? null : 10,
      metrics: { keyword: q.keyword, intent: q.intent, own_position: q.ownPosition, questions: q.questions.length }, ref_ids: [q.id],
    });
  }

  // --- Feedback loop: published calendar posts judged on their objective's KPI --------------------------------
  for (const l of input.learnings ?? []) {
    out.push({
      kind: "published_result", category: "results", platform: l.platform, pillar_id: null, format: l.format,
      statement: l.statement, method: S("signals.method.published"),
      period: { from: null, to: null }, n: l.n, lift: l.ratio, gap: null, metrics: { ratio: l.ratio, posts: l.n }, ref_ids: l.ref_ids,
    });
  }

  return out.map((s, k) => ({ ...s, key: `S${k + 1}` }));
}

function shiftDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Signals as prompt lines: the model sees keys, statements and sample sizes, nothing else. */
export function signalsDigest(signals: Signal[], pillarName: (id: string) => string | undefined) {
  if (!signals.length) return "No signals could be computed (not enough historical posts with metrics, and no strategy gaps). Every idea must be a hypothesis or an experiment.";
  return signals
    .map((s) => `${s.key} [${s.category}/${s.kind}${s.platform ? `/${s.platform}` : ""}${s.pillar_id ? `/pillar: ${pillarName(s.pillar_id) ?? "?"}` : ""}${s.format ? `/format: ${s.format}` : ""}] ${s.statement}`)
    .join("\n");
}
