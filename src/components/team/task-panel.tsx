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
  allowedTaskTransitions, PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPES, TASK_TYPE_LABELS,
  type Priority, type TaskStatus, type TaskType,
} from "@/lib/permissions";
import { assignTaskAction, removeTaskAction, updateTaskStatusAction } from "@/server/actions/team";
import type { Task } from "@/server/services/team";
import { DueLabel, PersonChip, PriorityBadge, TaskStatusBadge } from "./task-badges";

export type Assignable = { user_id: string; name: string; roleName: string | null; canEdit: boolean };

/** Collaborators and their tasks on one idea or brief. */
export function TaskPanel({
  projectId, itemId, tasks: initial, people, perms, userId, today, onChange,
}: {
  projectId: string; itemId: string; tasks: Task[]; people: Assignable[]; perms: string[]; userId: string; today: string;
  onChange?: () => void;
}) {
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
    if (r.data) setTasks(tasks.map((t) => (t.id === task.id ? r.data! : t)));
    setChangesFor(null);
    setChangesNote("");
    toast.success(`${TASK_TYPE_LABELS[task.task_type]}: ${TASK_STATUS_LABELS[status].toLowerCase()}`);
    onChange?.();
  };

  const remove = async (task: Task) => {
    if (!(await confirm({ title: "Remove this task?", description: `${person(task.user_id)?.name ?? "This person"} loses access through this task.`, confirmLabel: "Remove task", destructive: true }))) return;
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
        <h3 className="text-sm font-semibold">Collaborators and tasks</h3>
        <p className="text-xs text-muted-foreground">
          Each person gets a task with its own status. Assigned people can open and edit this content; reviewers approve each task.
        </p>
      </div>

      {tasks.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {tasks.map((t) => {
            const p = person(t.user_id);
            const mine = t.user_id === userId;
            const next = allowedTaskTransitions({ status: t.status, task_type: t.task_type, mine }, permSet);
            const closed = t.status === "approved" || t.status === "completed";
            return (
              <li key={t.id} className="space-y-2.5 p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <PersonChip name={p?.name ?? "Former member"} role={`${TASK_TYPE_LABELS[t.task_type]}${p?.roleName ? ` · ${p.roleName}` : ""}`} />
                  </div>
                  <TaskStatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                  <DueLabel due={t.due_date} today={today} closed={closed} />
                  {canAssign ? (
                    <Button variant="ghost" size="icon-xs" aria-label="Remove task" disabled={busy === t.id} onClick={() => remove(t)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                {t.note ? <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground" dir="auto">{t.note}</p> : null}
                {next.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {next.filter((s) => s !== "changes_requested" && (canAssign || ["in_progress", "in_review", "completed"].includes(s))).map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        variant={s === "approved" || (s === "in_review" && mine) ? "default" : "outline"}
                        loading={busy === t.id}
                        onClick={() => move(t, s)}
                      >
                        {s === "in_review" && mine ? "Submit for review" : s === "approved" ? "Approve" : `Mark ${TASK_STATUS_LABELS[s].toLowerCase()}`}
                      </Button>
                    ))}
                    {next.includes("changes_requested") ? (
                      <Button size="xs" variant="outline" onClick={() => setChangesFor(changesFor === t.id ? null : t.id)}>
                        Request changes
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {changesFor === t.id ? (
                  <div className="space-y-2">
                    <Textarea aria-label="Requested changes" rows={2} placeholder="What needs to change?" value={changesNote} onChange={(e) => setChangesNote(e.target.value)} />
                    <Button size="xs" disabled={!changesNote.trim()} loading={busy === t.id} onClick={() => move(t, "changes_requested", changesNote)}>
                      Send change request
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
          No tasks yet.{canAssign ? " Assign the copy, the design or a review below." : " A manager assigns the work."}
        </div>
      )}

      {canAssign ? (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <p className="text-[13px] font-medium">Assign a task</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Team member" htmlFor="task-user">
              <NativeSelect id="task-user" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Choose a person…</option>
                {people.filter((p) => p.canEdit).map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name || "Unnamed member"}{p.roleName ? ` — ${p.roleName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Task" htmlFor="task-type">
              <NativeSelect id="task-type" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="task-priority">
              <NativeSelect id="task-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Due date" htmlFor="task-due" optional>
              <Input id="task-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <Field label="Instructions" htmlFor="task-note" optional className="sm:col-span-2">
              <Textarea id="task-note" rows={2} placeholder="Requirements, references, format, deliverables…" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>
          <Button size="sm" disabled={!form.userId} loading={busy === "assign"} onClick={assign}>
            <Plus /> Assign task
          </Button>
        </div>
      ) : null}
    </div>
  );
}
