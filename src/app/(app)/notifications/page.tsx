import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { TaskTable } from "@/components/team/task-table";
import { NotificationList } from "@/components/team/notification-list";
import { OPEN_TASK_STATUSES } from "@/lib/permissions";
import { nowMs } from "@/lib/format";
import { getT } from "@/i18n/server";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { getPermissions, listNotifications, listWorkspaceTasks } from "@/server/services/team";

export async function generateMetadata() {
  const t = await getT("team");
  return { title: t("meta.notifications") };
}

export default async function NotificationsPage() {
  const [user, workspace, t] = await Promise.all([requireUser(), getActiveWorkspace(), getT("team")]);
  const ws = workspace!;
  const [items, tasks, perms] = await Promise.all([listNotifications(ws.id), listWorkspaceTasks(ws.id, { userId: user.id }), getPermissions(ws.id)]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(nowMs() + 2 * 86_400_000).toISOString().slice(0, 10);
  // Deadlines are computed live rather than stored, so they're always current.
  const dueSoon = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status) && t.due_date && t.due_date <= soon);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={ws.name} title={t("notifications.title")} description={t("notifications.description")} />
      {dueSoon.length ? (
        <section className="space-y-3">
          <SectionHeader title={t("notifications.deadlines")} description={t("notifications.deadlinesDescription")} />
          <TaskTable tasks={dueSoon} today={today} userId={user.id} perms={[...perms]} emptyText="" />
        </section>
      ) : null}
      <section className="space-y-3">
        <SectionHeader title={t("notifications.activity")} />
        <NotificationList items={items} />
      </section>
    </div>
  );
}
