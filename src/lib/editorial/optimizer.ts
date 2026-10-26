import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { addDays, days, type Plan } from "./plan";
import { crowded, type RepFlag } from "./repetition";

// Calendar optimizer: deterministic checks of a generated (or edited) calendar against its plan. Each check returns
// ok / warning with the posts concerned, so the user sees exactly what is unbalanced and why.

export type OptItem = {
  id: string; title: string; date: string | null; platform: Platform | null; pillar_id: string | null; funnel_stage: FunnelStage | null;
  format: string | null; campaign_id: string | null; topic?: string | null; hook?: string | null; angle?: string | null; locked?: boolean;
  repetition?: RepFlag[] | null;
};
export type Check = { key: string; label: string; status: "ok" | "warning"; message: string; ids: string[] };

/** Relative production effort of a format (1 = simple image post). */
export function effortOf(format: string | null | undefined) {
  const f = (format ?? "").toLowerCase();
  if (/reel|video|short|live|tiktok/.test(f)) return 3;
  if (/carousel|article|landing|resource|guide|cluster/.test(f)) return 2.5;
  if (/faq|story|stories/.test(f)) return 1.5;
  return 1;
}
export const effortLevel = (format: string | null | undefined): "low" | "medium" | "high" => { const e = effortOf(format); return e >= 3 ? "high" : e >= 2 ? "medium" : "low"; };

const pctDiff = (actual: number, total: number, target: number) => (total ? (actual / total) * 100 - target : 0);

