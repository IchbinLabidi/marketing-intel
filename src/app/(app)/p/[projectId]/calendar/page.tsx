import { Suspense } from "react";
import Link from "next/link";
import { Lightbulb, Sparkles } from "lucide-react";
import { CalendarApp, type CalendarFilters } from "@/components/calendar/calendar-app";
import { InsightsPanel } from "@/components/calendar/insights-panel";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { DeleteCalendarButton } from "@/components/history/delete-calendar-button";
import { canEdit, CONTENT_STATUSES, STATUS_TO_WORKFLOW, WORKFLOW_STATES } from "@/lib/domain/constants";
import { bestPublicationTimes } from "@/lib/calendar/insights";
import { addDays, CALENDAR_VIEWS, isIsoDate, isValidTimeZone, todayInZone, viewRange, zonedToUtc, type CalendarView } from "@/lib/calendar/time";
import { isAIConfigured } from "@/server/ai/client";
import { getPost, listCalendars, listDeadlinesInRange, listPostsInRange, listUndatedPosts, myContentIds, type PostFilters } from "@/server/services/calendar";
import { requireUser } from "@/server/services/session";
import { assignablePeople, getPermissions, listTasksForItems } from "@/server/services/team";
import { PRIORITIES } from "@/lib/permissions";
import { loadHistoryPerformance } from "@/server/services/history-analysis";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";

export const metadata = { title: "Editorial Calendar" };

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { project, role } = await getProjectContext(projectId);
  const tz = isValidTimeZone(project.timezone) ? project.timezone : "Africa/Tunis";
  const today = todayInZone(tz);
  const view = CALENDAR_VIEWS.includes(sp.view as CalendarView) ? (sp.view as CalendarView) : "month";
  const user = await requireUser();
  const date = isIsoDate(one(sp.date)) ? one(sp.date) : today;

  const filters: CalendarFilters = {
    platform: list(sp.platform),
    state: list(sp.state).filter((s) => (WORKFLOW_STATES as readonly string[]).includes(s)),
    pillar: one(sp.pillar),
    funnel: one(sp.funnel),
    campaign: one(sp.campaign),
    plan: one(sp.plan),
    from: isIsoDate(one(sp.from)) ? one(sp.from) : "",
    to: isIsoDate(one(sp.to)) ? one(sp.to) : "",
    assignee: one(sp.assignee),
    priority: list(sp.priority).filter((p) => (PRIORITIES as readonly string[]).includes(p)),
    format: list(sp.format).slice(0, 20),
    q: one(sp.q).slice(0, 100),
    mine: one(sp.mine) === "1",
    overdue: one(sp.overdue) === "1",
  };
  const query: PostFilters = {
    platforms: filters.platform,
    pillars: filters.pillar ? [filters.pillar] : [],
    funnel: filters.funnel ? [filters.funnel] : [],
    statuses: filters.state.length ? CONTENT_STATUSES.filter((s) => filters.state.includes(STATUS_TO_WORKFLOW[s])) : [],
    campaign: filters.campaign || null,
    plan: filters.plan || null,
    assignee: filters.assignee === "none" || /^[0-9a-f-]{36}$/i.test(filters.assignee) ? filters.assignee : null,
    priorities: filters.priority,
    formats: filters.format,
    search: filters.q || null,
    ids: filters.mine ? await myContentIds(projectId, user.id) : null,
    overdueBefore: filters.overdue ? today : null,
  };

  // Historical insights load in parallel and stream in; the calendar itself never waits for them.
  const history = loadHistoryPerformance(projectId);
  const timing = history.then((h) => bestPublicationTimes(h.items, tz));

  // The rendered period, narrowed by the optional date-range filter.
  const range = viewRange(view, date);
  const from = filters.from && filters.from > range.from ? filters.from : range.from;
  const to = filters.to && filters.to < range.to ? filters.to : range.to;
  const [posts, undated, deadlines, plans, bundle, perms, people] = await Promise.all([
    from <= to ? listPostsInRange(projectId, { fromUtc: zonedToUtc(from, "00:00", tz), toUtc: zonedToUtc(addDays(to, 1), "00:00", tz), fromDate: from, toDate: to }, query) : [],
    listUndatedPosts(projectId, query),
    from <= to ? listDeadlinesInRange(projectId, from, to, query) : [],
    listCalendars(projectId),
    getStrategyBundle(projectId),
    getPermissions(project.workspace_id),
    assignablePeople(project.workspace_id),
  ]);
  const tasks = await listTasksForItems(projectId, [...new Set([...posts, ...undated, ...deadlines].map((p) => p.id))]);
  const selectedPlan = plans.find((p) => p.id === filters.plan);
  const editable = canEdit(role) && perms.has("calendar.edit");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Editorial Calendar"
        description="Plan, schedule and track posts. Approve content in Production, book an internal slot, then verify publication with the connected platform."
        actions={
          <>
            {selectedPlan && editable ? <DeleteCalendarButton projectId={projectId} calendarId={selectedPlan.id} name={selectedPlan.name} /> : null}
            <Button asChild size="sm"><Link href={`/p/${projectId}/calendar/plan`}><Sparkles /> Plan a month</Link></Button>
            {selectedPlan && (selectedPlan as { status?: string }).status !== "saved" ? <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/calendar/plan/${selectedPlan.id}`}>Plan details</Link></Button> : null}
            <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/history?tab=recommendations`}>Plan from historical insights</Link></Button>
          </>
        }
      />
      <CalendarApp
        initialItem={one(sp.item) ? await getPost(projectId, one(sp.item)) : null}
        projectId={projectId}
        view={view}
        date={date}
        today={today}
        tz={tz}
        posts={posts}
        undated={undated}
        pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name, color: p.color ?? null }))}
        campaigns={bundle.campaigns.map((c) => ({ id: c.id, name: c.name }))}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        filters={filters}
        readOnly={!editable}
        deadlines={deadlines}
        tasks={tasks}
        people={people}
        perms={[...perms]}
        userId={user.id}
        aiEnabled={isAIConfigured()}
        timing={timing}
        insights={
          <Suspense fallback={<InsightsLoading />}>
            <Insights projectId={projectId} tz={tz} history={history} timing={timing} />
          </Suspense>
        }
      />
    </div>
  );
}

async function Insights({ projectId, tz, history, timing }: { projectId: string; tz: string; history: ReturnType<typeof loadHistoryPerformance>; timing: Promise<ReturnType<typeof bestPublicationTimes>> }) {
  const [{ performance }, t] = await Promise.all([history, timing]);
  return <InsightsPanel projectId={projectId} timing={t} performance={performance} tz={tz} />;
}

function InsightsLoading() {
  return (
    <aside className="space-y-2 rounded-xl border bg-card p-4 shadow-xs" aria-busy="true">
      <p className="flex items-center gap-2 text-[13px] font-semibold"><Lightbulb className="size-4" /> Publishing insights</p>
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
    </aside>
  );
}
