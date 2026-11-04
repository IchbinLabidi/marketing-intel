import { FUNNEL_STAGES, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import type { TFor } from "@/i18n/messages";

// Monthly content plan (the "content mix"): calculated, not generated. Counts follow the strategy's pillar target
// shares and funnel, the month's objective and real format performance when it exists. The user edits it before any
// post is written; slots are then laid out deterministically and the AI only fills them.

export const OBJECTIVES = ["awareness", "engagement", "leads", "sales", "loyalty"] as const;
export type Objective = (typeof OBJECTIVES)[number];
/** English objective labels, used in AI prompts; the UI shows `editorial.objectives.<key>`. */
export const OBJECTIVE_LABELS: Record<Objective, string> = {
  awareness: "Grow awareness", engagement: "Build engagement and community", leads: "Generate leads / sign-ups", sales: "Drive sales / enrolments", loyalty: "Retain and build loyalty",
};

/** Funnel mix used when the strategy gives no percentages (sums to 100). */
export const OBJECTIVE_FUNNEL: Record<Objective, Partial<Record<FunnelStage, number>>> = {
  awareness: { awareness: 45, engagement: 25, trust: 15, acquisition: 10, conversion: 5 },
  engagement: { awareness: 20, engagement: 45, trust: 20, acquisition: 10, conversion: 5 },
  leads: { awareness: 20, engagement: 20, trust: 20, acquisition: 30, conversion: 10 },
  sales: { awareness: 15, engagement: 15, trust: 20, acquisition: 20, conversion: 30 },
  loyalty: { awareness: 10, engagement: 30, trust: 20, conversion: 10, loyalty: 30 },
};

/** Formats per platform with their default share. Website = the project's blog / site (SEO content). */
export const PLATFORM_FORMATS: Partial<Record<Platform, Record<string, number>>> = {
  instagram: { Reel: 40, Carousel: 35, "Image post": 15, Story: 10 },
  facebook: { "Image post": 30, Video: 20, "Discussion post": 20, "Link post": 15, Carousel: 15 },
  blog: { "SEO article": 50, "Educational resource": 20, "FAQ page": 20, "Landing page": 10 },
  tiktok: { Video: 100 },
  youtube: { Video: 70, Short: 30 },
  linkedin: { "Text post": 40, "Document carousel": 30, "Image post": 30 },
};
const formatsOf = (p: Platform) => PLATFORM_FORMATS[p] ?? { "Image post": 100 };

// Display keys of the plan's format names (the English names stay the stored values and feed the AI prompts).
const PLAN_FORMAT_KEYS: Record<string, "reel" | "carousel" | "imagePost" | "story" | "video" | "discussionPost" | "linkPost" | "seoArticle" | "educationalResource" | "faqPage" | "landingPage" | "short" | "textPost" | "documentCarousel"> = {
  Reel: "reel", Carousel: "carousel", "Image post": "imagePost", Story: "story", Video: "video", "Discussion post": "discussionPost", "Link post": "linkPost",
  "SEO article": "seoArticle", "Educational resource": "educationalResource", "FAQ page": "faqPage", "Landing page": "landingPage", Short: "short",
  "Text post": "textPost", "Document carousel": "documentCarousel",
};
/** Translated name of a plan format; other names are shown as written. */
export const planFormatLabel = (t: TFor<"editorial">, format: string) => (PLAN_FORMAT_KEYS[format] ? t(`formats.${PLAN_FORMAT_KEYS[format]}`) : format);

export type PlanPlatform = { platform: Platform; perWeek: number; count: number; bestDays: number[]; timingBasis: "history" | "none" };
export type PlanPillar = { pillar_id: string; name: string; target_share: number | null; share: number; count: number };
export type PlanFunnel = { stage: FunnelStage; share: number; count: number };
export type PlanFormat = { platform: Platform; format: string; share: number; count: number; basis: "history" | "default"; lift: number | null };
export type PlanCampaign = { campaign_id: string; name: string; starts_on: string | null; ends_on: string | null; count: number };
export type PlanDate = { label: string; start: string; end: string; kind: "season" | "campaign" | "custom" };
export type Plan = {
  start: string; end: string; weeks: number; objective: Objective; total: number;
  platforms: PlanPlatform[]; pillars: PlanPillar[]; funnel: PlanFunnel[]; formats: PlanFormat[]; campaigns: PlanCampaign[]; dates: PlanDate[];
  /** max posts the team can produce per week (all platforms); null = not set */
  capacityPerWeek: number | null;
  notes: string[];
};

export const days = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Largest-remainder rounding: integer counts that sum exactly to `total`, proportional to the weights. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((t, w) => t + Math.max(0, w), 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((t, n) => t + n, 0);
  const order = raw.map((r, k) => [r - Math.floor(r), k] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, k] of order) { if (left <= 0) break; out[k]++; left--; }
  return out;
}

