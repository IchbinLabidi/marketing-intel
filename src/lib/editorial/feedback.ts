import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { engagementRate, usableReach } from "@/lib/history/performance";
import type { MetricValues } from "@/types/domain";

// Feedback loop: a published post is judged on the KPI of its objective (not on likes), against the same KPI's
// median on the same platform in the account's own history. Results feed the next plan and prompts as learnings.

export type Kpi = "reach" | "engagement_rate" | "saves_shares" | "clicks" | "conversions" | "comments_shares";
export const KPI_LABELS: Record<Kpi, string> = {
  reach: "Reach (or views)", engagement_rate: "Engagement rate", saves_shares: "Saves + shares", clicks: "Link clicks", conversions: "Conversions / leads", comments_shares: "Comments + shares",
};
/** Which KPI judges a post, from its funnel stage. */
export const STAGE_KPI: Record<FunnelStage, Kpi> = {
  awareness: "reach", engagement: "engagement_rate", trust: "saves_shares", acquisition: "clicks", conversion: "conversions", loyalty: "comments_shares",
};

type M = MetricValues & { publication_date?: string | null; actual_publication_date?: string | null };
const sumOf = (m: M, keys: (keyof MetricValues)[]) => (keys.some((k) => m[k] != null) ? keys.reduce((t, k) => t + Number(m[k] ?? 0), 0) : null);

export function kpiValue(kpi: Kpi, m: M, reachOk = true): number | null {
  switch (kpi) {
    case "reach": return m.reach ?? m.views ?? m.impressions ?? null;
    case "engagement_rate": return reachOk ? engagementRate({ likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, saves: m.saves ?? null, reach: m.reach ?? null }) : null;
    case "saves_shares": return sumOf(m, ["saves", "shares"]);
    case "clicks": return m.clicks ?? null;
    case "conversions": return sumOf(m, ["conversions", "leads", "subscriptions"]);
    case "comments_shares": return sumOf(m, ["comments", "shares"]);
  }
}

const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

export type PostResult = {
  id: string; title: string; platform: Platform; format: string | null; pillar_id: string | null; funnel_stage: FunnelStage;
  kpi: Kpi; value: number | null; baseline: number | null; ratio: number | null; n: number;
  verdict: "above" | "in_line" | "below" | "no_data";
};

/**
 * Each published post vs the median of the same KPI on the same platform (own history, ≥5 posts with that KPI).
 * Ratio ≥ 1.2 above, ≤ 0.8 below. No metric or no baseline → "no_data" (never guessed).
 */
export function evaluatePublished(
  posts: { id: string; title: string; platform: Platform; format: string | null; pillar_id: string | null; funnel_stage: FunnelStage | null; metrics: M | null }[],
  history: (M & { id: string; platform: Platform | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null; reach?: number | null })[],
): PostResult[] {
  return posts.map((p) => {
    const stage = p.funnel_stage ?? "engagement";
    const kpi = STAGE_KPI[stage];
    const pool = history.filter((h) => h.platform === p.platform).map((h) => ({
      ...h, likes: h.likes ?? null, comments: h.comments ?? null, shares: h.shares ?? null, saves: h.saves ?? null, reach: h.reach ?? null,
      publication_date: h.publication_date ?? null, actual_publication_date: h.actual_publication_date ?? null,
    }));
    // engagement rate only where reach is consistent (same rule as Content history)
    const reachOk = usableReach(pool);
    const values = pool.map((h) => kpiValue(kpi, h, kpi !== "engagement_rate" || reachOk(h))).filter((v): v is number => v != null);
    const baseline = values.length >= 5 ? median(values) : null;
    const value = p.metrics ? kpiValue(kpi, p.metrics) : null;
    const ratio = value != null && baseline ? Math.round((value / baseline) * 100) / 100 : null;
    return { id: p.id, title: p.title, platform: p.platform, format: p.format, pillar_id: p.pillar_id, funnel_stage: stage, kpi, value, baseline, ratio, n: values.length,
      verdict: ratio == null ? "no_data" : ratio >= 1.2 ? "above" : ratio <= 0.8 ? "below" : "in_line" };
  });
}

export type Learning = { key: string; statement: string; n: number; ratio: number; direction: "more" | "less" | "keep"; platform: Platform; format: string | null; ref_ids: string[] };

/** Groups of ≥2 evaluated posts (platform × format × objective) with a consistent result become learnings. */
export function learningsFrom(results: PostResult[]): Learning[] {
  const groups = new Map<string, PostResult[]>();
  for (const r of results.filter((x) => x.ratio != null)) {
    const k = `${r.platform}|${(r.format ?? "?").toLowerCase()}|${r.funnel_stage}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Learning[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ratio = Math.round(median(list.map((r) => r.ratio!))! * 100) / 100;
    const r = list[0];
    const direction = ratio >= 1.2 ? "more" : ratio <= 0.8 ? "less" : "keep";
    out.push({
      key, n: list.length, ratio, direction, platform: r.platform, format: r.format, ref_ids: list.map((x) => x.id),
      statement: `${PLATFORM_LABELS[r.platform]} ${r.format ?? "posts"} with a ${FUNNEL_LABELS[r.funnel_stage].toLowerCase()} objective: ${KPI_LABELS[r.kpi].toLowerCase()} ×${ratio} the platform median over ${list.length} published calendar posts${direction === "more" ? " (plan more, with new angles)" : direction === "less" ? " (rethink the format or angle)" : ""}.`,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}
