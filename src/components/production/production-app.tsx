"use client";
import { CreatedBy } from "@/components/backlog/created-by";
import { AudienceBadge, AudienceFilter } from "@/components/app/audience-badge";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, CheckCheck, CheckCircle2, Clock, FileText, GripVertical, LayoutGrid, List, Plus, Search, Send, Settings2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/app/page-header";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { canAdmin, canEdit, FUNNEL_STAGES, LANGUAGES, PLATFORMS, type Language, type WorkspaceRole } from "@/lib/domain/constants";
import { BOARD, canWriteItem, columnOf, type ContentTemplate, type ProductionItem, type ProductionStage, type WorkflowSettings } from "@/lib/production/model";
import { addDays } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import type { Assignable } from "@/components/team/task-panel";
import type { WorkspaceMember } from "@/server/services/workspaces";
import { configureWorkflowAction, deleteTemplateAction, transitionProductionAction } from "@/server/actions/production";
import { ProductionEditor } from "./production-editor";
import { PublishDialog } from "@/components/calendar/publish-dialog";
import { BackToBacklogBar, SelectAllBox, useSelection } from "@/components/backlog/selection-bar";
import { useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";

type Props = { projectId: string; projectName: string; language: Language; tz: string; today: string; userId: string; role: WorkspaceRole; members: WorkspaceMember[]; items: ProductionItem[]; templates: ContentTemplate[]; pillars: { id: string; name: string }[]; workflow: WorkflowSettings; aiEnabled: boolean; initialItem?: string; initialView?: string; perms: string[]; people: Assignable[] };
const VIEWS = [{ id: "board", icon: LayoutGrid }, { id: "all", icon: List }, { id: "mine", icon: UserRound }, { id: "review", icon: CheckCheck }, { id: "templates", icon: FileText }] as const;
const EMPTY_FILTERS = { platform: "", pillar: "", funnel: "", assignee: "", deadline: "", stage: "", language: "", search: "", audience: "" };
export function ProductionApp(props: Props) {
  const { projectId, items, members, role, userId, today, workflow } = props;
  const router = useRouter();
  const t = useT("production"); const td = useT("domain");
  // domain.platform has an "other" key, which the key type reads as a plural leaf: look platform names up by string
  const platformName = (p: string) => (td as (key: string) => string)(`platform.${p}`); const tc = useT("common");
  const [view, setView] = React.useState<string>(VIEWS.some((v) => v.id === props.initialView) ? props.initialView! : "board");
  const [filters, setFilters] = React.useState(EMPTY_FILTERS);
  const [sort, setSort] = React.useState("deadline");
  const [editor, setEditor] = React.useState<{ item: ProductionItem | null; template?: ContentTemplate } | null>(() => props.initialItem && items.some((i) => i.id === props.initialItem) ? { item: items.find((i) => i.id === props.initialItem)! } : null);
  const [dragging, setDragging] = React.useState<ProductionItem | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [removeTemplate, setRemoveTemplate] = React.useState<ContentTemplate | null>(null);
  const [publishing, setPublishing] = React.useState<ProductionItem | null>(null);
  // Done content is approved: it can be published straight from the board, with the same dialog and rules as the calendar
  const canPublish = (i: ProductionItem) => canEdit(role) && props.perms.includes("calendar.edit") && i.production_stage === "ready" && ["approved", "scheduled"].includes(i.status);
  const selection = useSelection();
  // ideas and briefs placed on the calendar can go back to the Backlog (scheduled and published posts can't)
  // Same rule as the editor and the database: "edit any content" lets editors move cards they don't own.
  const canWrite = (i: ProductionItem) => canWriteItem(role, userId, i, { editAny: props.perms.includes("content.edit_any") });
  const canUnplan = (i: ProductionItem) => Boolean(i.scheduled_date) && !["published", "scheduled"].includes(i.status) && canWrite(i);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const label = (s: ProductionStage) => workflow.labels[s] || t(`stage.${s}`);
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.full_name || (id ? t("people.teamMember") : t("people.unassigned"));
  const overdue = (item: ProductionItem) => Boolean(item.due_date && item.due_date < today && !["published", "ready"].includes(item.production_stage));
  const visible = items.filter((i) => {
    if (view === "mine" && i.assignee_id !== userId) return false;
    if (view === "review" && !["internal_review", "approval"].includes(i.production_stage)) return false;
    return (!filters.search || `${i.title} ${i.hook ?? ""} ${i.caption ?? ""}`.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase())) &&
      (!filters.platform || i.platform === filters.platform) && (!filters.pillar || (i.pillar_id || "none") === filters.pillar) &&
      (!filters.funnel || i.funnel_stage === filters.funnel) && (!filters.assignee || (i.assignee_id || "none") === filters.assignee) &&
      (!filters.stage || columnOf(i.production_stage) === filters.stage) && (!filters.language || (i.language || props.language) === filters.language) &&
      (!filters.audience || (i.audience ?? "none") === filters.audience) &&
      (!filters.deadline || (filters.deadline === "overdue" ? overdue(i) : filters.deadline === "none" ? !i.due_date : Boolean(i.due_date && i.due_date >= today && i.due_date <= addDays(today, 7))));
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "updated" ? b.updated_at.localeCompare(a.updated_at) : (a.due_date || "9999").localeCompare(b.due_date || "9999") || b.updated_at.localeCompare(a.updated_at));
  const open = (item: ProductionItem) => { setEditor({ item }); window.history.replaceState(null, "", `?view=${view}&item=${item.id}`); };
  const close = () => { setEditor(null); window.history.replaceState(null, "", `?view=${view}`); router.refresh(); };
  const move = async (event: DragEndEvent) => {
    setDragging(null); const item = items.find((i) => i.id === event.active.id); const stage = event.over?.id as ProductionStage | undefined;
    if (!item || !stage || columnOf(item.production_stage) === stage) return;
    setMoving(item.id);
    try { const r = await transitionProductionAction(projectId, item.id, item.revision, stage); if (!r.ok) toast.error(r.error); else { toast.success(r.message); router.refresh(); } }
    catch { toast.error(t("app.moveError")); } finally { setMoving(null); }
  };
  const filter = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  return <div className="min-w-0 space-y-6">
    <PageHeader title={t("app.title")} description={t("app.description", { project: props.projectName })} actions={<>{props.perms.includes("calendar.view") && <Button asChild variant="outline"><Link href={`/p/${projectId}/calendar`}><CalendarDays /> {t("app.calendar")}</Link></Button>}{canEdit(role) && props.perms.includes("content.create") && <Button asChild variant="outline"><Link href={`/p/${projectId}/backlog`}><Plus /> {t("app.newIdea")}</Link></Button>}</>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      { label: t("app.stats.inProduction"), count: items.filter((i) => ["brief", "in_production"].includes(i.production_stage)).length, icon: FileText },
      { label: t("app.stats.awaitingReview"), count: items.filter((i) => ["internal_review", "approval"].includes(i.production_stage)).length, icon: CheckCheck },
      { label: t("app.stats.myOpenTasks"), count: items.filter((i) => i.assignee_id === userId && i.production_stage !== "published").length, icon: UserRound },
      { label: t("app.stats.overdue"), count: items.filter(overdue).length, icon: Clock },
    ].map(({ label: text, count, icon: Icon }) => <div key={text} className="rounded-xl border bg-card px-4 py-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{text}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p></div>)}</div>
    <div className="flex items-center gap-2 shadow-[inset_0_-1px_0_var(--border)]"><nav aria-label={t("app.viewsLabel")} className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">{VIEWS.map(({ id, icon: Icon }) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); window.history.replaceState(null, "", `?view=${id}`); }} className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors focus-visible:rounded-t-[5px] focus-visible:bg-accent/70 focus-visible:outline-none [&_svg]:size-4", view === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon />{t(`app.views.${id}`)}</button>)}</nav>{canAdmin(role) && <Button size="sm" variant="ghost" className="mb-1.5 shrink-0" aria-label={t("app.workflowSettings")} onClick={() => setSettings(true)}><Settings2 /> <span className="hidden sm:inline">{t("app.workflow")}</span></Button>}</div>
    {view !== "templates" ? <>
      <div className="space-y-3"><div className="flex gap-2"><AudienceFilter className="w-40" value={filters.audience} onChange={(v) => filter("audience", v)} /><div className="relative flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={t("app.searchLabel")} className="pl-9" placeholder={t("app.searchPlaceholder")} value={filters.search} onChange={(e) => filter("search", e.target.value)} /></div><NativeSelect aria-label={t("app.sortLabel")} className="w-40" value={sort} onChange={(e) => setSort(e.target.value)}><option value="deadline">{t("app.sort.deadline")}</option><option value="updated">{t("app.sort.updated")}</option><option value="title">{t("app.sort.title")}</option></NativeSelect></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Filter label={t("app.filters.platform")} allLabel={tc("states.all")} value={filters.platform} onChange={(v) => filter("platform", v)} options={PLATFORMS.map((p) => [p, platformName(p)])} />
        <Filter label={t("app.filters.pillar")} allLabel={tc("states.all")} value={filters.pillar} onChange={(v) => filter("pillar", v)} options={[["none", t("app.filters.noPillar")], ...props.pillars.map((p) => [p.id, p.name])]} />
        <Filter label={t("app.filters.funnel")} allLabel={tc("states.all")} value={filters.funnel} onChange={(v) => filter("funnel", v)} options={FUNNEL_STAGES.map((p) => [p, td(`funnel.${p}`)])} />
        <Filter label={t("app.filters.assignee")} allLabel={tc("states.all")} value={filters.assignee} onChange={(v) => filter("assignee", v)} options={[["none", t("people.unassigned")], ...members.map((m) => [m.user_id, m.full_name || t("people.teamMember")])]} />
        <Filter label={t("app.filters.deadline")} allLabel={tc("states.all")} value={filters.deadline} onChange={(v) => filter("deadline", v)} options={[["overdue", t("app.filters.overdue")], ["week", t("app.filters.nextWeek")], ["none", t("app.filters.noDeadline")]]} />
        <Filter label={t("app.filters.status")} allLabel={tc("states.all")} value={filters.stage} onChange={(v) => filter("stage", v)} options={BOARD.map((s) => [s, label(s)])} />
        <Filter label={t("app.filters.language")} allLabel={tc("states.all")} value={filters.language} onChange={(v) => filter("language", v)} options={LANGUAGES.map((l) => [l, td(`language.${l}`)])} />
      </div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t("app.count", { count: visible.length, tz: props.tz })}</span>{Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>{t("app.clearFilters")}</Button>}</div></div>
      {view === "board" ? <DndContext id="production-board" sensors={sensors} onDragStart={(e) => setDragging(items.find((i) => i.id === e.active.id) || null)} onDragCancel={() => setDragging(null)} onDragEnd={(e) => void move(e)}><div className="flex gap-3 overflow-x-auto pb-4" aria-label={t("app.boardLabel")}>{BOARD.map((s) => <Column key={s} stage={s} label={label(s)} count={visible.filter((i) => columnOf(i.production_stage) === s).length}>{visible.filter((i) => columnOf(i.production_stage) === s).map((i) => <ProductionCard creatorName={(id) => members.find((m) => m.user_id === id)?.full_name} key={i.id} t={t} item={i} assignee={name(i.assignee_id)} overdue={overdue(i)} disabled={Boolean(moving) || !canWrite(i) || i.status === "published"} onOpen={() => open(i)} onPublish={canPublish(i) ? () => setPublishing(i) : undefined} />)}</Column>)}</div><DragOverlay>{dragging && <div className="w-64 rounded-lg border bg-card p-4 shadow-lg">{dragging.title}</div>}</DragOverlay></DndContext>
      : visible.length ? <>{canEdit(role) && <BackToBacklogBar projectId={projectId} ids={visible.filter((i) => selection.selected.has(i.id)).map((i) => i.id)} onClear={selection.clear} />}<div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{canEdit(role) && <th className="w-8 py-3 pl-4"><SelectAllBox ids={visible.filter(canUnplan).map((i) => i.id)} selected={selection.selected} onChange={(on) => selection.setAll(visible.filter(canUnplan).map((i) => i.id), on)} label={t("app.selectAllOnCalendar")} /></th>}{(["content", "stage", "assignee", "deadline", "publication", "language"] as const).map((h) => <th key={h} className="px-4 py-3 font-medium">{t(`app.columns.${h}`)}</th>)}</tr></thead><tbody>{visible.map((i) => <tr key={i.id} className={cn("border-t hover:bg-muted/30", selection.selected.has(i.id) && "bg-primary-soft/40")}>{canEdit(role) && <td className="w-8 py-3 pl-4">{canUnplan(i) && <input type="checkbox" aria-label={t("app.selectItem", { title: i.title })} checked={selection.selected.has(i.id)} onChange={() => selection.toggle(i.id)} />}</td>}<td className="min-w-64 px-4 py-3"><button className="text-left font-medium hover:text-primary" onClick={() => open(i)}>{i.title}</button><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><AudienceBadge audience={i.audience} />{i.platform ? platformName(i.platform) : t("app.noPlatform")} · {i.format || t("app.contentFallback")}</p></td><td className="px-4 py-3 text-xs">{label(i.production_stage)}{i.status === "scheduled" && <p>{t("app.scheduledDate", { date: i.scheduled_date })}</p>}</td><td className="px-4 py-3 text-xs">{name(i.assignee_id)}</td><td className={cn("whitespace-nowrap px-4 py-3 text-xs", overdue(i) && "text-destructive")}>{i.due_date ? (overdue(i) ? t("app.dueOverdue", { date: i.due_date }) : i.due_date) : t("app.noDeadline")}</td><td className="whitespace-nowrap px-4 py-3 text-xs">{i.scheduled_date || <span className="text-muted-foreground">{t("app.inBacklog")}</span>}</td><td className="px-4 py-3 text-xs">{td(`language.${i.language || props.language}`)}</td></tr>)}</tbody></table></div></>
      : <div className="rounded-xl border border-dashed p-12 text-center"><FileText className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-semibold">{view === "review" ? t("app.empty.review") : view === "mine" ? t("app.empty.mine") : t("app.empty.none")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("app.empty.body")}</p></div>}
    </> : <div className="space-y-4"><p className="text-sm text-muted-foreground">{t("app.templates.intro")}</p>{props.templates.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{props.templates.map((tpl) => <div key={tpl.id} className="space-y-3 rounded-xl border bg-card p-5"><FileText className="size-5 text-muted-foreground" /><h3 className="font-semibold">{tpl.name}</h3><p className="text-sm text-muted-foreground">{tpl.description || String(tpl.body.format || t("app.templates.fallback"))}</p><div className="flex gap-2">{canEdit(role) && <Button size="sm" onClick={() => setEditor({ item: null, template: tpl })}>{t("app.templates.use")}</Button>}{(canAdmin(role) || (canEdit(role) && tpl.created_by === userId)) && <Button size="sm" variant="ghost" onClick={() => setRemoveTemplate(tpl)}>{tc("actions.delete")}</Button>}</div></div>)}</div> : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t("app.templates.empty")}</div>}</div>}
    {editor && <ProductionEditor key={editor.item?.id || editor.template?.id || "new"} {...props} item={editor.item} template={editor.template} onClose={close} onSaved={(item) => { setEditor({ item }); router.refresh(); }} />}
    {publishing && <PublishDialog projectId={projectId} post={publishing} tz={props.tz} onClose={() => { setPublishing(null); router.refresh(); }} onPublished={() => router.refresh()} />}
    {settings && <WorkflowDialog projectId={projectId} initial={workflow} onClose={() => setSettings(false)} />}
    {removeTemplate && <Dialog open onOpenChange={() => setRemoveTemplate(null)}><DialogContent><DialogHeader><DialogTitle>{t("app.deleteTemplate.title", { name: removeTemplate.name })}</DialogTitle><DialogDescription>{t("app.deleteTemplate.description")}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoveTemplate(null)}>{tc("actions.cancel")}</Button><Button variant="destructive" onClick={async () => { const r = await deleteTemplateAction(projectId, removeTemplate.id); if (!r.ok) toast.error(r.error); else { setRemoveTemplate(null); router.refresh(); } }}>{t("app.deleteTemplate.confirm")}</Button></div></DialogContent></Dialog>}
  </div>;
}
function Filter({ label, allLabel, value, onChange, options }: { label: string; allLabel: string; value: string; onChange: (v: string) => void; options: string[][] }) { return <label className="space-y-1 text-xs text-muted-foreground"><span>{label}</span><NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="text-foreground"><option value="">{allLabel}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></label>; }
function Column({ stage, label, count, children }: { stage: ProductionStage; label: string; count: number; children: React.ReactNode }) {
  const t = useT("production");
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return <section ref={setNodeRef} className={cn("min-h-80 w-64 shrink-0 rounded-xl border bg-muted/25 p-2 transition-colors", isOver && "border-primary bg-primary/5")}><header className="flex items-center justify-between gap-2 px-2 py-3"><h2 className="text-xs font-semibold">{label}</h2><span className="rounded bg-background px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span></header><div className="space-y-2">{children}{!count && <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">{stage === "ready" ? t("app.column.dropHere") : t("app.column.empty")}</p>}</div></section>;
}
function ProductionCard({ t, item, assignee, creatorName, overdue, disabled, onOpen, onPublish }: { t: TFor<"production">; item: ProductionItem; assignee: string; creatorName: (userId: string) => string | null | undefined; overdue: boolean; disabled: boolean; onOpen: () => void; onPublish?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled });
  return <article ref={setNodeRef} className={cn("rounded-lg border bg-card p-3 shadow-xs", isDragging && "opacity-30")}><div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><PlatformIcon platform={item.platform} /><span className="flex-1 truncate">{item.format || t("app.contentFallback")}</span><button {...attributes} {...listeners} disabled={disabled} aria-label={t("app.card.move", { title: item.title })} className="touch-none rounded p-1 hover:bg-muted"><GripVertical className="size-4" /></button></div><button onClick={onOpen} className="w-full text-left text-sm font-semibold leading-5 hover:text-primary">{item.title}</button><AudienceBadge audience={item.audience} className="mt-1.5" />{item.hook && <p dir="auto" className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.hook}</p>}<div className="mt-4 space-y-2 border-t pt-2 text-[11px] text-muted-foreground"><p className="flex items-center gap-1.5"><UserRound className="size-3 shrink-0" /><span className="min-w-0 flex-1 truncate">{assignee}</span><CreatedBy item={item} name={creatorName} /></p><div className="flex items-center justify-between gap-1"><span className={cn(overdue && "font-medium text-destructive")}>{item.due_date ? (overdue ? t("app.card.overdue", { date: item.due_date }) : t("app.card.due", { date: item.due_date })) : t("app.noDeadline")}</span><span>{item.language?.toUpperCase()}</span></div>{item.status === "scheduled" && <p>{t("app.card.scheduled", { date: item.scheduled_date })}</p>}{item.status === "published" && <p className="flex items-center gap-1.5 font-medium text-success"><CheckCircle2 className="size-3" />{t("app.card.published")}</p>}</div>{onPublish && <Button size="sm" className="mt-2 w-full" onClick={onPublish}><Send /> {item.status === "scheduled" ? t("app.card.publishStatus") : t("app.card.publish")}</Button>}</article>;
}
function WorkflowDialog({ projectId, initial, onClose }: { projectId: string; initial: WorkflowSettings; onClose: () => void }) {
  const t = useT("production");
  const [value, setValue] = React.useState(initial); const [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>{t("app.workflowDialog.title")}</DialogTitle><DialogDescription>{t("app.workflowDialog.description")}</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-3 overflow-y-auto">{BOARD.map((s) => <label key={s} className="block space-y-1 text-xs">{t(`stage.${s}`)}<Input maxLength={45} value={value.labels[s] ?? t(`stage.${s}`)} onChange={(e) => setValue({ ...value, labels: { ...value.labels, [s]: e.target.value } })} /></label>)}</div><Button disabled={busy} onClick={async () => { setBusy(true); const r = await configureWorkflowAction(projectId, value); setBusy(false); if (!r.ok) toast.error(r.error); else { toast.success(r.message); onClose(); } }}>{t("app.workflowDialog.save")}</Button></DialogContent></Dialog>;
}
