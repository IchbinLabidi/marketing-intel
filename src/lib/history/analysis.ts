import { METRICS, PLATFORM_LABELS, type Metric, type Platform } from "@/lib/domain/constants";
import type { HistoricalItem } from "@/types/domain";
import { normalizeFormat, statusGroup, type StatusGroup } from "./parse";
import { SEASONS, seasonWindows, schoolYearOf, type SeasonKey } from "./seasons";
import { findRepetitions, type RepetitionCluster } from "./similarity";
import { normalizeText } from "./text";

export type AnalysisItem = Pick<
  HistoricalItem,
  | "id" | "import_job_id" | "publication_date" | "actual_publication_date" | "platform" | "title" | "topic" | "caption"
  | "format" | "content_pillar" | "pillar_id" | "campaign" | "campaign_id" | "publication_status"
> & Partial<Record<Metric, number | null>>;

export type AnalysisContext = {
  pillars: { id: string; name: string; target_share: number | null }[];
  campaigns: { id: string; name: string }[];
  channels: { platform: Platform; is_active: boolean; target_posts_per_week: number | null }[];
  ramadanRelevant: boolean;
};

export type CountRow = { key: string; label: string; count: number; share: number };

export type HistoricalStats = ReturnType<typeof computeHistoricalStats>;

/** The date used for timelines: actual publication date when the file has one, otherwise the planned date. */
export const effectiveDate = (i: Pick<AnalysisItem, "publication_date" | "actual_publication_date">) => i.actual_publication_date ?? i.publication_date;

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const round1 = (n: number) => Math.round(n * 10) / 10;

