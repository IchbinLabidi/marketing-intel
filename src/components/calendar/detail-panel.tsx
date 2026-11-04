"use client";

import { AudienceSelect } from "@/components/app/audience-badge";
import { setAudienceTagAction } from "@/server/actions/backlog";
import { PublishedPerformanceBlock } from "./published-performance";
import * as React from "react";
import Link from "next/link";
import { CalendarClock, Copy, ExternalLink, FileText, Flag, MessageSquare, Pencil, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PRIORITIES } from "@/lib/permissions";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { updatePlanningAction } from "@/server/actions/calendar";
import { commentProductionAction, transitionProductionAction } from "@/server/actions/production";
import type { Task } from "@/server/services/team";
import type { ContentItem } from "@/types/domain";
import { PersonChip, TaskStatusBadge } from "@/components/team/task-badges";
import { PlatformIcon } from "./platform-icon";
import { PublishDialog } from "./publish-dialog";
import { StatePill, stateOf } from "./post-card";
import { contentType, domainLabel, isOverdue, type Person } from "./planning";

/**
 * Side panel for one calendar item: everything needed to plan it without leaving the calendar.
 * Publication date (when it goes live) and the internal deadline (when the work is due) are edited separately.
 */
export function DetailPanel({
  projectId, post, time, tz, tasks, people, perms, userId, today, readOnly, onClose, onChanged, onMove, onDuplicate, onEdit,
}: {
  projectId: string;
  tz: string;
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
  const t = useT("calendar");
  const tc = useT("common");
  const td = useT("domain");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  const [date, setDate] = React.useState(post.scheduled_date ?? "");
  const [slot, setSlot] = React.useState(time ?? "");
  const [comment, setComment] = React.useState("");
  const panelRef = React.useRef<HTMLElement>(null);
  const canAssign = perms.has("content.assign");
  const state = stateOf(post);
  const locked = readOnly || state === "published";
  const overdue = isOverdue(post, today);
  const lead = post.assignee_id ? people.get(post.assignee_id) : null;
  const itemTasks = tasks.filter((x) => x.content_item_id === post.id);
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
    toast.success(t("detail.converted"));
  };

  const sendComment = async () => {
    setBusy("comment");
    const r = await commentProductionAction(projectId, post.id, comment, []);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setComment("");
    toast.success(t("detail.commentAdded"));
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-overlay/40 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t("detail.aria", { title: post.title })}
        className="scrollbar-thin fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l bg-card shadow-lg outline-none animate-fade-in"
      >
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PlatformIcon platform={post.platform} />
              {post.platform && td.has(`platform.${post.platform}`) ? domainLabel(td, "platform", post.platform) : t("detail.noPlatform")} · {contentType(post.format, t)}
            </p>
            <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em]" dir="auto">{post.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatePill state={state} />
              <AudienceSelect value={post.audience} disabled={readOnly} onChange={async (a) => {
                const r = await setAudienceTagAction(projectId, [post.id], a);
                if (!r.ok) return void toast.error(r.error);
                onChanged({ ...post, audience: a });
              }} />
              {post.production_stage ? <Badge variant="outline">{t(`stage.${post.production_stage}`)}</Badge> : null}
              {overdue ? <Badge variant="destructive" dot>{t("detail.overdue")}</Badge> : null}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t("detail.close")} onClick={onClose}><X /></Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Two different dates, edited separately */}
          <section className="grid gap-3">
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium"><CalendarClock className="size-3.5 text-primary" /> {t("detail.publication")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("detail.publicationHint")}</p>
              <div className="mt-2 grid grid-cols-[1fr_6.5rem_auto] gap-2">
                <Input type="date" aria-label={t("detail.publicationDate")} value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} className="h-8 text-[13px]" />
                <Input type="time" aria-label={t("detail.publicationTime")} value={slot} disabled={locked} onChange={(e) => setSlot(e.target.value)} className="h-8 text-[13px]" />
                <Button size="sm" variant="outline" disabled={locked || !date || (date === post.scheduled_date && (slot || null) === time)} onClick={() => onMove(post, date, slot || null)}>{t("detail.move")}</Button>
              </div>
            </div>
            <div className={cn("rounded-lg border p-3", overdue && "border-destructive/40 bg-destructive/5")}>
              <p className="flex items-center gap-1.5 text-xs font-medium"><Flag className={cn("size-3.5", overdue ? "text-destructive" : "text-warning")} /> {t("detail.deadline")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("detail.deadlineHint")}</p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="date"
                  aria-label={t("detail.deadline")}
                  defaultValue={post.due_date ?? ""}
                  disabled={locked || busy === "deadline"}
                  // Saves as soon as a complete date is picked (date inputs only report full dates).
                  onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== post.due_date) void plan({ due_date: v }, "deadline"); }}
                  className="h-8 text-[13px]"
                />
                {post.due_date && !locked ? <Button size="sm" variant="ghost" onClick={() => plan({ due_date: null }, "deadline")}>{tc("actions.clear")}</Button> : null}
              </div>
            </div>
          </section>

          {state === "published" && post.historical_source_id ? <PublishedPerformanceBlock projectId={projectId} itemId={post.id} /> : null}

          <section className="space-y-3">
            <h3 className="eyebrow">{t("detail.ownerPriority")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-medium">
                {t("detail.lead")}
                <NativeSelect className="h-8 text-[13px]" value={post.assignee_id ?? ""} disabled={locked || !canAssign || busy === "assignee"} onChange={(e) => plan({ assignee_id: e.target.value || null }, "assignee")}>
                  <option value="">{t("people.unassigned")}</option>
                  {[...people.values()].filter((p) => p.canEdit).map((p) => <option key={p.user_id} value={p.user_id}>{p.name || t("people.unnamed")}{p.roleName ? ` — ${p.roleName}` : ""}</option>)}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                {t("detail.priority")}
                <NativeSelect className="h-8 text-[13px]" value={post.priority ?? "medium"} disabled={locked || !canAssign || busy === "priority"} onChange={(e) => plan({ priority: e.target.value }, "priority")}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{td(`priority.${p}`)}</option>)}
                </NativeSelect>
              </label>
            </div>
            {lead ? <p className="text-xs text-muted-foreground">{lead.user_id === userId ? t("detail.youLead") : t("detail.ledBy", { name: lead.name })}</p> : null}
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">{t("detail.collaborators")}</h3>
            {itemTasks.length ? (
              <ul className="space-y-2">
                {itemTasks.map((task) => {
                  const p = people.get(task.user_id);
                  return (
                    <li key={task.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <PersonChip name={p?.name ?? t("people.formerMember")} role={task.due_date ? t("detail.taskDue", { type: domainLabel(td, "taskType", task.task_type), date: task.due_date }) : domainLabel(td, "taskType", task.task_type)} />
                      <TaskStatusBadge status={task.status} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("detail.noCollaborators")}</p>
            )}
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href={`${brief}`}>{canAssign ? t("detail.assign") : t("detail.openTasks")}</Link>
            </Button>
            {itemTasks.some((x) => x.status === "in_review") ? (
              <p className="text-xs font-medium text-primary">
                {t("detail.awaitingApproval", { list: itemTasks.filter((x) => x.status === "in_review").map((x) => domainLabel(td, "taskType", x.task_type)).join(", ") })}
              </p>
            ) : null}
          </section>

          {post.creative_brief || post.hook ? (
            <section className="space-y-1.5">
              <h3 className="eyebrow">{t("detail.brief")}</h3>
              <p className="line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground" dir="auto">{post.creative_brief || post.hook}</p>
            </section>
          ) : null}

          {!readOnly ? (
            <section className="space-y-2">
              <h3 className="eyebrow">{t("detail.comment")}</h3>
              <Textarea rows={2} placeholder={t("detail.commentPlaceholder")} value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!comment.trim()} loading={busy === "comment"} onClick={sendComment}><MessageSquare /> {t("detail.comment")}</Button>
            </section>
          ) : null}
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t bg-muted/30 px-5 py-3">
          <Button asChild size="sm"><Link href={brief}><ExternalLink /> {t("detail.openBrief")}</Link></Button>
          {!locked ? <Button size="sm" variant="outline" onClick={() => onEdit(post)}><Pencil /> {t("detail.quickEdit")}</Button> : <span />}
          {!locked && post.production_stage === "idea" ? <Button size="sm" variant="outline" loading={busy === "brief"} onClick={toBrief}><FileText /> {t("detail.makeBrief")}</Button> : null}
          {!locked ? <Button size="sm" variant="ghost" onClick={() => onDuplicate(post)}><Copy /> {tc("actions.duplicate")}</Button> : null}
          {!locked && (post.status === "approved" || post.status === "scheduled") && ["facebook", "instagram"].includes(post.platform ?? "") ? <Button size="sm" onClick={() => setPublishing(true)}><Send /> {t("detail.publish")}</Button> : null}
        </footer>
      </aside>
      {publishing ? <PublishDialog projectId={projectId} post={post} tz={tz} onClose={() => setPublishing(false)} onPublished={() => onChanged(post)} /> : null}
    </>
  );
}
