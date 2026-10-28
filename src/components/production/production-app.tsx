"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, CheckCheck, Clock, FileText, GripVertical, LayoutGrid, List, Plus, Search, Settings2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/app/page-header";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { canAdmin, canEdit, FUNNEL_LABELS, FUNNEL_STAGES, LANGUAGES, LANGUAGE_LABELS, PLATFORMS, PLATFORM_LABELS, type Language, type WorkspaceRole } from "@/lib/domain/constants";
import { canWriteItem, STAGES, STAGE_LABELS, type ContentTemplate, type ProductionItem, type ProductionStage, type WorkflowSettings } from "@/lib/production/model";
import { addDays } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import type { Assignable } from "@/components/team/task-panel";
import type { WorkspaceMember } from "@/server/services/workspaces";
import { configureWorkflowAction, deleteTemplateAction, transitionProductionAction } from "@/server/actions/production";
import { ProductionEditor } from "./production-editor";

type Props = { projectId: string; projectName: string; language: Language; tz: string; today: string; userId: string; role: WorkspaceRole; members: WorkspaceMember[]; items: ProductionItem[]; templates: ContentTemplate[]; pillars: { id: string; name: string }[]; workflow: WorkflowSettings; aiEnabled: boolean; initialItem?: string; initialView?: string; perms: string[]; people: Assignable[] };
const VIEWS = [{ id: "board", label: "Production Board", icon: LayoutGrid }, { id: "all", label: "All Content", icon: List }, { id: "mine", label: "My Tasks", icon: UserRound }, { id: "review", label: "Review & Approval", icon: CheckCheck }, { id: "templates", label: "Content Templates", icon: FileText }];
const EMPTY_FILTERS = { platform: "", pillar: "", funnel: "", assignee: "", deadline: "", stage: "", language: "", search: "" };
export function ProductionApp(props: Props) {
  const { projectId, items, members, role, userId, today, workflow } = props;
  const router = useRouter();
  const [view, setView] = React.useState(VIEWS.some((v) => v.id === props.initialView) ? props.initialView! : "board");
  const [filters, setFilters] = React.useState(EMPTY_FILTERS);
  const [sort, setSort] = React.useState("deadline");
  const [editor, setEditor] = React.useState<{ item: ProductionItem | null; template?: ContentTemplate } | null>(() => props.initialItem && items.some((i) => i.id === props.initialItem) ? { item: items.find((i) => i.id === props.initialItem)! } : null);
  const [dragging, setDragging] = React.useState<ProductionItem | null>(null);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [removeTemplate, setRemoveTemplate] = React.useState<ContentTemplate | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const label = (s: ProductionStage) => workflow.labels[s] || STAGE_LABELS[s];
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.full_name || (id ? "Team member" : "Unassigned");
  const overdue = (item: ProductionItem) => Boolean(item.due_date && item.due_date < today && !["published", "ready"].includes(item.production_stage));
  const visible = items.filter((i) => {
    if (view === "mine" && i.assignee_id !== userId) return false;
    if (view === "review" && !["internal_review", "approval"].includes(i.production_stage)) return false;
    return (!filters.search || `${i.title} ${i.hook ?? ""} ${i.caption ?? ""}`.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase())) &&
      (!filters.platform || i.platform === filters.platform) && (!filters.pillar || (i.pillar_id || "none") === filters.pillar) &&
      (!filters.funnel || i.funnel_stage === filters.funnel) && (!filters.assignee || (i.assignee_id || "none") === filters.assignee) &&
      (!filters.stage || i.production_stage === filters.stage) && (!filters.language || (i.language || props.language) === filters.language) &&
      (!filters.deadline || (filters.deadline === "overdue" ? overdue(i) : filters.deadline === "none" ? !i.due_date : Boolean(i.due_date && i.due_date >= today && i.due_date <= addDays(today, 7))));
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "updated" ? b.updated_at.localeCompare(a.updated_at) : (a.due_date || "9999").localeCompare(b.due_date || "9999") || b.updated_at.localeCompare(a.updated_at));
  const open = (item: ProductionItem) => { setEditor({ item }); window.history.replaceState(null, "", `?view=${view}&item=${item.id}`); };
  const close = () => { setEditor(null); window.history.replaceState(null, "", `?view=${view}`); router.refresh(); };
  const move = async (event: DragEndEvent) => {
    setDragging(null); const item = items.find((i) => i.id === event.active.id); const stage = event.over?.id as ProductionStage | undefined;
    if (!item || !stage || item.production_stage === stage) return;
    if (stage === "ready" || stage === "published") { toast.info(stage === "ready" ? "Open Review & Approval to record a manager decision." : "Verify the published post from the Editorial Calendar."); return; }
    setMoving(item.id);
    try { const r = await transitionProductionAction(projectId, item.id, item.revision, stage); if (!r.ok) toast.error(r.error); else { toast.success(r.message); router.refresh(); } }
    catch { toast.error("Could not move content. Try again."); } finally { setMoving(null); }
  };
  const filter = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  return <div className="min-w-0 space-y-6">
    <PageHeader title="Content Production" description={`Where ${props.projectName}'s ideas become finished posts: written, reviewed and approved. Use it to see what each item is waiting for.`} actions={<>{props.perms.includes("calendar.view") && <Button asChild variant="outline"><Link href={`/p/${projectId}/calendar`}><CalendarDays /> Calendar</Link></Button>}{canEdit(role) && props.perms.includes("content.create") && <Button onClick={() => setEditor({ item: null })}><Plus /> New content</Button>}</>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      { label: "In production", count: items.filter((i) => ["brief", "in_production"].includes(i.production_stage)).length, icon: FileText },
      { label: "Awaiting review", count: items.filter((i) => ["internal_review", "approval"].includes(i.production_stage)).length, icon: CheckCheck },
      { label: "My open tasks", count: items.filter((i) => i.assignee_id === userId && i.production_stage !== "published").length, icon: UserRound },
      { label: "Overdue", count: items.filter(overdue).length, icon: Clock },
    ].map(({ label: text, count, icon: Icon }) => <div key={text} className="rounded-xl border bg-card px-4 py-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" />{text}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p></div>)}</div>
    <div className="flex items-center gap-2 shadow-[inset_0_-1px_0_var(--border)]"><nav aria-label="Production views" className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">{VIEWS.map(({ id, label: text, icon: Icon }) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); window.history.replaceState(null, "", `?view=${id}`); }} className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors focus-visible:rounded-t-[5px] focus-visible:bg-accent/70 focus-visible:outline-none [&_svg]:size-4", view === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}><Icon />{text}</button>)}</nav>{canAdmin(role) && <Button size="sm" variant="ghost" className="mb-1.5 shrink-0" aria-label="Workflow settings" onClick={() => setSettings(true)}><Settings2 /> <span className="hidden sm:inline">Workflow</span></Button>}</div>
    {view !== "templates" ? <>
      <div className="space-y-3"><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search content" className="pl-9" placeholder="Search titles, hooks and captions…" value={filters.search} onChange={(e) => filter("search", e.target.value)} /></div><NativeSelect aria-label="Sort content" className="w-40" value={sort} onChange={(e) => setSort(e.target.value)}><option value="deadline">Deadline first</option><option value="updated">Recently updated</option><option value="title">Title A–Z</option></NativeSelect></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Filter label="Platform" value={filters.platform} onChange={(v) => filter("platform", v)} options={PLATFORMS.map((p) => [p, PLATFORM_LABELS[p]])} />
        <Filter label="Content pillar" value={filters.pillar} onChange={(v) => filter("pillar", v)} options={[["none", "No pillar"], ...props.pillars.map((p) => [p.id, p.name])]} />
        <Filter label="Funnel stage" value={filters.funnel} onChange={(v) => filter("funnel", v)} options={FUNNEL_STAGES.map((p) => [p, FUNNEL_LABELS[p]])} />
        <Filter label="Assignee" value={filters.assignee} onChange={(v) => filter("assignee", v)} options={[["none", "Unassigned"], ...members.map((m) => [m.user_id, m.full_name || "Team member"])]} />
        <Filter label="Deadline" value={filters.deadline} onChange={(v) => filter("deadline", v)} options={[["overdue", "Overdue"], ["week", "Next 7 days"], ["none", "No deadline"]]} />
        <Filter label="Status" value={filters.stage} onChange={(v) => filter("stage", v)} options={STAGES.map((s) => [s, label(s)])} />
        <Filter label="Language" value={filters.language} onChange={(v) => filter("language", v)} options={LANGUAGES.map((l) => [l, LANGUAGE_LABELS[l]])} />
      </div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{visible.length} content items · Deadlines in {props.tz}</span>{Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}</div></div>
      {view === "board" ? <DndContext id="production-board" sensors={sensors} onDragStart={(e) => setDragging(items.find((i) => i.id === e.active.id) || null)} onDragCancel={() => setDragging(null)} onDragEnd={(e) => void move(e)}><div className="flex gap-3 overflow-x-auto pb-4" aria-label="Production board">{STAGES.map((s) => <Column key={s} stage={s} label={label(s)} count={visible.filter((i) => i.production_stage === s).length}>{visible.filter((i) => i.production_stage === s).map((i) => <ProductionCard key={i.id} item={i} assignee={name(i.assignee_id)} overdue={overdue(i)} disabled={Boolean(moving) || !canWriteItem(role, userId, i) || i.status === "published"} onOpen={() => open(i)} />)}</Column>)}</div><DragOverlay>{dragging && <div className="w-64 rounded-lg border bg-card p-4 shadow-lg">{dragging.title}</div>}</DragOverlay></DndContext>
      : visible.length ? <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Content", "Stage", "Assignee", "Deadline", "Language"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{visible.map((i) => <tr key={i.id} className="border-t hover:bg-muted/30"><td className="min-w-64 px-4 py-3"><button className="text-left font-medium hover:text-primary" onClick={() => open(i)}>{i.title}</button><p className="mt-1 text-xs text-muted-foreground">{i.platform ? PLATFORM_LABELS[i.platform] : "No platform"} · {i.format || "Content"}</p></td><td className="px-4 py-3 text-xs">{label(i.production_stage)}{i.status === "scheduled" && <p>Scheduled {i.scheduled_date}</p>}</td><td className="px-4 py-3 text-xs">{name(i.assignee_id)}</td><td className={cn("whitespace-nowrap px-4 py-3 text-xs", overdue(i) && "text-destructive")}>{i.due_date || "No deadline"}{overdue(i) && " · Overdue"}</td><td className="px-4 py-3 text-xs">{LANGUAGE_LABELS[i.language || props.language]}</td></tr>)}</tbody></table></div>
      : <div className="rounded-xl border border-dashed p-12 text-center"><FileText className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-semibold">{view === "review" ? "The review queue is clear" : view === "mine" ? "No tasks assigned to you here" : "No matching content"}</h2><p className="mt-2 text-sm text-muted-foreground">Create content, adjust filters, or convert an opportunity.</p></div>}
    </> : <div className="space-y-4"><p className="text-sm text-muted-foreground">Save a draft as a template from the editor to reuse its structure, language and creative direction.</p>{props.templates.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{props.templates.map((t) => <div key={t.id} className="space-y-3 rounded-xl border bg-card p-5"><FileText className="size-5 text-muted-foreground" /><h3 className="font-semibold">{t.name}</h3><p className="text-sm text-muted-foreground">{t.description || String(t.body.format || "Content template")}</p><div className="flex gap-2">{canEdit(role) && <Button size="sm" onClick={() => setEditor({ item: null, template: t })}>Use template</Button>}{(canAdmin(role) || (canEdit(role) && t.created_by === userId)) && <Button size="sm" variant="ghost" onClick={() => setRemoveTemplate(t)}>Delete</Button>}</div></div>)}</div> : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No templates yet. Create your first draft, then choose “Save as template”.</div>}</div>}
    {editor && <ProductionEditor key={editor.item?.id || editor.template?.id || "new"} {...props} item={editor.item} template={editor.template} onClose={close} onSaved={(item) => { setEditor({ item }); router.refresh(); }} />}
    {settings && <WorkflowDialog projectId={projectId} initial={workflow} onClose={() => setSettings(false)} />}
    {removeTemplate && <Dialog open onOpenChange={() => setRemoveTemplate(null)}><DialogContent><DialogHeader><DialogTitle>Delete “{removeTemplate.name}”?</DialogTitle><DialogDescription>Existing content made from this template will remain available.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoveTemplate(null)}>Cancel</Button><Button variant="destructive" onClick={async () => { const r = await deleteTemplateAction(projectId, removeTemplate.id); if (!r.ok) toast.error(r.error); else { setRemoveTemplate(null); router.refresh(); } }}>Delete template</Button></div></DialogContent></Dialog>}
  </div>;
}
function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) { return <label className="space-y-1 text-xs text-muted-foreground"><span>{label}</span><NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="text-foreground"><option value="">All</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></label>; }
function Column({ stage, label, count, children }: { stage: ProductionStage; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return <section ref={setNodeRef} className={cn("min-h-80 w-64 shrink-0 rounded-xl border bg-muted/25 p-2 transition-colors", isOver && "border-primary bg-primary/5")}><header className="flex items-center justify-between gap-2 px-2 py-3"><h2 className="text-xs font-semibold">{label}</h2><span className="rounded bg-background px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span></header><div className="space-y-2">{children}{!count && <p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">{stage === "published" ? "Confirmed publications appear here" : "No content in this stage"}</p>}</div></section>;
}
function ProductionCard({ item, assignee, overdue, disabled, onOpen }: { item: ProductionItem; assignee: string; overdue: boolean; disabled: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled });
  return <article ref={setNodeRef} className={cn("rounded-lg border bg-card p-3 shadow-xs", isDragging && "opacity-30")}><div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><PlatformIcon platform={item.platform} /><span className="flex-1 truncate">{item.format || "Content"}</span><button {...attributes} {...listeners} disabled={disabled} aria-label={`Move ${item.title}`} className="touch-none rounded p-1 hover:bg-muted"><GripVertical className="size-4" /></button></div><button onClick={onOpen} className="w-full text-left text-sm font-semibold leading-5 hover:text-primary">{item.title}</button>{item.hook && <p dir="auto" className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.hook}</p>}<div className="mt-4 space-y-2 border-t pt-2 text-[11px] text-muted-foreground"><p className="flex items-center gap-1.5"><UserRound className="size-3" />{assignee}</p><div className="flex items-center justify-between gap-1"><span className={cn(overdue && "font-medium text-destructive")}>{item.due_date ? `${overdue ? "Overdue · " : "Due "}${item.due_date}` : "No deadline"}</span><span>{item.language?.toUpperCase()}</span></div>{item.status === "scheduled" && <p>Scheduled · {item.scheduled_date}</p>}</div></article>;
}
function WorkflowDialog({ projectId, initial, onClose }: { projectId: string; initial: WorkflowSettings; onClose: () => void }) {
  const [value, setValue] = React.useState(initial); const [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Production workflow</DialogTitle><DialogDescription>Rename stages for your team. Final approval always requires an owner or administrator.</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-3 overflow-y-auto">{STAGES.map((s) => <label key={s} className="block space-y-1 text-xs">{STAGE_LABELS[s]}<Input maxLength={45} value={value.labels[s] ?? STAGE_LABELS[s]} onChange={(e) => setValue({ ...value, labels: { ...value.labels, [s]: e.target.value } })} /></label>)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.require_internal_review} onChange={(e) => setValue({ ...value, require_internal_review: e.target.checked })} /> Require internal review before manager approval</label></div><Button disabled={busy} onClick={async () => { setBusy(true); const r = await configureWorkflowAction(projectId, value); setBusy(false); if (!r.ok) toast.error(r.error); else { toast.success(r.message); onClose(); } }}>Save workflow</Button></DialogContent></Dialog>;
}
