// Calendar Planner and gap detection (pure, tested). The planner proposes placements for Backlog ideas: it never
// writes anything; the person reviews the preview and saves what they approve.
import { WEEKDAY_LABELS, suggestedTime, type PlatformTiming } from "@/lib/calendar/insights";
import { audienceOf } from "./slots";

export type PlanIdea = { id: string; title: string; score: number | null; pillar_id: string | null; format: string | null; platform: string | null; target_platforms: string[]; target_audience: string | null; priority?: string | null };
export type PlanRequest = {
  from: string; to: string; postsPerWeek: number; platforms: string[];
  /** share of posts per pillar id, in % (optional): the planner fills the most under-served pillar first */
  pillarMix?: Record<string, number>;
  formats?: string[]; audience?: string; maxPerDay?: number;
};
export type Placement = { ideaId: string; title: string; date: string; time: string; platform: string; score: number | null; pillar_id: string | null; reason: string };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

/** Weekdays in preference order: the brand's best days from real timing, then evening-friendly school days. */
function preferredDays(timing: PlatformTiming | undefined) {
  const fromData = (timing?.suggestions ?? []).map((s) => s.weekday);
  return [...new Set([...fromData, 2, 0, 4, 3, 1, 6, 5])];
}

function heuristicTime(platform: string, audience: string | null, fmt: string | null, wd: number) {
  const who = audienceOf(audience);
  if (platform === "linkedin") return "12:30";
  if (who === "parents") return wd === 0 || wd === 6 ? "10:00" : "20:30";
  if (/reel|video|tiktok|short/i.test(fmt ?? "") || platform === "tiktok") return "20:00";
  return wd === 1 || wd === 4 ? "18:00" : "19:30";
}

export function planCalendar(ideas: PlanIdea[], req: PlanRequest, ctx: { timing: PlatformTiming[]; busy: Record<string, number>; today: string }): { placements: Placement[]; notes: string[] } {
  const notes: string[] = [];
  const platforms = req.platforms.length ? req.platforms : ["facebook"];
  const maxPerDay = req.maxPerDay ?? 2;
  const start = req.from > ctx.today ? req.from : addDays(ctx.today, 1);
  const busy = { ...ctx.busy };
  const lead = ctx.timing.find((t) => t.platform === platforms[0]);
  const order = preferredDays(lead);

  // 1. Slots: N days per week, spread over the preferred weekdays, skipping full days
  const slots: string[] = [];
  for (let weekStart = start; weekStart <= req.to; weekStart = addDays(weekStart, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d <= req.to);
    const ranked = [...days].sort((a, b) => order.indexOf(weekday(a)) - order.indexOf(weekday(b)));
    const picked = ranked.filter((d) => (busy[d] ?? 0) < maxPerDay).slice(0, req.postsPerWeek);
    if (picked.length < Math.min(req.postsPerWeek, days.length)) notes.push(`Week of ${weekStart}: only ${picked.length} free day${picked.length === 1 ? "" : "s"} (others already have ${maxPerDay} posts).`);
    slots.push(...picked.sort());
  }

  // 2. Candidates: matching filters, best score (then priority) first
  let pool = ideas.filter((i) => (!req.formats?.length || (i.format && req.formats.includes(i.format)))
    && (!req.audience || (i.target_audience ?? "").toLowerCase().includes(req.audience.toLowerCase()))
    && (!req.pillarMix || !Object.keys(req.pillarMix).length || (i.pillar_id && i.pillar_id in req.pillarMix)));
  pool = pool.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (PRIORITY_RANK[b.priority ?? "medium"] ?? 1) - (PRIORITY_RANK[a.priority ?? "medium"] ?? 1));
  if (pool.length < slots.length) notes.push(`${slots.length} slots but only ${pool.length} matching Backlog idea${pool.length === 1 ? "" : "s"}: add or score more ideas to fill the plan.`);

  // 3. Fill each slot with the best idea of the most under-served pillar, avoiding the same pillar twice in a row
  const mix = req.pillarMix && Object.keys(req.pillarMix).length ? req.pillarMix : null;
  const placed: Record<string, number> = {};
  const placements: Placement[] = [];
  let lastPillar: string | null = null;
  for (const date of slots) {
    if (!pool.length) break;
    let pick = 0;
    if (mix) {
      const total = placements.length + 1;
      const deficit = (p: string | null) => (p && mix[p] != null ? mix[p] / 100 - (placed[p] ?? 0) / total : -1);
      pick = pool.reduce((best, i, k) => (deficit(i.pillar_id) > deficit(pool[best].pillar_id) + 1e-9 ? k : best), 0);
    } else {
      const k = pool.findIndex((i) => !i.pillar_id || i.pillar_id !== lastPillar);
      pick = k >= 0 ? k : 0;
    }
    const idea = pool.splice(pick, 1)[0];
    const platform = (idea.target_platforms?.find((p) => platforms.includes(p)) ?? idea.platform ?? platforms[0])!;
    const wd = weekday(date);
    const t = ctx.timing.find((x) => x.platform === platform);
    const real = suggestedTime(t, wd);
    const time = real ?? heuristicTime(platform, idea.target_audience, idea.format, wd);
    placements.push({
      ideaId: idea.id, title: idea.title, date, time, platform, score: idea.score, pillar_id: idea.pillar_id,
      reason: `${idea.score != null ? `Score ${idea.score}` : "Not scored"}${mix && idea.pillar_id ? " · balances the pillar mix" : ""} · ${WEEKDAY_LABELS[wd]} ${time} ${real ? "from your best-performing slot" : "(heuristic time)"}`,
    });
    placed[idea.pillar_id ?? "none"] = (placed[idea.pillar_id ?? "none"] ?? 0) + 1;
    busy[date] = (busy[date] ?? 0) + 1;
    lastPillar = idea.pillar_id;
  }
  return { placements, notes };
}

