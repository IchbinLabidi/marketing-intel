import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInZone, addDays } from "@/lib/calendar/time";
import { FUNNEL_LABELS, FUNNEL_STAGES, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import {
  filterItems, funnelTargets, insights, localDate, overview, parseStageEvents, previousPeriod, production, social, strategyBalance, teamWorkload, daysBetween,
  type AnalyticsItem, type AnalyticsTask, type Filters, type Period, type PerfRow,
} from "@/lib/analytics/compute";
import { STAGE_LABELS, type ProductionStage } from "@/lib/production/model";
import { getProjectContext } from "./projects";
import { getStrategyBundle } from "./strategy";
import { listChannels } from "./projects";
import { getMetaConnection } from "./meta";
import { assignablePeople, getPermissions, isMissingTeamSchema } from "./team";
import { requireUser } from "./session";

const ITEM_COLUMNS = "id, title, status, production_stage, platform, format, pillar_id, funnel_stage, campaign_id, assignee_id, created_at, scheduled_date, published_at, due_date, approved_at";
const PERF_COLUMNS = "id, title, platform, format, pillar_id, campaign_id, permalink, publication_date, actual_publication_date, reach, impressions, views, video_views, clicks, likes, comments, shares, saves, conversions, leads, source";
const PAGE = 1000;

async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the shared filters from the URL. Invalid values fall back to the defaults (last 30 days). */
export function parseAnalyticsParams(sp: Record<string, string | string[] | undefined>, today: string) {
  let from = one(sp.from), to = one(sp.to);
  const preset = one(sp.range) || (from || to ? "custom" : "30d");
  const presets: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  if (presets[preset]) { to = today; from = addDays(today, -(presets[preset] - 1)); }
  else if (preset === "month") { from = `${today.slice(0, 8)}01`; to = today; }
  else if (preset === "quarter") { const m = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1; from = `${today.slice(0, 4)}-${String(m).padStart(2, "0")}-01`; to = today; }
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to || daysBetween(from, to) > 730) { from = addDays(today, -29); to = today; }
  const period: Period = { from, to };
  const compare = one(sp.compare) !== "none";
  const filters: Filters = {
    pillar: one(sp.pillar), funnel: one(sp.funnel), platform: one(sp.platform), format: one(sp.format),
    campaign: one(sp.campaign), status: one(sp.status), assignee: one(sp.assignee),
  };
  return { period, preset: presets[preset] || preset === "month" || preset === "quarter" ? preset : "custom", compare, filters };
}

export type AnalyticsParams = ReturnType<typeof parseAnalyticsParams>;

/**
 * Loads everything the analytics page needs in one pass. Rows come through row-level security, so a user only
 * ever counts content, tasks and performance data they are allowed to read. The team section is returned only
 * to people who manage assignments; everyone else gets their own workload.
 */
