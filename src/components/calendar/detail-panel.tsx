"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Copy, ExternalLink, FileText, Flag, MessageSquare, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { STAGE_LABELS } from "@/lib/production/model";
import { PRIORITIES, PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { updatePlanningAction } from "@/server/actions/calendar";
import { commentProductionAction, transitionProductionAction } from "@/server/actions/production";
import type { Task } from "@/server/services/team";
import type { ContentItem } from "@/types/domain";
import { PersonChip, TaskStatusBadge } from "@/components/team/task-badges";
import { PlatformIcon } from "./platform-icon";
import { StatePill, stateOf } from "./post-card";
import { contentType, isOverdue, type Person } from "./planning";

/**
 * Side panel for one calendar item: everything needed to plan it without leaving the calendar.
 * Publication date (when it goes live) and the internal deadline (when the work is due) are edited separately.
 */
export function DetailPanel({
  projectId, post, time, tasks, people, perms, userId, today, readOnly, onClose, onChanged, onMove, onDuplicate, onEdit,
}: {
  projectId: string;
  post: ContentItem;
  time: string | null;
  tasks: Task[];
  people: Map<string, Person>;
  perms: Set<string>;
  userId: string;
  today: string;
  readOnly: boolean;
  onClose: () => void;
  onChanged: (post: ContentItem) => void;
  onMove: (post: ContentItem, date: string, time: string | null) => void;
  onDuplicate: (post: ContentItem) => void;
  onEdit: (post: ContentItem) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [date, setDate] = React.useState(post.scheduled_date ?? "");
  const [slot, setSlot] = React.useState(time ?? "");
  const [comment, setComment] = React.useState("");
  const panelRef = React.useRef<HTMLElement>(null);
  const canAssign = perms.has("content.assign");
  const state = stateOf(post);
  const locked = readOnly || state === "published";
  const overdue = isOverdue(post, today);
  const lead = post.assignee_id ? people.get(post.assignee_id) : null;
  const itemTasks = tasks.filter((t) => t.content_item_id === post.id);
  const brief = `/p/${projectId}/production?item=${post.id}`;

  React.useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const plan = async (patch: Parameters<typeof updatePlanningAction>[2], label: string) => {
    setBusy(label);
    const r = await updatePlanningAction(projectId, post.id, patch);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    if (r.data?.post) onChanged(r.data.post);
    toast.success(r.message);
  };

  const toBrief = async () => {
    setBusy("brief");
    const r = await transitionProductionAction(projectId, post.id, (post as ContentItem & { revision?: number }).revision ?? 1, "brief");
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    if (r.data) onChanged(r.data as unknown as ContentItem);
    toast.success("Converted to a brief");
  };

  const sendComment = async () => {
    setBusy("comment");
    const r = await commentProductionAction(projectId, post.id, comment, []);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setComment("");
    toast.success("Comment added");
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-overlay/40 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={`Details: ${post.title}`}
        className="scrollbar-thin fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l bg-card shadow-lg outline-none animate-fade-in"
      >
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PlatformIcon platform={post.platform} />
              {PLATFORM_LABELS[post.platform as Platform] ?? "No platform"} · {contentType(post.format)}
            </p>
            <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em]" dir="auto">{post.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatePill state={state} />
              {post.production_stage ? <Badge variant="outline">{STAGE_LABELS[post.production_stage]}</Badge> : null}
              {overdue ? <Badge variant="destructive" dot>Overdue</Badge> : null}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><X /></Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Two different dates, edited separately */}
          <section className="grid gap-3">
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium"><CalendarClock className="size-3.5 text-primary" /> Publication</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">When the post goes live. Moving it keeps assignments, comments, files and history.</p>
              <div className="mt-2 grid grid-cols-[1fr_6.5rem_auto] gap-2">
                <Input type="date" aria-label="Publication date" value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} className="h-8 text-[13px]" />
                <Input type="time" aria-label="Publication time" value={slot} disabled={locked} onChange={(e) => setSlot(e.target.value)} className="h-8 text-[13px]" />
                <Button size="sm" variant="outline" disabled={locked || !date || (date === post.scheduled_date && (slot || null) === time)} onClick={() => onMove(post, date, slot || null)}>Move</Button>
              </div>
            </div>
            <div className={cn("rounded-lg border p-3", overdue && "border-destructive/40 bg-destructive/5")}>
              <p className="flex items-center gap-1.5 text-xs font-medium"><Flag className={cn("size-3.5", overdue ? "text-destructive" : "text-warning")} /> Internal deadline</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">When the work must be ready for review. Not shown to your audience.</p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="date"
                  aria-label="Internal deadline"
                  defaultValue={post.due_date ?? ""}
                  disabled={locked || busy === "deadline"}
                  // Saves as soon as a complete date is picked (date inputs only report full dates).
                  onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== post.due_date) void plan({ due_date: v }, "deadline"); }}
                  className="h-8 text-[13px]"
                />
                {post.due_date && !locked ? <Button size="sm" variant="ghost" onClick={() => plan({ due_date: null }, "deadline")}>Clear</Button> : null}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="eyebrow">Owner and priority</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-medium">
                Lead
                <NativeSelect className="h-8 text-[13px]" value={post.assignee_id ?? ""} disabled={locked || !canAssign || busy === "assignee"} onChange={(e) => plan({ assignee_id: e.target.value || null }, "assignee")}>
                  <option value="">Unassigned</option>
                  {[...people.values()].filter((p) => p.canEdit).map((p) => <option key={p.user_id} value={p.user_id}>{p.name || "Unnamed"}{p.roleName ? ` — ${p.roleName}` : ""}</option>)}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Priority
                <NativeSelect className="h-8 text-[13px]" value={post.priority ?? "medium"} disabled={locked || !canAssign || busy === "priority"} onChange={(e) => plan({ priority: e.target.value }, "priority")}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </NativeSelect>
              </label>
            </div>
            {lead ? <p className="text-xs text-muted-foreground">{lead.user_id === userId ? "You lead this item." : `Led by ${lead.name}.`}</p> : null}
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">Collaborators</h3>
            {itemTasks.length ? (
              <ul className="space-y-2">
                {itemTasks.map((t) => {
                  const p = people.get(t.user_id);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <PersonChip name={p?.name ?? "Former member"} role={`${TASK_TYPE_LABELS[t.task_type]}${t.due_date ? ` · due ${t.due_date}` : ""}`} />
                      <TaskStatusBadge status={t.status} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No collaborators yet.</p>
            )}
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href={`${brief}`}>{canAssign ? "Assign copy, design, video or SEO" : "Open tasks in the studio"}</Link>
            </Button>
            {itemTasks.some((t) => t.status === "in_review") ? (
              <p className="text-xs font-medium text-primary">
                Awaiting approval: {itemTasks.filter((t) => t.status === "in_review").map((t) => TASK_TYPE_LABELS[t.task_type]).join(", ")}
              </p>
            ) : null}
          </section>

          {post.creative_brief || post.hook ? (
            <section className="space-y-1.5">
              <h3 className="eyebrow">Brief</h3>
              <p className="line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground" dir="auto">{post.creative_brief || post.hook}</p>
            </section>
          ) : null}

          {!readOnly ? (
            <section className="space-y-2">
              <h3 className="eyebrow">Comment</h3>
              <Textarea rows={2} placeholder="Leave a note for the team…" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!comment.trim()} loading={busy === "comment"} onClick={sendComment}><MessageSquare /> Comment</Button>
            </section>
          ) : null}
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t bg-muted/30 px-5 py-3">
          <Button asChild size="sm"><Link href={brief}><ExternalLink /> Open full brief</Link></Button>
          {!locked ? <Button size="sm" variant="outline" onClick={() => onEdit(post)}><Pencil /> Quick edit</Button> : <span />}
          {!locked && post.production_stage === "idea" ? <Button size="sm" variant="outline" loading={busy === "brief"} onClick={toBrief}><FileText /> Make it a brief</Button> : null}
          {!locked ? <Button size="sm" variant="ghost" onClick={() => onDuplicate(post)}><Copy /> Duplicate</Button> : null}
        </footer>
      </aside>
    </>
  );
}
