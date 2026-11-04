import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { PermissionDenied } from "@/components/app/permission-denied";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { TaskTable } from "@/components/team/task-table";
import { PersonChip } from "@/components/team/task-badges";
import { OPEN_TASK_STATUSES, PRIORITIES, TASK_STATUSES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { nowMs } from "@/lib/format";
import { getT } from "@/i18n/server";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { assignablePeople, getPermissions, listRoles, listTeam, listWorkspaceTasks } from "@/server/services/team";

export async function generateMetadata() {
  const t = await getT("team");
  return { title: t("meta.workload") };
}

type Filters = { assignee?: string; role?: string; status?: string; priority?: string; due?: string };

export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const [user, workspace, f, t, td, tc] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams, getT("team"), getT("domain"), getT("common")]);
  const ws = workspace!;
  const perms = await getPermissions(ws.id);
  if (!perms.has("content.assign") && !perms.has("team.manage")) return <PermissionDenied what={t("workload.denied")} />;
  const [tasks, people, team, roles] = await Promise.all([listWorkspaceTasks(ws.id), assignablePeople(ws.id), listTeam(ws.id), listRoles(ws.id)]);
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(nowMs() + 7 * 86_400_000).toISOString().slice(0, 10);
  const roleOf = new Map(team.map((m) => [m.user_id, m.role_id]));
  const isOpen = (s: string) => (OPEN_TASK_STATUSES as string[]).includes(s);

  const filtered = tasks.filter((t) =>
    (!f.assignee || t.user_id === f.assignee) &&
    (!f.role || roleOf.get(t.user_id) === f.role) &&
    (!f.status || (f.status === "open" ? isOpen(t.status) : t.status === f.status)) &&
    (!f.priority || t.priority === f.priority) &&
    (!f.due || (f.due === "overdue" ? Boolean(t.due_date && t.due_date < today && isOpen(t.status)) : f.due === "week" ? Boolean(t.due_date && t.due_date >= today && t.due_date <= weekEnd) : !t.due_date)),
  );

  const load = people.filter((p) => p.canEdit).map((p) => {
    const mine = tasks.filter((t) => t.user_id === p.user_id);
    return {
      ...p,
      open: mine.filter((t) => isOpen(t.status) && t.status !== "in_review").length,
      review: mine.filter((t) => t.status === "in_review").length,
      overdue: mine.filter((t) => isOpen(t.status) && t.due_date && t.due_date < today).length,
    };
  }).sort((a, b) => b.open + b.review - (a.open + a.review));
  const maxLoad = Math.max(1, ...load.map((l) => l.open + l.review));
  const peopleMap = Object.fromEntries(people.map((p) => [p.user_id, { name: p.name, roleName: p.roleName }]));
  const active = Object.values(f).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={ws.name} title={t("page.title")} description={t("workload.description")} />
      <TabNav
        label={t("sections.label")}
        items={[
          { key: "members", label: t("sections.members"), href: "/team?tab=members", active: false },
          { key: "workload", label: t("sections.workload"), href: "/team/workload", active: true },
          ...(perms.has("team.manage") ? [{ key: "invitations", label: t("sections.invitations"), href: "/team?tab=invitations", active: false }] : []),
          { key: "roles", label: t("sections.roles"), href: "/team?tab=roles", active: false },
        ]}
      />

      <section aria-label={t("workload.byPerson")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {load.map((p) => (
          <Link
            key={p.user_id}
            href={`/team/workload?assignee=${p.user_id}`}
            className={cn("rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm", f.assignee === p.user_id && "border-primary/40 ring-2 ring-primary/15")}
          >
            <PersonChip size="md" name={p.name} role={p.roleName} />
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div className="flex h-full">
                <div className="bg-primary" style={{ width: `${(p.open / maxLoad) * 100}%` }} />
                <div className="bg-chart-a" style={{ width: `${(p.review / maxLoad) * 100}%` }} />
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-foreground">{t("workload.toDo")}</dt><dd className="text-[15px] font-semibold tabular-nums">{p.open}</dd></div>
              <div><dt className="text-muted-foreground">{t("workload.inReview")}</dt><dd className="text-[15px] font-semibold tabular-nums">{p.review}</dd></div>
              <div><dt className="text-muted-foreground">{t("workload.overdue")}</dt><dd className={cn("text-[15px] font-semibold tabular-nums", p.overdue && "text-destructive")}>{p.overdue}</dd></div>
            </dl>
          </Link>
        ))}
      </section>

      <form className="grid grid-cols-2 gap-x-2 gap-y-3 rounded-xl border bg-card p-3 shadow-xs md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] xl:items-end" action="/team/workload">
        <Filter label={t("workload.filters.assignee")} allLabel={tc("states.all")} name="assignee" value={f.assignee} options={people.map((p) => ({ value: p.user_id, label: p.name || t("members.unnamed") }))} />
        <Filter label={t("workload.filters.role")} allLabel={tc("states.all")} name="role" value={f.role} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        <Filter label={t("workload.filters.status")} allLabel={tc("states.all")} name="status" value={f.status} options={[{ value: "open", label: t("workload.filters.allOpen") }, ...TASK_STATUSES.map((s) => ({ value: s, label: td(`taskStatus.${s}`) }))]} />
        <Filter label={t("workload.filters.priority")} allLabel={tc("states.all")} name="priority" value={f.priority} options={PRIORITIES.map((p) => ({ value: p, label: td(`priority.${p}`) }))} />
        <Filter label={t("workload.filters.due")} allLabel={tc("states.all")} name="due" value={f.due} options={[{ value: "overdue", label: t("workload.filters.overdue") }, { value: "week", label: t("workload.filters.week") }, { value: "none", label: t("workload.filters.none") }]} />
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="submit" size="sm" className="flex-1 xl:flex-none">{tc("actions.apply")}</Button>
          {active ? <Button asChild size="sm" variant="ghost"><Link href="/team/workload">{tc("actions.reset")}</Link></Button> : null}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">{t("workload.count", { count: filtered.length })}</p>
      <TaskTable tasks={filtered} today={today} userId={user.id} perms={[...perms]} people={peopleMap} showAssignee emptyText={active ? t("workload.emptyFiltered") : t("workload.empty")} />
    </div>
  );
}

function Filter({ label, allLabel, name, value, options }: { label: string; allLabel: string; name: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect name={name} defaultValue={value ?? ""} className="h-8 text-[13px]">
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );
}