/** Percentages written in the strategy's funnel notes ("30% — …"), used when at least 3 stages give one. */
export function strategyFunnelShares(funnel: Record<string, string> | null | undefined): Partial<Record<FunnelStage, number>> | null {
  if (!funnel) return null;
  const out: Partial<Record<FunnelStage, number>> = {};
  for (const s of FUNNEL_STAGES) {
    const m = String(funnel[s] ?? "").match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
    if (m) out[s] = Number(m[1].replace(",", "."));
  }
  return Object.keys(out).length >= 3 ? out : null;
}

export type PlanInput = {
  start: string; end: string; objective: Objective;
  platforms: { platform: Platform; perWeek: number }[];
  pillars: { id: string; name: string; target_share: number | null }[];
  strategyFunnel: Record<string, string> | null;
  campaigns: { id: string; name: string; starts_on: string | null; ends_on: string | null; funnel_focus: FunnelStage | null }[];
  /** median-based lift of each format per platform (from real posts, ≥5 posts per format), if any */
  formatLift: { platform: Platform; format: string; lift: number; n: number }[];
  /** best weekdays per platform from real timing data (0 = Sunday), best first */
  bestDays: Partial<Record<Platform, number[]>>;
  seasons: { label: string; start: string; end: string }[];
  customDates?: PlanDate[];
  capacityPerWeek?: number | null;
};

