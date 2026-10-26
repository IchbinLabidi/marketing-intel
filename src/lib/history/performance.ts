import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import type { HistoricalItem } from "@/types/domain";
import { captionHook } from "@/lib/meta/normalize";
import { normalizeFormat } from "./parse";
import { contentTokens, normalizeText } from "./text";

// Performance analytics on imported/synced metrics. Three layers, kept apart in the output and the UI:
//   raw        – numbers exactly as the source returned them (likes, reach, views…)
//   calculated – deterministic formulas on raw numbers (engagement, engagement rate, medians, lifts)
//   AI         – interpretations, produced elsewhere (recommendations) and labelled as such

export type PerfItem = Pick<
  HistoricalItem,
  "id" | "platform" | "format" | "title" | "topic" | "caption" | "pillar_id" | "content_pillar" | "publication_date" | "actual_publication_date"
  | "likes" | "comments" | "shares" | "saves" | "reach" | "views" | "engagements" | "permalink" | "source" | "pillar_assigned_by"
>;

export const ENGAGEMENT_FORMULA = "likes (reactions) + comments + shares + saves, using only the values the source returned";

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** Calculated engagement: sum of available interaction counts. Null when the item has none of them. */
export function engagementOf(i: Pick<PerfItem, "likes" | "comments" | "shares" | "saves">) {
  const parts = [i.likes, i.comments, i.shares, i.saves].filter((x): x is number => x != null);
  return parts.length ? parts.reduce((s, x) => s + x, 0) : null;
}

/**
 * Reach is usable only when it is at least as large as every single interaction count: one account can't like or
 * save a post without being reached. Meta returns truncated reach for some older posts; those are not rate-ranked.
 */
export function reachIsConsistent(i: Pick<PerfItem, "likes" | "comments" | "shares" | "saves" | "reach">) {
  return Boolean(i.reach) && i.reach! >= Math.max(i.likes ?? 0, i.comments ?? 0, i.shares ?? 0, i.saves ?? 0);
}

/**
 * Per-platform reach filter. Meta keeps reliable reach only for recent posts: older ones come back truncated
 * (Elios Academy Facebook: median reach 3–95 for 2020–2024 vs 2,500+ since 2025), which yields fake rates of 50–200%.
 * Reach is usable when it covers the post's own interactions and is at least 10% of the platform's median reach over
 * its latest 12 months of posts.
 */
export function usableReach<T extends Pick<PerfItem, "likes" | "comments" | "shares" | "saves" | "reach" | "publication_date" | "actual_publication_date">>(list: T[]) {
  const dated = list.filter((i) => i.reach && (i.actual_publication_date ?? i.publication_date));
  const latest = dated.map((i) => (i.actual_publication_date ?? i.publication_date)!).sort().at(-1);
  const from = latest ? new Date(Date.parse(latest) - 365 * 86400000).toISOString().slice(0, 10) : null;
  const recent = from ? dated.filter((i) => (i.actual_publication_date ?? i.publication_date)! >= from).map((i) => i.reach!) : [];
  const floor = recent.length >= 10 ? (median(recent) ?? 0) * 0.1 : 0;
  return (i: T) => reachIsConsistent(i) && i.reach! >= (engagementOf(i) ?? 0) && i.reach! >= floor;
}

/** Calculated engagement rate (% of reach). Null without a consistent reach. */
export function engagementRate(i: Pick<PerfItem, "likes" | "comments" | "shares" | "saves" | "reach">) {
  const e = engagementOf(i);
  return e != null && reachIsConsistent(i) ? (e / i.reach!) * 100 : null;
}

