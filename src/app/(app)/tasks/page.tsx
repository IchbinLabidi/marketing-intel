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
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("team");
  return { title: t("meta.tasks") };
}

const VIEWS = [{ id: "open" }, { id: "review" }, { id: "done" }] as const;

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [user, workspace, sp, t] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams, getT("team")]);
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
      <PageHeader eyebrow={ws.name} title={t("tasks.title")} description={t("tasks.description")} />
      {!ready ? <Alert variant="warning" title={t("tasks.notReadyTitle")}>{t("tasks.notReadyBody")}</Alert> : null}
      <StatGrid>
        <Stat icon={ListChecks} label={t("tasks.stats.toDo")} value={open.length} hint={t("tasks.stats.toDoHint")} />
        <Stat icon={AlertTriangle} label={t("tasks.stats.overdue")} value={overdue.length} hint={overdue.length ? t("tasks.stats.overdueHint") : t("tasks.stats.nothingOverdue")} />
        <Stat icon={Clock} label={t("tasks.stats.inReview")} value={review.length} hint={t("tasks.stats.inReviewHint")} />
        <Stat icon={CheckCircle2} label={t("tasks.stats.done")} value={done.length} hint={t("tasks.stats.doneHint")} />
      </StatGrid>
      <SegmentedNav
        label={t("tasks.viewsLabel")}
        items={VIEWS.map((v) => ({ key: v.id, label: t(`tasks.views.${v.id}`), href: `/tasks?view=${v.id}`, active: view === v.id }))}
      />
      <TaskTable
        tasks={shown}
        today={today}
        userId={user.id}
        perms={[...perms]}
        emptyText={view === "open" ? t("tasks.empty.open") : view === "review" ? t("tasks.empty.review") : t("tasks.empty.done")}
      />
    </div>
  );
}
