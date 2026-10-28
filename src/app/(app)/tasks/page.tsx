import { AlertTriangle, CheckCircle2, Clock, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SegmentedNav } from "@/components/app/segmented-nav";
import { Stat, StatGrid } from "@/components/app/stat";
import { Alert } from "@/components/ui/alert";
import { TaskTable } from "@/components/team/task-table";
import { OPEN_TASK_STATUSES } from "@/lib/permissions";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { getPermissions, listWorkspaceTasks, teamSchemaReady } from "@/server/services/team";

export const metadata = { title: "My tasks" };

const VIEWS = [
  { id: "open", label: "To do" },
  { id: "review", label: "In review" },
  { id: "done", label: "Done" },
] as const;

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [user, workspace, sp] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams]);
  const ws = workspace!;
  const [tasks, perms, ready] = await Promise.all([listWorkspaceTasks(ws.id, { userId: user.id }), getPermissions(ws.id), teamSchemaReady()]);
  const today = new Date().toISOString().slice(0, 10);
  const view = VIEWS.some((v) => v.id === sp.view) ? sp.view! : "open";
  const open = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status) && t.status !== "in_review");
  const review = tasks.filter((t) => t.status === "in_review");
  const done = tasks.filter((t) => t.status === "approved" || t.status === "completed");
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const shown = view === "review" ? review : view === "done" ? done : open;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={ws.name} title="My tasks" description="Everything assigned to you across projects, soonest deadline first." />
      {!ready ? <Alert variant="warning" title="Team features are not set up yet">Database migration 0013 needs to be applied before tasks appear here.</Alert> : null}
      <StatGrid>
        <Stat icon={ListChecks} label="To do" value={open.length} hint="Assigned, in progress or with changes requested" />
        <Stat icon={AlertTriangle} label="Overdue" value={overdue.length} hint={overdue.length ? "Past their due date" : "Nothing overdue"} />
        <Stat icon={Clock} label="In review" value={review.length} hint="Waiting for a reviewer" />
        <Stat icon={CheckCircle2} label="Done" value={done.length} hint="Approved or completed" />
      </StatGrid>
      <SegmentedNav
        label="Task status"
        items={VIEWS.map((v) => ({ key: v.id, label: v.label, href: `/tasks?view=${v.id}`, active: view === v.id }))}
      />
      <TaskTable
        tasks={shown}
        today={today}
        userId={user.id}
        perms={[...perms]}
        emptyText={view === "open" ? "You're all caught up. New assignments will appear here." : view === "review" ? "Nothing waiting for review." : "No finished tasks yet."}
      />
    </div>
  );
}
