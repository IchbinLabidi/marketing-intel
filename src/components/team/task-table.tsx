"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { allowedTaskTransitions, TASK_TYPE_LABELS } from "@/lib/permissions";
import { updateTaskStatusAction } from "@/server/actions/team";
import type { TaskWithContent } from "@/server/services/team";
import { DueLabel, PersonChip, PriorityBadge, TaskStatusBadge } from "./task-badges";

/** Tasks as a responsive table: rows on desktop, stacked cards on phones. */
export function TaskTable({
  tasks, today, userId, perms, people, showAssignee = false, emptyText,
}: {
  tasks: TaskWithContent[]; today: string; userId: string; perms: string[];
  people?: Record<string, { name: string; roleName: string | null }>; showAssignee?: boolean; emptyText: string;
}) {
  const router = useRouter();
  const permSet = React.useMemo(() => new Set(perms), [perms]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const quick = async (t: TaskWithContent, status: "in_progress" | "in_review") => {
    setBusy(t.id);
    const r = await updateTaskStatusAction(t.id, status);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(status === "in_review" ? "Submitted for review" : "Marked in progress");
    router.refresh();
  };

  if (!tasks.length) return <p className="rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center text-[13px] text-muted-foreground">{emptyText}</p>;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        {tasks.map((t) => {
          const mine = t.user_id === userId;
          const next = mine ? allowedTaskTransitions({ status: t.status, task_type: t.task_type, mine }, permSet) : [];
          const closed = t.status === "approved" || t.status === "completed";
          const href = `/p/${t.project_id}/production?item=${t.content_item_id}`;
          const person = people?.[t.user_id];
          return (
            <li key={t.id} className="grid gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,1fr)_9rem_8rem_7rem_auto] md:items-center">
              <div className="min-w-0">
                <Link href={href} className="block truncate text-[13.5px] font-medium hover:text-primary" dir="auto">
                  {t.content?.title ?? "Content no longer available"}
                </Link>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {TASK_TYPE_LABELS[t.task_type]} · {t.project?.name}
                </p>
              </div>
              {showAssignee ? (
                <div className="min-w-0">{person ? <PersonChip name={person.name} role={person.roleName} /> : <span className="text-xs text-muted-foreground">Former member</span>}</div>
              ) : (
                <div><TaskStatusBadge status={t.status} /></div>
              )}
              <div className="flex items-center gap-3 md:block">
                {showAssignee ? <TaskStatusBadge status={t.status} /> : <PriorityBadge priority={t.priority} />}
              </div>
              <div><DueLabel due={t.due_date} today={today} closed={closed} /></div>
              <div className="flex justify-start gap-1.5 md:justify-end">
                {next.includes("in_progress") && t.status !== "in_review" ? (
                  <Button size="xs" variant="outline" loading={busy === t.id} onClick={() => quick(t, "in_progress")}>Start</Button>
                ) : null}
                {next.includes("in_review") ? (
                  <Button size="xs" loading={busy === t.id} onClick={() => quick(t, "in_review")}>Submit</Button>
                ) : null}
                {!next.length || closed ? (
                  <Button asChild size="xs" variant="ghost"><Link href={href}>Open</Link></Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
