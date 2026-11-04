"use client";

import * as React from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/form";
import { confirm } from "@/components/ui/confirm";
import {
  allowedTaskTransitions, PRIORITIES, TASK_TYPES,
  type Priority, type TaskStatus, type TaskType,
} from "@/lib/permissions";
import { assignTaskAction, removeTaskAction, updateTaskStatusAction } from "@/server/actions/team";
import type { Task } from "@/server/services/team";
import { DueLabel, PersonChip, PriorityBadge, TaskStatusBadge } from "./task-badges";
import { useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";

// domain.taskType has an "other" key, so its type reads as plural forms; the full path still resolves to the label.
type TaskTypeKey = Parameters<TFor<"domain">>[0];

export type Assignable = { user_id: string; name: string; roleName: string | null; canEdit: boolean };

/** Collaborators and their tasks on one idea or brief. */
export function TaskPanel({
  projectId, itemId, tasks: initial, people, perms, userId, today, onChange,
}: {
  projectId: string; itemId: string; tasks: Task[]; people: Assignable[]; perms: string[]; userId: string; today: string;
  onChange?: () => void;
}) {
  const t = useT("team");
  const td = useT("domain");
  const permSet = React.useMemo(() => new Set(perms), [perms]);
  const canAssign = permSet.has("content.assign");
  // Local edits win until the parent reloads the list (a new `initial` array).
  const [local, setTasks] = React.useState<Task[] | null>(null);
  const [seen, setSeen] = React.useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setTasks(null);
  }
  const tasks = local ?? initial;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ userId: "", taskType: "copywriting" as TaskType, priority: "medium" as Priority, dueDate: "", note: "" });
  const [changesFor, setChangesFor] = React.useState<string | null>(null);
  const [changesNote, setChangesNote] = React.useState("");
  const person = (id: string) => people.find((p) => p.user_id === id);

  const assign = async () => {
    setBusy("assign");
    const r = await assignTaskAction(projectId, itemId, form);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    if (r.data) setTasks(r.data);
    setForm((f) => ({ ...f, userId: "", note: "" }));
    toast.success(r.message);
    onChange?.();
  };

  const move = async (task: Task, status: TaskStatus, comment = "") => {
    setBusy(task.id);
    const r = await updateTaskStatusAction(task.id, status, comment);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    if (r.data) setTasks(tasks.map((x) => (x.id === task.id ? r.data! : x)));
    setChangesFor(null);
    setChangesNote("");
    toast.success(t("taskPanel.moved", { type: td(`taskType.${task.task_type}` as TaskTypeKey), status: td(`taskStatus.${status}`).toLowerCase() }));
    onChange?.();
  };

  const remove = async (task: Task) => {
    if (!(await confirm({ title: t("taskPanel.confirmRemoveTitle"), description: t("taskPanel.confirmRemoveBody", { name: person(task.user_id)?.name ?? t("taskPanel.thisPerson") }), confirmLabel: t("taskPanel.removeTask"), destructive: true }))) return;
    setBusy(task.id);
    const r = await removeTaskAction(projectId, itemId, task.id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    if (r.data) setTasks(r.data);
    onChange?.();
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("taskPanel.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("taskPanel.description")}
        </p>
      </div>

      {tasks.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {tasks.map((task) => {
            const p = person(task.user_id);
            const mine = task.user_id === userId;
            const next = allowedTaskTransitions({ status: task.status, task_type: task.task_type, mine }, permSet);
            const closed = task.status === "approved" || task.status === "completed";
            return (
              <li key={task.id} className="space-y-2.5 p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <PersonChip name={p?.name ?? t("page.formerMember")} role={`${td(`taskType.${task.task_type}` as TaskTypeKey)}${p?.roleName ? ` · ${p.roleName}` : ""}`} />
                  </div>
                  <TaskStatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  <DueLabel due={task.due_date} today={today} closed={closed} />
                  {canAssign ? (
                    <Button variant="ghost" size="icon-xs" aria-label={t("taskPanel.removeTask")} disabled={busy === task.id} onClick={() => remove(task)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                {task.note ? <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground" dir="auto">{task.note}</p> : null}
                {next.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {next.filter((s) => s !== "changes_requested" && (canAssign || ["in_progress", "in_review", "completed"].includes(s))).map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        variant={s === "approved" || (s === "in_review" && mine) ? "default" : "outline"}
                        loading={busy === task.id}
                        onClick={() => move(task, s)}
                      >
                        {s === "in_review" && mine ? t("taskPanel.submitForReview") : s === "approved" ? t("taskPanel.approve") : t("taskPanel.markAs", { status: td(`taskStatus.${s}`).toLowerCase() })}
                      </Button>
                    ))}
                    {next.includes("changes_requested") ? (
                      <Button size="xs" variant="outline" onClick={() => setChangesFor(changesFor === task.id ? null : task.id)}>
                        {t("taskPanel.requestChanges")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {changesFor === task.id ? (
                  <div className="space-y-2">
                    <Textarea aria-label={t("taskPanel.requestedChanges")} rows={2} placeholder={t("taskPanel.changesPlaceholder")} value={changesNote} onChange={(e) => setChangesNote(e.target.value)} />
                    <Button size="xs" disabled={!changesNote.trim()} loading={busy === task.id} onClick={() => move(task, "changes_requested", changesNote)}>
                      {t("taskPanel.sendChangeRequest")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-[13px] text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden />
          {canAssign ? t("taskPanel.emptyAssign") : t("taskPanel.emptyManager")}
        </div>
      )}

      {canAssign ? (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <p className="text-[13px] font-medium">{t("taskPanel.assignTitle")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("taskPanel.member")} htmlFor="task-user">
              <NativeSelect id="task-user" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">{t("taskPanel.choosePerson")}</option>
                {people.filter((p) => p.canEdit).map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name || t("members.unnamed")}{p.roleName ? ` — ${p.roleName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("taskPanel.task")} htmlFor="task-type">
              <NativeSelect id="task-type" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
                {TASK_TYPES.map((x) => <option key={x} value={x}>{td(`taskType.${x}` as TaskTypeKey)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("taskPanel.priority")} htmlFor="task-priority">
              <NativeSelect id="task-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{td(`priority.${p}`)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("taskPanel.dueDate")} htmlFor="task-due" optional>
              <Input id="task-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <Field label={t("taskPanel.instructions")} htmlFor="task-note" optional className="sm:col-span-2">
              <Textarea id="task-note" rows={2} placeholder={t("taskPanel.instructionsPlaceholder")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>
          <Button size="sm" disabled={!form.userId} loading={busy === "assign"} onClick={assign}>
            <Plus /> {t("taskPanel.assign")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
