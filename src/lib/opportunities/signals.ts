import { FUNNEL_LABELS, FUNNEL_STAGES, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { EXPECTED_FORMATS } from "@/lib/history/analysis";
import { normalizeFormat } from "@/lib/history/parse";
import { ENGAGEMENT_FORMULA, engagementOf, engagementRate, usableReach, type PerfItem, type PlatformPerformance } from "@/lib/history/performance";
import { contentTokens } from "@/lib/history/text";
import { captionHook } from "@/lib/meta/normalize";
import { WEEKDAY_LABELS, windowLabel, type PlatformTiming } from "@/lib/calendar/insights";

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
  /** latest SERP analysis per keyword (SERP Intelligence), real Google results */
  searchItems?: { id: string; keyword: string; country: string; language: string; intent: string | null; ownPosition: number | null; questions: string[]; related: string[]; resultsRead: number; date: string }[];
  /** results of published calendar posts vs their objective (editorial feedback loop) */
  learnings?: { key: string; statement: string; n: number; ratio: number; platform: Platform; format: string | null; ref_ids: string[] }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${r1(n)}%`;
const dateOf = (i: SignalItem) => i.actual_publication_date ?? i.publication_date ?? i.published_at?.slice(0, 10) ?? null;
const RATE_METHOD = `Median engagement rate (${ENGAGEMENT_FORMULA}, ÷ reach) of the group ÷ the platform median. Posts whose reach is truncated (below their interactions or under 10% of the platform's recent median reach) are excluded.`;
const ENG_METHOD = `Median engagement (${ENGAGEMENT_FORMULA}) of the group ÷ the platform median.`;
const LIFT_STRONG = 1.25;
const LIFT_WEAK = 0.8;

function periodOf(list: SignalItem[]) {
  const d = list.map(dateOf).filter((x): x is string => Boolean(x)).sort();
  return { from: d[0] ?? null, to: d.at(-1) ?? null };
}
const periodText = (p: { from: string | null; to: string | null }) => (p.from ? `${p.from} → ${p.to}` : "undated");

export function buildSignals(input: SignalInput): Signal[] {
  const out: Omit<Signal, "key">[] = [];

  for (const perf of input.performance) {
    const platform = perf.platform;
    const label = PLATFORM_LABELS[platform];
    const useRate = perf.metric === "engagement_rate";
    const unit = useRate ? "engagement rate" : "interactions per post";
    const fmtScore = (v: number | null) => (v == null ? "?" : useRate ? `${v}%` : String(v));
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
        statement: `On ${label}, "${g.label}" posts have a median ${unit} of ${fmtScore(g.medianScore)} vs ${fmtScore(perf.baseline)} for all ${label} posts (×${g.lift}, ${g.n} posts, ${periodText(periodOf(list))}).`,
        method, period: periodOf(list), n: g.n, lift: g.lift, gap: null,
        metrics: { group_median: g.medianScore, platform_median: perf.baseline, median_engagement: g.medianEngagement, unit },
        ref_ids: topIds(list),
      });
    }
    for (const g of perf.byFormat) {
      if (g.n < 5 || g.lift == null || (g.lift < LIFT_STRONG && g.lift > LIFT_WEAK)) continue;
      const list = pool.filter((i) => normalizeFormat(i.format) === g.key);
      out.push({
        kind: "format_performance", category: "historical", platform, pillar_id: null, format: g.key,
        statement: `On ${label}, ${/posts?$/i.test(g.label) ? `${g.label.replace(/ posts?$/i, "")} posts` : `${g.label} posts`} have a median ${unit} of ${fmtScore(g.medianScore)} vs ${fmtScore(perf.baseline)} overall (×${g.lift}, ${g.n} posts, ${periodText(periodOf(list))}).`,
        method, period: periodOf(list), n: g.n, lift: g.lift, gap: null,
        metrics: { group_median: g.medianScore, platform_median: perf.baseline, median_engagement: g.medianEngagement, unit },
        ref_ids: topIds(list),
      });
    }
    // Topics (content words in ≥5 posts)
    for (const t of perf.topics) {
      if (t.n < 5 || t.lift == null || (t.lift < 1.3 && t.lift > 0.7)) continue;
      const list = pool.filter((i) => contentTokens(`${i.title ?? ""} ${i.topic ?? ""} ${captionHook(i.caption) ?? ""}`).includes(t.topic));
      out.push({
        kind: "topic_performance", category: "historical", platform, pillar_id: null, format: null,
        statement: `On ${label}, posts mentioning "${t.topic}" have a median ${unit} of ${fmtScore(t.medianScore)} vs ${fmtScore(perf.baseline)} (×${t.lift}, ${t.n} posts).`,
        method: `${method} Topic = the word appears in the title, topic or first line of the caption.`, period: periodOf(list), n: t.n, lift: t.lift, gap: null,
        metrics: { group_median: t.medianScore, platform_median: perf.baseline, unit },
        ref_ids: topIds(list),
      });
    }
    for (const h of perf.hooks.patterns) {
      if (h.n < 10 || h.lift == null || (h.lift < LIFT_STRONG && h.lift > LIFT_WEAK)) continue;
      out.push({
        kind: "hook_pattern", category: "historical", platform, pillar_id: null, format: null,
        statement: `On ${label}, hooks of type "${h.label}" have a median ${unit} of ${fmtScore(h.medianScore)} vs ${fmtScore(perf.baseline)} (×${h.lift}, ${h.n} posts).`,
        method: `${method} Hook = first line of the caption, classified by pattern.`, period, n: h.n, lift: h.lift, gap: null,
        metrics: { group_median: h.medianScore, platform_median: perf.baseline, unit }, ref_ids: [],
      });
    }
    for (const c of perf.ctas) {
      if (c.n < 10 || c.lift == null || (c.lift < LIFT_STRONG && c.lift > LIFT_WEAK)) continue;
      out.push({
        kind: "cta_pattern", category: "historical", platform, pillar_id: null, format: null,
        statement: `On ${label}, posts with a "${c.label}" call to action have a median ${unit} of ${fmtScore(c.medianScore)} vs ${fmtScore(perf.baseline)} (×${c.lift}, ${c.n} posts).`,
        method: `${method} CTA detected by keywords in the caption.`, period, n: c.n, lift: c.lift, gap: null,
        metrics: { group_median: c.medianScore, platform_median: perf.baseline, unit }, ref_ids: [],
      });
    }
    // Outliers: the 3 best posts more than 3× the median, the 3 weakest
    for (const t of perf.top.slice(0, 3)) {
      if (perf.baseline == null || t.score == null || t.score < perf.baseline * 3) continue;
      out.push({
        kind: "top_post", category: "historical", platform, pillar_id: null, format: t.format,
        statement: `"${t.title.slice(0, 90)}" (${label}, ${t.date ?? "undated"}${t.format ? `, ${t.format}` : ""}) had ${useRate ? `an engagement rate of ${fmtScore(t.score)}` : `${t.score} interactions`}, ×${r1(t.score / perf.baseline)} the platform median.`,
        method, period: { from: t.date, to: t.date }, n: 1, lift: r1(t.score / perf.baseline), gap: null,
        metrics: { score: t.score, platform_median: perf.baseline, engagement: t.engagement, reach: t.raw.reach ?? null, unit }, ref_ids: [t.id],
      });
    }
    for (const t of perf.bottom.slice(0, 3)) {
      if (perf.baseline == null || t.score == null) continue;
      out.push({
        kind: "low_post", category: "historical", platform, pillar_id: null, format: t.format,
        statement: `"${t.title.slice(0, 90)}" (${label}, ${t.date ?? "undated"}) is among the weakest ${label} posts: ${unit} ${fmtScore(t.score)} vs median ${fmtScore(perf.baseline)}.`,
        method, period: { from: t.date, to: t.date }, n: 1, lift: perf.baseline ? r1(t.score / perf.baseline) : null, gap: null,
        metrics: { score: t.score, platform_median: perf.baseline, unit }, ref_ids: [t.id],
      });
    }
    for (const t of perf.refreshCandidates.slice(0, 4)) {
      out.push({
        kind: "refresh", category: "historical", platform, pillar_id: null, format: t.format,
        statement: `"${t.title.slice(0, 90)}" (${label}, ${t.date}) is in the top quarter of ${label} posts and is over 6 months old: a candidate to refresh or repurpose.`,
        method: `${method} Top quarter = score at or above the 75th percentile; age measured from publication date.`,
        period: { from: t.date, to: t.date }, n: 1, lift: perf.baseline && t.score != null ? r1(t.score / perf.baseline) : null, gap: null,
        metrics: { score: t.score, platform_median: perf.baseline, unit }, ref_ids: [t.id],
      });
    }
  }

  // Timing (interactions per post) — the suggestions already require ≥5 posts and ≥1% of the history
  for (const t of input.timing) {
    const best = t.suggestions[0];
    if (!best) continue;
    out.push({
      kind: "timing", category: "historical", platform: t.platform, pillar_id: null, format: null,
      statement: `On ${t.label}, posts published ${WEEKDAY_LABELS[best.weekday]} ${windowLabel(best.window)} get ×${best.lift} the median interactions per post (${best.n} posts out of ${t.posts} with exact times).`,
      method: `Median interactions per post (${ENGAGEMENT_FORMULA}) in the weekday × 3-hour window ÷ the platform median; project time zone.`,
      period: periodOf(input.items.filter((i) => i.platform === t.platform && i.published_at)), n: best.n, lift: best.lift, gap: null,
      metrics: { window: best.label, median: best.median, platform_median: t.baseline }, ref_ids: [],
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
          statement: `"${p.name}" is ${pct(actual)} of posts linked to a pillar, below its strategy target of ${target}% (${list.length} of ${withPillar.length} posts).`,
          method: "Share of historical posts assigned to the pillar (by import, a person or AI) vs the target share set in the strategy.",
          period: periodOf(withPillar), n: withPillar.length, lift: null, gap: r1(target - actual),
          metrics: { actual_share: r1(actual), target_share: target, posts: list.length }, ref_ids: [],
        });
      }
    }
    const recent = list.filter((i) => (dateOf(i) ?? "") >= recentFrom).length;
    if (withPillar.length >= 20 && recent === 0) {
      out.push({
        kind: "pillar_dormant", category: "strategy", platform: null, pillar_id: p.id, format: null,
        statement: `No post linked to "${p.name}" in the last 90 days (since ${recentFrom}); ${list.length} posts in total.`,
        method: "Count of historical posts assigned to the pillar with a publication date in the last 90 days.",
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
          statement: `The strategy describes a ${FUNNEL_LABELS[stage]} stage, but only ${pct(share)} of posts with a recorded funnel stage target it (${n} of ${withFunnel.length}).`,
          method: "Share of historical posts whose funnel stage is recorded, per stage described in the strategy.",
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
        statement: `${f} has never been used on ${PLATFORM_LABELS[platform]} in ${list.length} posts.`,
        method: "Formats recorded on the platform's historical posts vs the formats commonly available there.",
        period: periodOf(list), n: list.length, lift: null, gap: 10, metrics: { posts: list.length }, ref_ids: [],
      });
    }
  }

  // --- Competitors: frequency always; engagement only when real counts exist ----------------------------------
  if (input.competitorItems.length >= 5) {
    const counts = new Map<string, Set<string>>();
    for (const c of input.competitorItems) for (const t of new Set(contentTokens(`${c.title ?? ""} ${c.topic ?? ""} ${captionHook(c.caption) ?? ""}`))) counts.set(t, (counts.get(t) ?? new Set()).add(c.id));
    const ownTokens = new Set(input.items.flatMap((i) => contentTokens(`${i.title ?? ""} ${i.topic ?? ""}`)));
    const frequent = [...counts.entries()].filter(([, ids]) => ids.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 8);
    for (const [topic, ids] of frequent) {
      const list = input.competitorItems.filter((c) => ids.has(c.id));
      const withCounts = list.filter((c) => c.likes != null || c.comments != null || c.shares != null);
      const eng = withCounts.map((c) => (c.likes ?? 0) + (c.comments ?? 0) + (c.shares ?? 0)).sort((a, b) => a - b);
      const competitors = [...new Set(list.map((c) => c.competitor))];
      out.push({
        kind: "competitor_topic", category: "competitor", platform: null, pillar_id: null, format: null,
        statement: `"${topic}" appears in ${ids.size} competitor posts (${competitors.slice(0, 3).join(", ")})${ownTokens.has(topic) ? "" : "; your own history never mentions it"}${withCounts.length >= 3 ? `; median likes + comments + shares ${eng[Math.floor(eng.length / 2)]} on ${withCounts.length} posts with counts` : "; no engagement counts available"}.`,
        method: "Word frequency in competitor post titles/topics/first caption lines you imported; engagement only from counts recorded with those posts.",
        period: { from: list.map((c) => c.published_at?.slice(0, 10)).filter(Boolean).sort()[0] ?? null, to: list.map((c) => c.published_at?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null },
        n: ids.size, lift: null, gap: ownTokens.has(topic) ? null : 10, metrics: { competitor_posts: ids.size, own_coverage: ownTokens.has(topic) ? "yes" : "none" }, ref_ids: [],
      });
    }
  }

  // --- Search demand: real Google results for keywords analysed in SERP Intelligence ---------------------------
  for (const q of (input.searchItems ?? []).slice(0, 12)) {
    out.push({
      kind: "search_demand", category: "search", platform: "blog", pillar_id: null, format: null,
      statement: `Google (${q.country.toUpperCase()}, ${q.language}) for "${q.keyword}": ${q.intent ?? "unknown"} intent; your site ${q.ownPosition ? `ranks #${q.ownPosition}` : "is not in the results"}${q.questions.length ? `; people also ask: ${q.questions.slice(0, 3).map((x) => `"${x}"`).join(", ")}` : ""}${q.related.length ? `; related searches: ${q.related.slice(0, 3).join(", ")}` : ""}.`,
      method: "SERP Intelligence snapshot (real Google results via SerpApi). No search volume: the provider plan doesn't return it.",
      period: { from: q.date, to: q.date }, n: q.resultsRead, lift: null, gap: q.ownPosition ? null : 10,
      metrics: { keyword: q.keyword, intent: q.intent, own_position: q.ownPosition, questions: q.questions.length }, ref_ids: [q.id],
    });
  }

  // --- Feedback loop: published calendar posts judged on their objective's KPI --------------------------------
  for (const l of input.learnings ?? []) {
    out.push({
      kind: "published_result", category: "results", platform: l.platform, pillar_id: null, format: l.format,
      statement: l.statement, method: "Published calendar posts: their objective's KPI ÷ the same KPI's median on the platform (own history).",
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