// --- Gap detection -------------------------------------------------------------------------------------------

export type CalPost = { id: string; title: string; date: string; time: string | null; platform: string | null; pillar_id: string | null; format: string | null; funnel_stage: string | null; scheduled_at: string | null };
export type Gap = { key: string; kind: "empty" | "overloaded" | "promo_streak" | "pillar_streak" | "conflict" | "unscheduled"; date?: string; message: string };

const isPromo = (p: CalPost) => p.funnel_stage === "conversion" || /promo|offre|offer|annonce|announcement|pub/i.test(p.format ?? "");

export function detectGaps(posts: CalPost[], range: { from: string; to: string; today: string }, opts: { pillarName: (id: string | null) => string; topIdea?: { title: string; score: number | null; slot?: { date: string; time: string } | null } | null; highUnscheduled?: number; maxPerDay?: number }): Gap[] {
  const gaps: Gap[] = [];
  const maxPerDay = opts.maxPerDay ?? 2;
  const byDate = new Map<string, CalPost[]>();
  for (const p of posts) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
  const from = range.from > range.today ? range.from : range.today;
  const empty: string[] = [];
  for (let d = from; d <= range.to; d = addDays(d, 1)) if (!byDate.has(d)) empty.push(d);
  // empty days only matter when the period is thin; list a few, with the best Backlog idea as a suggestion
  if (empty.length) {
    const first = empty[0];
    const idea = opts.topIdea ? ` Consider “${opts.topIdea.title}”${opts.topIdea.slot ? ` (suggested ${opts.topIdea.slot.time})` : ""}.` : "";
    gaps.push({ key: `empty-${first}-${empty.length}`, kind: "empty", date: first, message: `${empty.length} day${empty.length > 1 ? "s" : ""} without content, starting ${WEEKDAY_LABELS[weekday(first)]} ${first}.${idea}` });
  }
  for (const [d, list] of byDate) if (d >= from && list.length > maxPerDay) gaps.push({ key: `over-${d}`, kind: "overloaded", date: d, message: `${WEEKDAY_LABELS[weekday(d)]} ${d} has ${list.length} posts. Consider moving one to a quieter day.` });
  const sorted = [...posts].sort((a, b) => (a.scheduled_at ?? `${a.date}T${a.time ?? "12:00"}`).localeCompare(b.scheduled_at ?? `${b.date}T${b.time ?? "12:00"}`));
  for (let i = 2; i < sorted.length; i++) {
    const trio = sorted.slice(i - 2, i + 1);
    if (trio.every(isPromo)) gaps.push({ key: `promo-${trio[2].id}`, kind: "promo_streak", date: trio[2].date, message: `Three promotional posts in a row (until ${trio[2].date}). Alternate with educational or engagement content.` });
    if (trio[0].pillar_id && trio.every((p) => p.pillar_id === trio[0].pillar_id)) gaps.push({ key: `pillar-${trio[2].id}`, kind: "pillar_streak", date: trio[2].date, message: `Three “${opts.pillarName(trio[0].pillar_id)}” posts in a row (until ${trio[2].date}). Mix in another pillar.` });
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.platform && a.platform === b.platform && a.scheduled_at && b.scheduled_at && Math.abs(Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at)) < 3_600_000) {
      gaps.push({ key: `conflict-${a.id}-${b.id}`, kind: "conflict", date: b.date, message: `“${a.title}” and “${b.title}” go out within an hour on the same platform (${b.date}).` });
    }
  }
  if (opts.highUnscheduled) gaps.push({ key: `unscheduled-${opts.highUnscheduled}`, kind: "unscheduled", message: `${opts.highUnscheduled} high-scoring idea${opts.highUnscheduled > 1 ? "s are" : " is"} still in the Backlog (score 85+).` });
  return gaps.slice(0, 8);
}