// CTA families, detected in captions (fr/en/ar keywords). A detection is a calculated label, not a claim of intent.
const CTA_PATTERNS: [string, RegExp][] = [
  ["Link / bio", /\b(lien en bio|link in bio|lien dans la bio|clique[zr]? sur le lien|swipe up|sosprof\.net|www\.|https?:\/\/)/i],
  ["Sign up / book", /\b(inscri(s|vez|ption)|r[ée]serve[zr]?|book|sign up|register|essai gratuit|free trial|سجل)/i],
  ["Comment", /\b(commente[zr]?|dis[- ]nous en commentaire|comment below|tell us|réponds?)/i],
  ["Message / DM", /\b(dm|message priv[ée]|envoie[zr]?(-nous)? un message|whatsapp|inbox|contacte[zr]?)/i],
  ["Share / tag", /\b(partage[zr]?|tag(ue[zr]?)?|identifie[zr]?|share|mentionne)/i],
  ["Save", /\b(enregistre[zr]?|save this|sauvegarde[zr]?)/i],
];

export function detectCtas(text: string | null | undefined) {
  const t = text ?? "";
  return CTA_PATTERNS.filter(([, re]) => re.test(t)).map(([label]) => label);
}

export const HOOK_PATTERNS: [string, (h: string) => boolean][] = [
  ["Question", (h) => /\?/.test(h)],
  ["Number / list", (h) => /^\D{0,12}\d+/.test(h)],
  ["Starts with an emoji", (h) => /^\p{Extended_Pictographic}/u.test(h)],
  ["How / why", (h) => /^(comment|pourquoi|how|why|كيف|لماذا)\b/i.test(normalizeText(h))],
  ["Direct address (tu / vous / you)", (h) => /\b(tu|toi|vous|you|your|ton|ta|tes|votre|vos)\b/i.test(normalizeText(h))],
];

type Group = { key: string; label: string; n: number; medianScore: number | null; medianEngagement: number | null; medianRate: number | null; lift: number | null };

function groupStats(items: (PerfItem & { score: number })[], keyOf: (i: PerfItem) => string | null, labelOf: (k: string) => string, baseline: number | null, rateOk: (i: PerfItem) => boolean, minN = 3): Group[] {
  const map = new Map<string, (PerfItem & { score: number })[]>();
  for (const i of items) {
    const k = keyOf(i);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  return [...map.entries()]
    .filter(([, v]) => v.length >= minN)
    .map(([key, v]) => {
      const ms = median(v.map((i) => i.score));
      return {
        key,
        label: labelOf(key),
        n: v.length,
        medianScore: r2(ms),
        medianEngagement: r1(median(v.map((i) => engagementOf(i)).filter((x): x is number => x != null))),
        medianRate: r2(median(v.filter(rateOk).map((i) => engagementRate(i)).filter((x): x is number => x != null))),
        lift: baseline && ms != null ? r2(ms / baseline) : null,
      };
    })
    .sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0));
}

/**
 * Performance per platform. The ranking score is the engagement rate when most posts have reach,
 * otherwise raw engagement. Groups need at least 3 posts; nothing is extrapolated.
 */