/** `t` words the plan's notes (shown to the user) in their language. */
export function proposePlan(i: PlanInput, t: TFor<"editorial">): Plan {
  const n = days(i.start, i.end);
  const weeks = Math.round((n / 7) * 10) / 10;
  const notes: string[] = [];
  const platforms: PlanPlatform[] = i.platforms.map((p) => ({
    platform: p.platform, perWeek: p.perWeek, count: Math.max(0, Math.round((p.perWeek * n) / 7)),
    bestDays: i.bestDays[p.platform] ?? [], timingBasis: i.bestDays[p.platform]?.length ? "history" : "none",
  }));
  const total = platforms.reduce((t, p) => t + p.count, 0);

  // Pillars: target shares from the strategy; pillars without one share what is left equally
  const set = i.pillars.filter((p) => p.target_share != null).reduce((t, p) => t + Number(p.target_share), 0);
  const unset = i.pillars.filter((p) => p.target_share == null);
  const shareOf = (p: PlanInput["pillars"][number]) => (p.target_share != null ? Number(p.target_share) : unset.length ? Math.max(0, 100 - set) / unset.length : 0);
  const pillarShares = i.pillars.map(shareOf);
  const pillarCounts = allocate(total, pillarShares.some((s) => s > 0) ? pillarShares : i.pillars.map(() => 1));
  const shareSum = pillarShares.reduce((t, s) => t + s, 0) || 1;
  const pillars = i.pillars.map((p, k) => ({ pillar_id: p.id, name: p.name, target_share: p.target_share, share: Math.round((pillarShares[k] / shareSum) * 1000) / 10, count: pillarCounts[k] }));
  if (!i.pillars.length) notes.push(t("plan.notes.noPillars"));
  else if (unset.length) notes.push(t("plan.notes.unsetShares", { count: unset.length, rest: Math.max(0, 100 - set) }));
  else notes.push(t("plan.notes.pillarShares"));

  // Funnel: strategy percentages when written, else the objective's mix, nudged towards active campaigns' focus
  const fromStrategy = strategyFunnelShares(i.strategyFunnel);
  const base = { ...(fromStrategy ?? OBJECTIVE_FUNNEL[i.objective]) };
  const active = i.campaigns.filter((c) => (!c.starts_on || c.starts_on <= i.end) && (!c.ends_on || c.ends_on >= i.start));
  if (!fromStrategy) for (const c of active) if (c.funnel_focus) base[c.funnel_focus] = (base[c.funnel_focus] ?? 0) + 10;
  const stages = FUNNEL_STAGES.filter((s) => (base[s] ?? 0) > 0);
  const funnelCounts = allocate(total, stages.map((s) => base[s]!));
  const fsum = stages.reduce((t, s) => t + base[s]!, 0) || 1;
  const funnel = stages.map((stage, k) => ({ stage, share: Math.round((base[stage]! / fsum) * 1000) / 10, count: funnelCounts[k] }));
  notes.push(fromStrategy ? t("plan.notes.funnelFromStrategy") : active.some((c) => c.funnel_focus) ? t("plan.notes.funnelFromObjectiveCampaigns", { objective: t(`objectives.${i.objective}`) }) : t("plan.notes.funnelFromObjective", { objective: t(`objectives.${i.objective}`) }));

  // Formats per platform: default mix × measured lift (clamped 0.5–2) when real data exists
  const formats: PlanFormat[] = [];
  for (const p of platforms) {
    const defaults = formatsOf(p.platform);
    const names = Object.keys(defaults);
    const lifts = names.map((f) => i.formatLift.find((x) => x.platform === p.platform && x.format.toLowerCase() === f.toLowerCase() && x.n >= 5)?.lift ?? null);
    const weights = names.map((f, k) => defaults[f] * Math.min(2, Math.max(0.5, lifts[k] ?? 1)));
    const counts = allocate(p.count, weights);
    const wsum = weights.reduce((t, w) => t + w, 0) || 1;
    names.forEach((format, k) => formats.push({ platform: p.platform, format, share: Math.round((weights[k] / wsum) * 1000) / 10, count: counts[k], basis: lifts[k] != null ? "history" : "default", lift: lifts[k] }));
    if (!lifts.some((l) => l != null)) notes.push(t("plan.notes.defaultFormats", { platform: p.platform === "blog" ? t("platforms.blog") : PLATFORM_LABELS[p.platform] }));
  }

  // Campaigns: share of the posts falling in the campaign window (40% of them), at least 1
  const campaigns = active.map((c) => {
    const s = c.starts_on && c.starts_on > i.start ? c.starts_on : i.start;
    const e = c.ends_on && c.ends_on < i.end ? c.ends_on : i.end;
    return { campaign_id: c.id, name: c.name, starts_on: c.starts_on, ends_on: c.ends_on, count: Math.max(1, Math.round(total * (days(s, e) / n) * 0.4)) };
  });

  const dates: PlanDate[] = [
    ...i.seasons.map((s) => ({ label: s.label, start: s.start < i.start ? i.start : s.start, end: s.end > i.end ? i.end : s.end, kind: "season" as const })),
    ...active.filter((c) => c.starts_on && c.starts_on >= i.start).map((c) => ({ label: `${c.name} starts`, start: c.starts_on!, end: c.starts_on!, kind: "campaign" as const })),
    ...(i.customDates ?? []),
  ];
  if (!platforms.some((p) => p.timingBasis === "history")) notes.push(t("plan.notes.noTiming"));
  return { start: i.start, end: i.end, weeks, objective: i.objective, total, platforms, pillars, funnel, formats, campaigns, dates, capacityPerWeek: i.capacityPerWeek ?? null, notes };
}

/** Consistency of an edited plan: every distribution must add up to the total. `t` words the errors. */
export function validatePlan(p: Plan, t: TFor<"editorial">): string[] {
  const errors: string[] = [];
  const total = p.platforms.reduce((n, x) => n + x.count, 0);
  if (!total) errors.push(t("plan.errors.empty"));
  if (total > 200) errors.push(t("plan.errors.tooMany"));
  const sum = (list: { count: number }[]) => list.reduce((n, x) => n + x.count, 0);
  if (p.pillars.length && sum(p.pillars) !== total) errors.push(t("plan.errors.pillars", { sum: sum(p.pillars), total }));
  if (sum(p.funnel) !== total) errors.push(t("plan.errors.funnel", { sum: sum(p.funnel), total }));
  for (const pl of p.platforms) {
    const f = sum(p.formats.filter((x) => x.platform === pl.platform));
    if (f !== pl.count) errors.push(t("plan.errors.formats", { platform: pl.platform, sum: f, count: pl.count }));
  }
  for (const c of p.campaigns) if (c.count > total) errors.push(t("plan.errors.campaign", { name: c.name }));
  if ([...p.platforms, ...p.pillars, ...p.funnel, ...p.formats, ...p.campaigns].some((x) => x.count < 0 || !Number.isInteger(x.count))) errors.push(t("plan.errors.integers"));
  return errors;
}

