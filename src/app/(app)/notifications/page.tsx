import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { TaskTable } from "@/components/team/task-table";
import { NotificationList } from "@/components/team/notification-list";
import { OPEN_TASK_STATUSES } from "@/lib/permissions";
import { nowMs } from "@/lib/format";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { getPermissions, listNotifications, listWorkspaceTasks } from "@/server/services/team";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const [user, workspace] = await Promise.all([requireUser(), getActiveWorkspace()]);
  const ws = workspace!;
  const [items, tasks, perms] = await Promise.all([listNotifications(ws.id), listWorkspaceTasks(ws.id, { userId: user.id }), getPermissions(ws.id)]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(nowMs() + 2 * 86_400_000).toISOString().slice(0, 10);
  // Deadlines are computed live rather than stored, so they're always current.
  const dueSoon = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status) && t.due_date && t.due_date <= soon);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={ws.name} title="Notifications" description="Assignments, mentions, review requests and requested changes." />
      {dueSoon.length ? (
        <section className="space-y-3">
          <SectionHeader title="Deadlines" description="Your open tasks that are overdue or due within two days." />
          <TaskTable tasks={dueSoon} today={today} userId={user.id} perms={[...perms]} emptyText="" />
        </section>
      ) : null}
      <section className="space-y-3">
        <SectionHeader title="Activity for you" />
        <NotificationList items={items} />
      </section>
    </div>
  );
}