export async function loadAnalytics(projectId: string, sp: Record<string, string | string[] | undefined>) {
  const user = await requireUser();
  const { project } = await getProjectContext(projectId);
  const tz = project.timezone || "UTC";
  const today = todayInZone(tz);
  const params = parseAnalyticsParams(sp, today);
  const perms = await getPermissions(project.workspace_id);
  const canSeeTeam = perms.has("content.assign") || perms.has("team.manage");
  const canSeeSocial = perms.has("intelligence.view");
  const canExport = perms.has("content.export");
  const db = await createClient();

  const [items, activity, tasksRes, bundle, channels, people, meta, perf] = await Promise.all([
    all<AnalyticsItem>((a, b) => db.from("content_items").select(ITEM_COLUMNS).eq("project_id", projectId).order("created_at").order("id").range(a, b)),
    all<{ content_item_id: string; body: string; created_at: string }>((a, b) => db.from("content_activity").select("content_item_id, body, created_at").eq("project_id", projectId).eq("kind", "stage").order("created_at").order("id").range(a, b)),
    all<AnalyticsTask>((a, b) => db.from("content_assignments").select("id, content_item_id, user_id, task_type, status, due_date, created_at, updated_at").eq("project_id", projectId).order("created_at").order("id").range(a, b))
      .catch((e) => { if (isMissingTeamSchema(e)) return [] as AnalyticsTask[]; throw e; }),
    getStrategyBundle(projectId),
    listChannels(projectId),
    assignablePeople(project.workspace_id),
    canSeeSocial ? getMetaConnection(projectId) : Promise.resolve(null),
    canSeeSocial
      ? all<PerfRow & { publication_date: string | null; actual_publication_date: string | null }>((a, b) => db.from("historical_content_items").select(PERF_COLUMNS).eq("project_id", projectId).order("id").range(a, b))
      : Promise.resolve([]),
  ]);

  const prevPeriod = previousPeriod(params.period);
  const events = parseStageEvents(activity);
  const tasks = tasksRes;
  const filtered = filterItems(items, tasks, params.filters);
  const nowIso = new Date().toISOString();
  const periodDays = daysBetween(params.period.from, params.period.to) + 1;

  const pillarNames = new Map(bundle.pillars.map((p) => [p.id, p.name]));
  // Strategy targets describe the whole plan, so they are compared only on an unfiltered selection
  // (a platform filter still allows that platform's posting target).
  const subset = Object.entries(params.filters).some(([k, v]) => v && k !== "platform");
  const targetsOff = subset || Boolean(params.filters.platform);
  const balanceOpts = {
    pillars: targetsOff ? bundle.pillars.map((p) => ({ ...p, target_share: null })) : bundle.pillars,
    funnel: FUNNEL_STAGES.map((s) => ({ stage: s, label: FUNNEL_LABELS[s] })),
    funnelTargets: targetsOff ? new Map<string, number>() : funnelTargets(bundle.strategy?.funnel as Record<string, unknown> | undefined),
    platforms: channels.filter((c) => c.is_active && (!params.filters.platform || c.platform === params.filters.platform)).map((c) => ({ platform: c.platform, label: PLATFORM_LABELS[c.platform as Platform] ?? c.platform, postsPerWeek: subset ? null : c.target_posts_per_week })),
    periodDays,
  };
  const plannedNow = filtered.filter((i) => i.scheduled_date && i.scheduled_date >= params.period.from && i.scheduled_date <= params.period.to);
  const publishedNow = filtered.filter((i) => i.status === "published" && (localDate(i.published_at, tz) ?? "") >= params.period.from && (localDate(i.published_at, tz) ?? "") <= params.period.to);
  const balance = strategyBalance(plannedNow, publishedNow, balanceOpts);

  const ov = overview(filtered, tasks, params.period, today, tz);
  const ovPrev = overview(filtered, tasks, prevPeriod, today, tz);
  const prod = production(filtered, events, params.period, today, tz, nowIso);
  const prodPrev = production(filtered, events, prevPeriod, today, tz, nowIso);

  const peopleRows = people.map((p) => ({ user_id: p.user_id, name: p.name || "Unnamed member", roleName: p.roleName }));
  const team = canSeeTeam ? teamWorkload(tasks, filtered, peopleRows, params.period, today, tz) : null;
  const myWork = teamWorkload(tasks.filter((t) => t.user_id === user.id), filtered, peopleRows.filter((p) => p.user_id === user.id), params.period, today, tz)[0] ?? null;

  // Social performance: imported/synced posts, filtered by the dimensions they carry.
  const f = params.filters;
  const perfRows: PerfRow[] = perf
    .map((r) => ({ ...r, date: r.actual_publication_date ?? r.publication_date }))
    .filter((r) => (!f.platform || r.platform === f.platform) && (!f.pillar || (f.pillar === "none" ? !r.pillar_id : r.pillar_id === f.pillar)) && (!f.campaign || r.campaign_id === f.campaign));
  const socialNow = canSeeSocial ? social(perfRows, params.period) : null;
  const socialPrev = canSeeSocial ? social(perfRows, prevPeriod) : null;
  const socialIgnoredFilters = ["funnel", "format", "status", "assignee"].filter((k) => f[k as keyof Filters]);

  const base = `/p/${projectId}`;
  const found = insights({
    period: params.period, balance, overview: ov, production: prod, team,
    social: socialNow && socialPrev ? { now: socialNow, prev: socialPrev } : null,
    links: { strategy: `${base}/strategy`, production: `${base}/production`, calendar: `${base}/calendar?view=list`, team: "/team", history: `${base}/history` },
    stageLabel: (s) => STAGE_LABELS[s as ProductionStage] ?? s,
  });

  return {
    project, tz, today, params, prevPeriod, nowIso,
    access: { canSeeTeam, canSeeSocial, canExport, canSeeAllContent: perms.has("content.view_all") },
    options: {
      pillars: bundle.pillars.map((p) => ({ id: p.id, name: p.name })),
      campaigns: bundle.campaigns.map((c) => ({ id: c.id, name: c.name })),
      platforms: [...new Set([...channels.map((c) => c.platform as string), ...items.map((i) => i.platform).filter((x): x is string => Boolean(x))])],
      people: canSeeTeam ? peopleRows : peopleRows.filter((p) => p.user_id === user.id),
    },
    counts: { allItems: items.length, filteredItems: filtered.length, tasks: tasks.length, stageEvents: events.length, perfRows: perf.length },
    overview: ov, overviewPrev: params.compare ? ovPrev : null,
    balance, targetsOff, platformTargetsOff: subset, hasPillarTargets: bundle.pillars.some((p) => p.target_share != null), hasFunnelTargets: funnelTargets(bundle.strategy?.funnel as Record<string, unknown> | undefined).size > 0,
    hasChannelTargets: channels.some((c) => c.is_active && c.target_posts_per_week != null),
    production: prod, productionPrev: params.compare ? prodPrev : null,
    team, myWork,
    social: socialNow, socialPrev: params.compare ? socialPrev : null, socialIgnoredFilters, meta,
    insights: found,
    pillarNames: Object.fromEntries(pillarNames),
    campaignNames: Object.fromEntries(bundle.campaigns.map((c) => [c.id, c.name])),
    peopleNames: Object.fromEntries(peopleRows.map((p) => [p.user_id, p.name])),
    filtered, plannedNow,
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof loadAnalytics>>;