export type Slot = {
  key: string; date: string; platform: Platform; pillar_id: string | null; funnel_stage: FunnelStage; format: string;
  campaign_id: string | null; occasion: string | null;
};

/** Spreads a multiset so equal values are as far apart as possible (round-robin by remaining count). */
export function spread<T>(counts: { value: T; count: number }[]): T[] {
  const left = counts.map((c) => ({ ...c }));
  const out: T[] = [];
  let last: T | undefined;
  while (left.some((c) => c.count > 0)) {
    const pick = left.filter((c) => c.count > 0).sort((a, b) => b.count - a.count).find((c) => c.value !== last) ?? left.find((c) => c.count > 0)!;
    out.push(pick.value);
    pick.count--;
    last = pick.value;
  }
  return out;
}

/** Dates for `count` posts on one platform: evenly spaced, nudged (±2 days) to the platform's best weekdays. */
export function platformDates(start: string, end: string, count: number, bestDays: number[]): string[] {
  const n = days(start, end);
  const taken = new Set<string>();
  const out: string[] = [];
  const preferred = new Set(bestDays.slice(0, 3));
  for (let k = 0; k < count; k++) {
    const ideal = Math.min(n - 1, Math.floor(((k + 0.5) * n) / count));
    const candidates = [0, 1, -1, 2, -2, 3, -3].map((d) => ideal + d).filter((d) => d >= 0 && d < n).map((d) => addDays(start, d));
    const free = candidates.filter((d) => !taken.has(d));
    const pick = (preferred.size ? free.find((d) => preferred.has(weekdayOf(d))) : undefined) ?? free[0] ?? addDays(start, ideal);
    taken.add(pick);
    out.push(pick);
  }
  return out.sort();
}

/** Lays the plan out as dated slots. Locked posts already fill some slots: pass them to keep the counts exact. */
export function buildSlots(p: Plan, locked: { date: string; platform: Platform; pillar_id: string | null; funnel_stage: FunnelStage | null; format: string | null; campaign_id: string | null }[] = []): Slot[] {
  const minus = <K extends string | null>(list: { key: K; count: number }[], used: (K | null)[]) => list.map((x) => ({ value: x.key, count: Math.max(0, x.count - used.filter((u) => u === x.key).length) }));
  const raw: Omit<Slot, "pillar_id" | "funnel_stage" | "campaign_id" | "key" | "occasion">[] = [];
  for (const pl of p.platforms) {
    const lockedHere = locked.filter((l) => l.platform === pl.platform);
    const need = Math.max(0, pl.count - lockedHere.length);
    const formats = spread(minus(p.formats.filter((f) => f.platform === pl.platform).map((f) => ({ key: f.format, count: f.count })), lockedHere.map((l) => l.format)));
    const dates = platformDates(p.start, p.end, pl.count, pl.bestDays).filter((d) => !lockedHere.some((l) => l.date === d)).slice(0, need);
    dates.forEach((date, k) => raw.push({ date, platform: pl.platform, format: formats[k] ?? Object.keys(formatsOf(pl.platform))[0] }));
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
  const pillars = spread(minus(p.pillars.map((x) => ({ key: x.pillar_id as string | null, count: x.count })), locked.map((l) => l.pillar_id)));
  const funnel = spread(minus(p.funnel.map((x) => ({ key: x.stage as FunnelStage | null, count: x.count })), locked.map((l) => l.funnel_stage)));
  const slots: Slot[] = raw.map((r, k) => ({
    ...r, key: `P${k + 1}`, pillar_id: pillars[k] ?? null, funnel_stage: (funnel[k] ?? "awareness") as FunnelStage, campaign_id: null,
    occasion: p.dates.find((d) => r.date >= d.start && r.date <= d.end)?.label ?? null,
  }));
  // Campaign posts: evenly chosen among the slots inside each campaign window, without double-booking a slot
  for (const c of p.campaigns) {
    const need = Math.max(0, c.count - locked.filter((l) => l.campaign_id === c.campaign_id).length);
    const inside = slots.filter((s) => !s.campaign_id && (!c.starts_on || s.date >= c.starts_on) && (!c.ends_on || s.date <= c.ends_on));
    for (let k = 0; k < Math.min(need, inside.length); k++) inside[Math.floor((k * inside.length) / Math.min(need, inside.length))].campaign_id = c.campaign_id;
  }
  return slots;
}
