import { normalizeFormat } from "@/lib/history/parse";
import { detectCtas, HOOK_PATTERNS } from "@/lib/history/performance";
import { contentTokens } from "@/lib/history/text";
import { captionHook } from "@/lib/meta/normalize";
import { utcToZoned } from "@/lib/calendar/time";
import { WEEKDAY_LABELS } from "@/lib/calendar/insights";

// Deterministic analytics on collected posts, used identically for competitors and for our own brand.
// Three layers stay apart: public (as returned by the platform), calculated (formulas below), unavailable (null).
//   engagement            = likes + comments + shares + saves, using only the values the platform returned
//   rate per follower     = engagement ÷ followers at collection × 100 (only when the follower count is known)
//   lift                  = engagement ÷ the median engagement of the same account (its own baseline)
// Lift is the normalised measure: a 500k-follower account and a 5k-follower account are each compared to themselves.

export type AnalysisPost = {
  id: string;
  account: string; // channel id (competitor profile) or "own:<platform>"
  platform: string | null;
  published_at: string | null;
  format: string | null;
  caption: string | null;
  hashtags?: string[];
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  followers: number | null;
  url?: string | null;
  thumbnail_url?: string | null;
};

export const COMPETITOR_ENGAGEMENT_FORMULA = "likes + comments + shares + saves, using only the values the platform returned";

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export function engagementOfPost(p: Pick<AnalysisPost, "likes" | "comments" | "shares" | "saves">) {
  const parts = [p.likes, p.comments, p.shares, p.saves].filter((x): x is number => x != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export type Group = { key: string; label: string; n: number; share: number; medianEngagement: number | null; medianLift: number | null; medianRate: number | null };

/** `ignore`: brand names whose words must not count as topics (every brand mentions itself). */
export function summarize(posts: AnalysisPost[], opts: { tz: string; periodDays: number; minGroup?: number; ignore?: string[] }) {
  const minGroup = opts.minGroup ?? 3;
  const ignored = new Set((opts.ignore ?? []).flatMap((n) => contentTokens(n)));
  const eng = new Map(posts.map((p) => [p.id, engagementOfPost(p)]));
  // baseline per account
  const byAccount = new Map<string, number[]>();
  for (const p of posts) {
    const e = eng.get(p.id);
    if (e != null) byAccount.set(p.account, [...(byAccount.get(p.account) ?? []), e]);
  }
  const baseline = new Map([...byAccount].map(([k, v]) => [k, v.length >= 5 ? median(v) : null]));
  const liftOf = (p: AnalysisPost) => {
    const e = eng.get(p.id);
    const b = baseline.get(p.account);
    return e != null && b ? e / b : null;
  };
  const rateOf = (p: AnalysisPost) => {
    const e = eng.get(p.id);
    return e != null && p.followers ? (e / p.followers) * 100 : null;
  };

  const group = (keyOf: (p: AnalysisPost) => string[] | string | null, label: (k: string) => string = (k) => k): Group[] => {
    const map = new Map<string, AnalysisPost[]>();
    for (const p of posts) {
      const ks = keyOf(p);
      for (const k of Array.isArray(ks) ? ks : ks ? [ks] : []) map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map]
      .filter(([, list]) => list.length >= minGroup)
      .map(([key, list]) => ({
        key, label: label(key), n: list.length, share: Math.round((list.length / Math.max(1, posts.length)) * 1000) / 10,
        medianEngagement: r2(median(list.map((p) => eng.get(p.id)).filter((x): x is number => x != null))),
        medianLift: r2(median(list.map(liftOf).filter((x): x is number => x != null))),
        medianRate: r2(median(list.map(rateOf).filter((x): x is number => x != null))),
      }))
      .sort((a, b) => b.n - a.n);
  };

  const dated = posts.filter((p) => p.published_at && !Number.isNaN(Date.parse(p.published_at)));
  const times = dated.map((p) => utcToZoned(new Date(p.published_at!).toISOString(), opts.tz));
  const firstDate = dated.map((p) => p.published_at!).sort()[0] ?? null;
  const spanDays = firstDate ? Math.max(7, Math.min(opts.periodDays, (Date.now() - Date.parse(firstDate)) / 86400_000)) : opts.periodDays;
  const hookOf = (p: AnalysisPost) => captionHook(p.caption) ?? "";

  const metrics = (["likes", "comments", "shares", "saves", "views"] as const).map((m) => ({ metric: m, posts: posts.filter((p) => p[m] != null).length }));
  const ranked = posts.map((p) => ({ p, lift: liftOf(p), engagement: eng.get(p.id) ?? null, rate: rateOf(p) })).filter((x) => x.engagement != null);

  return {
    posts: posts.length,
    perWeek: r2(posts.length / (spanDays / 7)),
    firstDate,
    lastDate: dated.map((p) => p.published_at!).sort().at(-1) ?? null,
    metrics, // public metric coverage: how many posts carry each metric
    byPlatform: group((p) => p.platform),
    byFormat: group((p) => normalizeFormat(p.format)),
    byWeekday: group((p) => (p.published_at ? String(utcToZoned(new Date(p.published_at).toISOString(), opts.tz).weekday) : null), (k) => WEEKDAY_LABELS[Number(k)]),
    byHour: group((p) => (p.published_at ? String(Math.floor(utcToZoned(new Date(p.published_at).toISOString(), opts.tz).hour / 3) * 3) : null), (k) => `${k.padStart(2, "0")}:00–${String((Number(k) + 3) % 24).padStart(2, "0")}:00`),
    topics: group((p) => [...new Set(contentTokens(hookOf(p) || (p.caption ?? "").slice(0, 200)))].filter((t) => !ignored.has(t))).slice(0, 25),
    hashtags: group((p) => p.hashtags ?? []).slice(0, 25),
    hooks: HOOK_PATTERNS.map(([label, test]) => {
      const list = posts.filter((p) => test(hookOf(p)));
      return { label, n: list.length, medianLift: r2(median(list.map(liftOf).filter((x): x is number => x != null))) };
    }).filter((h) => h.n >= minGroup),
    ctas: group((p) => { const c = detectCtas(p.caption); return c.length ? c : ["No CTA detected"]; }),
    best: ranked.filter((x) => x.lift != null).sort((a, b) => b.lift! - a.lift!).slice(0, 10).map((x) => ({ id: x.p.id, account: x.p.account, lift: r2(x.lift), engagement: x.engagement, rate: r2(x.rate), url: x.p.url ?? null, hook: hookOf(x.p).slice(0, 140), format: normalizeFormat(x.p.format), platform: x.p.platform, published_at: x.p.published_at, thumbnail_url: x.p.thumbnail_url ?? null })),
    /** posts at 2× or more their account's median, accounts with at least 10 posts */
    outliers: ranked.filter((x) => x.lift != null && x.lift >= 2 && (byAccount.get(x.p.account)?.length ?? 0) >= 10).length,
    timesCovered: times.length,
  };
}

export type Summary = ReturnType<typeof summarize>;

/** Topic overlap between two summaries: what one covers that the other doesn't (by content word, ≥ minGroup posts). */
export function topicGaps(theirs: Summary, ours: Summary) {
  const ourKeys = new Set(ours.topics.map((t) => t.key));
  const theirKeys = new Set(theirs.topics.map((t) => t.key));
  return {
    theyCoverWeDont: theirs.topics.filter((t) => !ourKeys.has(t.key)).slice(0, 12),
    weCoverTheyDont: ours.topics.filter((t) => !theirKeys.has(t.key)).slice(0, 12),
  };
}