export function computePerformance(items: PerfItem[], pillarName: (id: string) => string | undefined) {
  const byPlatform = new Map<Platform, PerfItem[]>();
  for (const i of items) {
    if (!i.platform || engagementOf(i) == null) continue;
    const list = byPlatform.get(i.platform as Platform);
    if (list) list.push(i);
    else byPlatform.set(i.platform as Platform, [i]);
  }

  return [...byPlatform.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([platform, list]) => {
      const reachOk = usableReach(list);
      const withReach = list.filter(reachOk);
      const inconsistentReach = list.filter((i) => i.reach && !reachOk(i)).length;
      const useRate = withReach.length >= list.length * 0.5 && withReach.length >= 3;
      const pool = (useRate ? withReach : list).map((i) => ({ ...i, score: (useRate ? engagementRate(i) : engagementOf(i)) ?? 0 }));
      const baseline = median(pool.map((i) => i.score));
      const date = (i: PerfItem) => i.actual_publication_date ?? i.publication_date;
      const sorted = [...pool].sort((a, b) => b.score - a.score);
      const q75 = pool.length >= 8 ? sorted[Math.floor(pool.length * 0.25)].score : null;

      // Engagement trend by month (median score per month with at least 2 posts)
      const months = new Map<string, number[]>();
      for (const i of pool) {
        const d = date(i);
        if (d) months.set(d.slice(0, 7), [...(months.get(d.slice(0, 7)) ?? []), i.score]);
      }
      const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, n: v.length, median: v.length >= 2 ? r2(median(v)) : null }));

      // Topics: content words used in at least 3 posts
      const topicCounts = new Map<string, Set<string>>();
      for (const i of pool) for (const t of new Set(contentTokens(`${i.title ?? ""} ${i.topic ?? ""} ${captionHook(i.caption) ?? ""}`))) topicCounts.set(t, (topicCounts.get(t) ?? new Set()).add(i.id));

      const hookOf = (i: PerfItem) => captionHook(i.caption) ?? i.title ?? "";
      const titleOf = (i: PerfItem) => i.title ?? i.topic ?? captionHook(i.caption) ?? "(untitled)";
      const now = Date.now();
      return {
        platform,
        label: PLATFORM_LABELS[platform],
        posts: list.length,
        ranked: pool.length,
        inconsistentReach,
        metric: useRate ? ("engagement_rate" as const) : ("engagement" as const),
        baseline: r2(baseline),
        top: sorted.slice(0, 10).map((i) => ({
          id: i.id, title: titleOf(i), date: date(i), format: normalizeFormat(i.format), permalink: i.permalink, score: r2(i.score),
          raw: { likes: i.likes, comments: i.comments, shares: i.shares, saves: i.saves, reach: i.reach, views: i.views },
          engagement: engagementOf(i), rate: reachOk(i) ? r2(engagementRate(i)) : null,
        })),
        bottom: sorted.slice(-5).reverse().map((i) => ({ id: i.id, title: titleOf(i), date: date(i), format: normalizeFormat(i.format), score: r2(i.score) })),
        trend,
        byFormat: groupStats(pool, (i) => normalizeFormat(i.format), (k) => k, baseline, reachOk),
        byPillar: groupStats(pool, (i) => i.pillar_id ?? null, (k) => pillarName(k) ?? "Deleted pillar", baseline, reachOk),
        topics: [...topicCounts.entries()]
          .filter(([, ids]) => ids.size >= 3 && ids.size < pool.length * 0.6)
          .map(([token, ids]) => {
            const v = pool.filter((i) => ids.has(i.id)).map((i) => i.score);
            const m = median(v);
            return { topic: token, n: ids.size, medianScore: r2(m), lift: baseline && m != null ? r2(m / baseline) : null };
          })
          .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
          .slice(0, 12),
        hooks: {
          top: sorted.slice(0, 8).map((i) => ({ id: i.id, hook: hookOf(i), score: r2(i.score) })).filter((h) => h.hook),
          patterns: HOOK_PATTERNS.map(([label, test]) => {
            const v = pool.filter((i) => test(hookOf(i))).map((i) => i.score);
            const m = median(v);
            return { label, n: v.length, medianScore: r2(m), lift: baseline && m != null && v.length >= 3 ? r2(m / baseline) : null };
          }).filter((p) => p.n >= 3),
        },
        ctas: [...CTA_PATTERNS.map(([label]) => label), "No CTA detected"].map((label) => {
          const v = pool.filter((i) => (label === "No CTA detected" ? detectCtas(i.caption).length === 0 : detectCtas(i.caption).includes(label))).map((i) => i.score);
          const m = median(v);
          return { label, n: v.length, medianScore: r2(m), lift: baseline && m != null && v.length >= 3 ? r2(m / baseline) : null };
        }).filter((c) => c.n >= 3),
        // Older top-quartile posts: candidates to refresh or repurpose (calculated, not a prediction)
        refreshCandidates: q75 == null ? [] : sorted
          .filter((i) => i.score >= q75 && date(i) && now - Date.parse(date(i)!) > 180 * 86400000)
          .slice(0, 8)
          .map((i) => ({ id: i.id, title: titleOf(i), date: date(i), format: normalizeFormat(i.format), score: r2(i.score) })),
      };
    });
}

export type PlatformPerformance = ReturnType<typeof computePerformance>[number];