export function optimizeCalendar(items: OptItem[], plan: Plan, pillarName: (id: string) => string, campaignName: (id: string) => string): Check[] {
  const checks: Check[] = [];
  const total = items.length;
  const dated = items.filter((i) => i.date);

  // Pillar balance vs the plan's shares (±10 points)
  if (plan.pillars.length) {
    const off = plan.pillars.map((p) => ({ p, n: items.filter((i) => i.pillar_id === p.pillar_id).length })).map((x) => ({ ...x, diff: pctDiff(x.n, total, total ? (x.p.count / Math.max(1, plan.total)) * 100 : 0) })).filter((x) => Math.abs(x.diff) > 10);
    checks.push({ key: "pillars", label: "Content pillar balance", status: off.length ? "warning" : "ok", ids: [],
      message: off.length ? off.map((x) => `${pillarName(x.p.pillar_id)}: ${x.n} post(s), ${x.diff > 0 ? "+" : ""}${Math.round(x.diff)} points vs plan`).join(" · ") : "Every pillar is within 10 points of its planned share." });
  }
  // Funnel balance
  const funnelOff = plan.funnel.map((f) => ({ f, n: items.filter((i) => i.funnel_stage === f.stage).length })).filter((x) => Math.abs(pctDiff(x.n, total, (x.f.count / Math.max(1, plan.total)) * 100)) > 10);
  checks.push({ key: "funnel", label: "Funnel balance", status: funnelOff.length ? "warning" : "ok", ids: [],
    message: funnelOff.length ? funnelOff.map((x) => `${FUNNEL_LABELS[x.f.stage]}: ${x.n} vs ${x.f.count} planned`).join(" · ") : "Funnel stages match the plan." });
  // Platform distribution
  const platOff = plan.platforms.map((p) => ({ p, n: items.filter((i) => i.platform === p.platform).length })).filter((x) => x.n !== x.p.count);
  const unplanned = items.filter((i) => i.platform && !plan.platforms.some((p) => p.platform === i.platform));
  checks.push({ key: "platforms", label: "Platform distribution", status: platOff.length || unplanned.length ? "warning" : "ok", ids: unplanned.map((i) => i.id),
    message: platOff.length || unplanned.length ? [...platOff.map((x) => `${PLATFORM_LABELS[x.p.platform]}: ${x.n} vs ${x.p.count} planned`), unplanned.length ? `${unplanned.length} post(s) on platforms outside the plan` : ""].filter(Boolean).join(" · ") : "Posts per platform match the plan." });

  // Publishing frequency: per platform and week, and two posts the same day on one platform
  const weekOf = (d: string) => Math.floor(days(plan.start, d) / 7);
  const freq: string[] = [];
  const sameDay: string[] = [];
  for (const p of plan.platforms) {
    const mine = dated.filter((i) => i.platform === p.platform);
    const weeks = new Map<number, number>();
    for (const i of mine) weeks.set(weekOf(i.date!), (weeks.get(weekOf(i.date!)) ?? 0) + 1);
    for (const [w, n] of weeks) if (n > p.perWeek + 1) freq.push(`${PLATFORM_LABELS[p.platform]} week of ${addDays(plan.start, w * 7)}: ${n} posts (plan ${p.perWeek}/week)`);
    const byDay = new Map<string, string[]>();
    for (const i of mine) byDay.set(i.date!, [...(byDay.get(i.date!) ?? []), i.id]);
    for (const [d, ids] of byDay) if (ids.length > 1) { sameDay.push(...ids); freq.push(`${PLATFORM_LABELS[p.platform]}: ${ids.length} posts on ${d}`); }
  }
  checks.push({ key: "frequency", label: "Publishing frequency", status: freq.length ? "warning" : "ok", ids: sameDay, message: freq.length ? freq.slice(0, 6).join(" · ") : "Frequency per platform and week follows the plan." });

  // Campaign coverage
  const camp = plan.campaigns.map((c) => ({ c, n: items.filter((i) => i.campaign_id === c.campaign_id).length })).filter((x) => x.n < x.c.count);
  if (plan.campaigns.length) checks.push({ key: "campaigns", label: "Campaign coverage", status: camp.length ? "warning" : "ok", ids: [],
    message: camp.length ? camp.map((x) => `${campaignName(x.c.campaign_id)}: ${x.n} of ${x.c.count} planned posts`).join(" · ") : "Every active campaign has its planned posts." });

  // Repetition (flags written by the repetition check)
  const repeated = items.filter((i) => i.repetition?.length);
  checks.push({ key: "repetition", label: "Repetition", status: repeated.length ? "warning" : "ok", ids: repeated.map((i) => i.id),
    message: repeated.length ? `${repeated.length} post(s) repeat earlier or planned content (same purpose or angle).` : "No repeated idea found (recurring topics have different angles)." });

  // Important dates without a post
  const missed = plan.dates.filter((d) => !dated.some((i) => i.date! >= d.start && i.date! <= d.end));
  if (plan.dates.length) checks.push({ key: "dates", label: "Important dates", status: missed.length ? "warning" : "ok", ids: [],
    message: missed.length ? `No post during: ${missed.map((d) => d.label).join(", ")}` : "Every important date or season has posts." });

  // Production workload per week (effort points; capacity in posts per week when set)
  const load = new Map<number, { posts: number; effort: number }>();
  for (const i of dated) { const w = weekOf(i.date!); const l = load.get(w) ?? { posts: 0, effort: 0 }; l.posts++; l.effort += effortOf(i.format); load.set(w, l); }
  const avg = [...load.values()].reduce((t, l) => t + l.effort, 0) / Math.max(1, load.size);
  const heavy = [...load.entries()].filter(([, l]) => (plan.capacityPerWeek != null && l.posts > plan.capacityPerWeek) || (load.size > 1 && l.effort > avg * 1.5));
  checks.push({ key: "workload", label: "Production workload", status: heavy.length ? "warning" : "ok", ids: [],
    message: heavy.length ? heavy.map(([w, l]) => `Week of ${addDays(plan.start, w * 7)}: ${l.posts} posts, effort ${l.effort} pts${plan.capacityPerWeek != null && l.posts > plan.capacityPerWeek ? ` (capacity ${plan.capacityPerWeek}/week)` : " (≥1.5× the average week)"}`).join(" · ") : `Workload is even across weeks (about ${Math.round(avg * 10) / 10} effort points per week; reel/video = 3, carousel/article = 2.5, image = 1).` });

  // Spacing between similar posts on the same platform
  const close = crowded(items.map((i) => ({ id: i.id, date: i.date, platform: i.platform, title: i.title, topic: i.topic, hook: i.hook, angle: i.angle })));
  checks.push({ key: "spacing", label: "Spacing of similar posts", status: close.length ? "warning" : "ok", ids: [...new Set(close.flatMap((c) => [c.a, c.b]))],
    message: close.length ? `${close.length} pair(s) of similar posts less than 5 days apart on the same platform.` : "Similar posts are at least 5 days apart." });
  return checks;
}
