import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { engagementOf, type PerfItem } from "@/lib/history/performance";
import { utcToZoned } from "./time";

// Best publication days and hours, from posts whose exact publication time and metrics came from the source.
// Everything here is calculated from raw metrics; buckets need a minimum number of posts to be shown.

export type TimingItem = Pick<PerfItem, "platform" | "likes" | "comments" | "shares" | "saves" | "reach"> & { published_at: string | null };

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** 3-hour windows keep enough posts per bucket to be meaningful. */
export const HOUR_WINDOWS = [6, 9, 12, 15, 18, 21] as const;
const windowOf = (hour: number) => [...HOUR_WINDOWS].reverse().find((w) => hour >= w) ?? null;
export const windowLabel = (w: number) => `${String(w).padStart(2, "0")}:00–${String((w + 3) % 24).padStart(2, "0")}:00`;

export type Bucket = { key: string; label: string; n: number; median: number | null; lift: number | null };

export function bestPublicationTimes(items: TimingItem[], tz: string, minN = 5) {
  const byPlatform = new Map<Platform, TimingItem[]>();
  for (const i of items) {
    if (!i.platform || !i.published_at || Number.isNaN(Date.parse(i.published_at)) || engagementOf(i) == null) continue;
    byPlatform.set(i.platform as Platform, [...(byPlatform.get(i.platform as Platform) ?? []), i]);
  }
  return [...byPlatform.entries()]
    .filter(([, list]) => list.length >= minN * 2)
    .map(([platform, list]) => {
      // Timing is ranked on interactions per post, not engagement rate: posts in some windows reach far fewer people
      // (e.g. Facebook evenings: median reach ~400 vs ~2,000 by day), which inflates their rate while delivering fewer
      // interactions. Interactions also don't depend on Meta's sometimes-truncated reach.
      const pool = list.map((i) => ({ ...utcToZoned(i.published_at!, tz), score: engagementOf(i) ?? 0 }));
      const baseline = median(pool.map((p) => p.score));
      const bucket = (keyOf: (p: (typeof pool)[number]) => number | null, label: (k: number) => string): Bucket[] => {
        const map = new Map<number, number[]>();
        for (const p of pool) {
          const k = keyOf(p);
          if (k != null) map.set(k, [...(map.get(k) ?? []), p.score]);
        }
        return [...map.entries()]
          .map(([k, v]) => {
            const m = median(v);
            return { key: String(k), label: label(k), n: v.length, median: r2(m), lift: v.length >= minN && baseline && m != null ? r2(m / baseline) : null };
          })
          .sort((a, b) => Number(a.key) - Number(b.key));
      };
      const weekdays = bucket((p) => p.weekday, (k) => WEEKDAY_LABELS[k]);
      const hours = bucket((p) => windowOf(p.hour), windowLabel);
      const slots = (() => {
        const map = new Map<string, number[]>();
        for (const p of pool) {
          const w = windowOf(p.hour);
          if (w == null) continue;
          const k = `${p.weekday}-${w}`;
          map.set(k, [...(map.get(k) ?? []), p.score]);
        }
        // a slot must hold at least 1% of the platform's posts (and `minN`), so a handful of outliers can't lead
        const slotMin = Math.max(minN, Math.round(pool.length * 0.01));
        return [...map.entries()]
          .filter(([, v]) => v.length >= slotMin)
          .map(([k, v]) => {
            const [wd, w] = k.split("-").map(Number);
            const m = median(v);
            return { weekday: wd, window: w, label: `${WEEKDAY_LABELS[wd]} ${windowLabel(w)}`, n: v.length, median: r2(m), lift: baseline && m != null ? r2(m / baseline) : null };
          })
          .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
      })();
      return {
        platform,
        label: PLATFORM_LABELS[platform],
        posts: pool.length,
        metric: "engagement" as const,
        baseline: r2(baseline),
        weekdays,
        hours,
        /** Best weekday × 3-hour windows with at least `minN` posts: the suggested publication times. */
        suggestions: slots.filter((s) => (s.lift ?? 0) > 1).slice(0, 3),
      };
    });
}

export type PlatformTiming = ReturnType<typeof bestPublicationTimes>[number];

/** Suggested local time for a platform on a given weekday: start of its best window, if the data supports one. */
export function suggestedTime(timing: PlatformTiming | undefined, weekday: number) {
  const day = timing?.suggestions.find((s) => s.weekday === weekday) ?? null;
  return day ? `${String(day.window).padStart(2, "0")}:00` : null;
}

// --- Scheduling conflicts --------------------------------------------------------------------------------
export type Slot = { id: string; platform: string | null; scheduled_at: string | null; title: string };

/** Posts on the same platform scheduled within `windowMinutes` of the candidate (excluding itself). */
export function findConflicts(items: Slot[], candidate: Slot, windowMinutes = 60) {
  if (!candidate.scheduled_at || !candidate.platform) return [];
  const t = Date.parse(candidate.scheduled_at);
  return items.filter(
    (i) => i.id !== candidate.id && i.platform === candidate.platform && i.scheduled_at && Math.abs(Date.parse(i.scheduled_at) - t) < windowMinutes * 60000,
  );
}
