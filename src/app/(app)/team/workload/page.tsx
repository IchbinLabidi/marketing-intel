import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { PermissionDenied } from "@/components/app/permission-denied";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { TaskTable } from "@/components/team/task-table";
import { PersonChip } from "@/components/team/task-badges";
import { OPEN_TASK_STATUSES, PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { nowMs } from "@/lib/format";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { assignablePeople, getPermissions, listRoles, listTeam, listWorkspaceTasks } from "@/server/services/team";

export const metadata = { title: "Team workload" };

type Filters = { assignee?: string; role?: string; status?: string; priority?: string; due?: string };

export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const [user, workspace, f] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams]);
  const ws = workspace!;
  const perms = await getPermissions(ws.id);
  if (!perms.has("content.assign") && !perms.has("team.manage")) return <PermissionDenied what="the team workload" />;
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
      <PageHeader eyebrow={ws.name} title="Team" description="Members, their roles, and what each role can see and do." />
      <TabNav
        label="Team sections"
        items={[
          { key: "members", label: "Members", href: "/team?tab=members", active: false },
          { key: "workload", label: "Workload", href: "/team/workload", active: true },
          ...(perms.has("team.manage") ? [{ key: "invitations", label: "Invitations", href: "/team?tab=invitations", active: false }] : []),
          { key: "roles", label: "Roles & permissions", href: "/team?tab=roles", active: false },
        ]}
      />

      <section aria-label="Workload by person" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <div><dt className="text-muted-foreground">To do</dt><dd className="text-[15px] font-semibold tabular-nums">{p.open}</dd></div>
              <div><dt className="text-muted-foreground">In review</dt><dd className="text-[15px] font-semibold tabular-nums">{p.review}</dd></div>
              <div><dt className="text-muted-foreground">Overdue</dt><dd className={cn("text-[15px] font-semibold tabular-nums", p.overdue && "text-destructive")}>{p.overdue}</dd></div>
            </dl>
          </Link>
        ))}
      </section>

      <form className="grid grid-cols-2 gap-x-2 gap-y-3 rounded-xl border bg-card p-3 shadow-xs md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] xl:items-end" action="/team/workload">
        <Filter label="Assignee" name="assignee" value={f.assignee} options={people.map((p) => ({ value: p.user_id, label: p.name || "Unnamed member" }))} />
        <Filter label="Role" name="role" value={f.role} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        <Filter label="Status" name="status" value={f.status} options={[{ value: "open", label: "All open" }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))]} />
        <Filter label="Priority" name="priority" value={f.priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        <Filter label="Due date" name="due" value={f.due} options={[{ value: "overdue", label: "Overdue" }, { value: "week", label: "Next 7 days" }, { value: "none", label: "No due date" }]} />
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="submit" size="sm" className="flex-1 xl:flex-none">Apply</Button>
          {active ? <Button asChild size="sm" variant="ghost"><Link href="/team/workload">Reset</Link></Button> : null}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">{filtered.length} task{filtered.length === 1 ? "" : "s"}</p>
      <TaskTable tasks={filtered} today={today} userId={user.id} perms={[...perms]} people={peopleMap} showAssignee emptyText={active ? "No tasks match these filters." : "No tasks assigned yet. Assign work from an idea or brief in Content Production."} />
    </div>
  );
}

function Filter({ label, name, value, options }: { label: string; name: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect name={name} defaultValue={value ?? ""} className="h-8 text-[13px]">
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );
}