function countBy<T>(items: T[], keyOf: (i: T) => string | null, labelOf: (k: string) => string = (k) => k): CountRow[] {
  const map = new Map<string, number>();
  for (const i of items) {
    const k = keyOf(i) ?? "__none";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const total = items.length || 1;
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: key === "__none" ? "Not specified" : labelOf(key), count, share: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function monthsBetween(start: string, end: string) {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey || out.length > 240) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Formats a channel is normally expected to use. Used only to point out untested formats, never as a judgement.
export const EXPECTED_FORMATS: Partial<Record<Platform, string[]>> = {
  instagram: ["Short video", "Carousel", "Story", "Image post"],
  facebook: ["Image post", "Video", "Short video", "Live"],
  tiktok: ["Short video", "Live"],
  linkedin: ["Text post", "Carousel", "Image post", "Article"],
  youtube: ["Video", "Short video", "Live"],
  blog: ["Article"],
  newsletter: ["Newsletter"],
};

/**
 * Deterministic analysis of imported history. Every number here is computed from imported rows;
 * nothing is estimated. AI recommendations are built on top of this output, not instead of it.
 */
export function computeHistoricalStats(items: AnalysisItem[], ctx: AnalysisContext) {
  const pillarName = new Map(ctx.pillars.map((p) => [p.id, p.name]));
  const campaignName = new Map(ctx.campaigns.map((c) => [c.id, c.name]));
  const dated = items.filter((i) => effectiveDate(i)).sort((a, b) => effectiveDate(a)!.localeCompare(effectiveDate(b)!));
  const start = dated.length ? effectiveDate(dated[0])! : null;
  const end = dated.length ? effectiveDate(dated[dated.length - 1])! : null;
  const weeks = start && end ? Math.max(1, (daysBetween(start, end) + 1) / 7) : null;

  // --- Status (as imported) -------------------------------------------------
  const statuses = items.map((i) => statusGroup(i.publication_status));
  const statusCounts = Object.fromEntries(
    (["published", "planned", "idea", "cancelled", "unknown"] as StatusGroup[]).map((g) => [g, statuses.filter((s) => s === g).length]),
  ) as Record<StatusGroup, number>;

  // --- Distribution ---------------------------------------------------------
  const byMonth = start && end
    ? monthsBetween(start, end).map((month) => {
        const inMonth = dated.filter((i) => effectiveDate(i)!.startsWith(month));
        return { month, count: inMonth.length, published: inMonth.filter((i) => statusGroup(i.publication_status) === "published").length };
      })
    : [];
  const byPlatform = countBy(items, (i) => i.platform, (k) => PLATFORM_LABELS[k as Platform] ?? k);
  const byFormat = countBy(items, (i) => normalizeFormat(i.format));
  const byPillar = countBy(
    items,
    (i) => (i.pillar_id ? `id:${i.pillar_id}` : i.content_pillar ? `raw:${normalizeText(i.content_pillar)}` : null),
    (k) => (k.startsWith("id:") ? pillarName.get(k.slice(3)) ?? "Deleted pillar" : `${items.find((i) => `raw:${normalizeText(i.content_pillar)}` === k)?.content_pillar} (not linked to strategy)`),
  );
  const byCampaign = countBy(
    items.filter((i) => i.campaign || i.campaign_id),
    (i) => (i.campaign_id ? campaignName.get(i.campaign_id) ?? i.campaign : i.campaign) ?? null,
  );

  // --- Frequency ------------------------------------------------------------
  const perWeek = weeks ? round1(dated.length / weeks) : null;
  const platformFrequency = byPlatform
    .filter((p) => p.key !== "__none")
    .map((p) => {
      const n = dated.filter((i) => i.platform === p.key).length;
      const channel = ctx.channels.find((c) => c.platform === p.key);
      return { platform: p.key as Platform, label: p.label, perWeek: weeks ? round1(n / weeks) : null, target: channel?.target_posts_per_week ?? null };
    });

  const monthly = byMonth.map((m) => m.count).sort((a, b) => a - b);
  const median = monthly.length ? monthly[Math.floor(monthly.length / 2)] : 0;
  const lowMonths = byMonth.filter((m) => byMonth.length >= 3 && m.count <= median * 0.5).map((m) => ({ month: m.month, count: m.count, median }));
  const silentGaps: { from: string; to: string; days: number }[] = [];
  for (let k = 1; k < dated.length; k++) {
    const a = effectiveDate(dated[k - 1])!, b = effectiveDate(dated[k])!;
    const days = daysBetween(a, b);
    if (days >= 21) silentGaps.push({ from: a, to: b, days });
  }

  // --- Pillar balance vs strategy -------------------------------------------
  const linked = items.filter((i) => i.pillar_id);
  const pillarBalance = ctx.pillars.map((p) => {
    const count = linked.filter((i) => i.pillar_id === p.id).length;
    const actual = linked.length ? Math.round((count / linked.length) * 1000) / 10 : 0;
    const target = p.target_share == null ? null : Number(p.target_share);
    const status: "missing" | "under" | "over" | "balanced" | "no_target" =
      count === 0 ? "missing"
      : target == null ? "no_target"
      : actual < target * 0.7 && target - actual >= 5 ? "under"
      : actual > target + 10 ? "over"
      : "balanced";
    return { id: p.id, name: p.name, count, actual, target, status };
  });
  const unlinkedPillarText = items.filter((i) => !i.pillar_id && i.content_pillar).length;

  // --- Formats not used on active platforms ---------------------------------
  const activePlatforms = new Set<Platform>([
    ...ctx.channels.filter((c) => c.is_active).map((c) => c.platform),
    ...items.map((i) => i.platform).filter((p): p is Platform => Boolean(p) && p !== "other"),
  ]);
  const formatGaps = [...activePlatforms].flatMap((platform) => {
    const used = new Set(items.filter((i) => i.platform === platform).map((i) => normalizeFormat(i.format)).filter(Boolean));
    const missing = (EXPECTED_FORMATS[platform] ?? []).filter((f) => !used.has(f));
    return missing.length ? [{ platform, label: PLATFORM_LABELS[platform], missing, used: [...used] as string[] }] : [];
  });

  // --- Repetition -----------------------------------------------------------
  const repetitions: RepetitionCluster[] = findRepetitions(
    items.map((i) => ({ id: i.id, text: [i.title, i.topic].filter(Boolean).join(" ") || i.caption?.slice(0, 160) || "", date: effectiveDate(i), format: normalizeFormat(i.format), platform: i.platform })),
  );
  const campaignThemes = (() => {
    const map = new Map<string, { name: string; dates: string[] }>();
    for (const i of items) {
      const name = i.campaign_id ? campaignName.get(i.campaign_id) ?? i.campaign : i.campaign;
      if (!name) continue;
      const k = normalizeText(name);
      const entry = map.get(k) ?? { name, dates: [] };
      const d = effectiveDate(i);
      if (d) entry.dates.push(d);
      map.set(k, entry);
    }
    return [...map.values()]
      .map((c) => {
        const years = [...new Set(c.dates.map(schoolYearOf))].sort();
        return { name: c.name, posts: c.dates.length, schoolYears: years, recurring: years.length >= 2 };
      })
      .sort((a, b) => Number(b.recurring) - Number(a.recurring) || b.posts - a.posts);
  })();

  // --- Seasonality (only windows fully covered by the imported period) ------
  const seasons = start && end ? (() => {
    const windows = seasonWindows(start, end);
    const perDay = dated.length / Math.max(1, daysBetween(start, end) + 1);
    const observed = windows.map((w) => {
      const covered = start <= w.start && end >= w.end;
      const inWindow = dated.filter((i) => effectiveDate(i)! >= w.start && effectiveDate(i)! <= w.end);
      const days = daysBetween(w.start, w.end) + 1;
      const index = perDay > 0 ? round1(inWindow.length / days / perDay) : 0;
      const campaigns = [...new Set(inWindow.map((i) => (i.campaign_id ? campaignName.get(i.campaign_id) : i.campaign)).filter((c): c is string => Boolean(c)))];
      return { ...w, covered, count: inWindow.length, index, campaigns };
    });
    return SEASONS.filter((s) => s.key !== "ramadan" || ctx.ramadanRelevant).map((s) => {
      const years = observed.filter((o) => o.key === s.key && o.covered);
      return {
        key: s.key as SeasonKey,
        label: s.label,
        group: s.group,
        years: years.map((y) => ({ schoolYear: y.schoolYear, start: y.start, end: y.end, count: y.count, index: y.index, campaigns: y.campaigns })),
        // index > 1 = more posts per day than the period average
        pattern: years.length === 0 ? ("not_covered" as const)
          : years.filter((y) => y.index >= 1.25).length >= Math.max(1, Math.ceil(years.length / 2)) ? ("peak" as const)
          : years.every((y) => y.index <= 0.6) ? ("quiet" as const) : ("normal" as const),
      };
    });
  })() : [];

  // --- Metrics (only what was imported) -------------------------------------
  const metricCoverage = METRICS.map((m) => ({ metric: m, values: items.filter((i) => i[m] != null).length })).filter((m) => m.values > 0);
  const metricByFormat = metricCoverage
    .filter((m) => m.values >= 5)
    .map(({ metric }) => {
      const withValue = items.filter((i) => i[metric] != null);
      const groups = countBy(withValue, (i) => normalizeFormat(i.format)).filter((g) => g.count >= 3 && g.key !== "__none");
      return {
        metric,
        rows: groups.map((g) => {
          const vals = withValue.filter((i) => normalizeFormat(i.format) === g.key).map((i) => i[metric] as number);
          return { format: g.key, n: vals.length, average: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) };
        }).sort((a, b) => b.average - a.average),
      };
    })
    .filter((m) => m.rows.length >= 2);

  return {
    totals: {
      items: items.length,
      dated: dated.length,
      start,
      end,
      weeks: weeks ? round1(weeks) : null,
      imports: new Set(items.map((i) => i.import_job_id)).size,
      status: statusCounts,
    },
    byMonth,
    byPlatform,
    byFormat,
    byPillar,
    byCampaign,
    frequency: { perWeek, platforms: platformFrequency, lowMonths, silentGaps: silentGaps.sort((a, b) => b.days - a.days).slice(0, 10) },
    pillarBalance,
    unlinkedPillarText,
    formatGaps,
    repetitions: repetitions.slice(0, 40),
    campaignThemes,
    seasons,
    metrics: { coverage: metricCoverage, byFormat: metricByFormat },
    dataQuality: {
      missingDate: items.length - dated.length,
      missingPlatform: items.filter((i) => !i.platform).length,
      missingFormat: items.filter((i) => !i.format).length,
      missingPillar: items.filter((i) => !i.pillar_id && !i.content_pillar).length,
      missingStatus: items.filter((i) => !i.publication_status).length,
    },
  };
}
