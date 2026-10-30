"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  Archive, ArchiveRestore, Bookmark, CalendarPlus, Columns3, Copy, Eye, Filter, LayoutGrid, List, Loader2, MoreHorizontal, Plus, Search,
  Send, SlidersHorizontal, Sparkles, Tag, Trash2, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { CRITERIA, normalizeWeights, scoreBand, type Weights } from "@/lib/backlog/score";
import { ALL_CONVERSIONS, goalsFor, SEGMENTS, SEGMENT_LABELS, SIDE_LABELS, type AudienceMix, type Side } from "@/lib/backlog/audience";
import { FORMATS, STAGE_LABELS, type ProductionStage } from "@/lib/production/model";
import { cn } from "@/lib/utils";
import {
  archiveIdeasAction, createIdeaAction, deleteIdeasAction, deletePresetAction, duplicateIdeaAction, listIdeasAction, refreshSuggestionsAction,
  saveScoreWeightsAction, savePresetAction, scoreIdeasAction, sendToProductionAction, setAudienceAction, setPriorityAction, suggestAudienceAction, tagIdeasAction, unplanIdeasAction,
  type FilterPreset,
} from "@/server/actions/backlog";
import type { BacklogFilters, Idea } from "@/server/services/backlog";
import { IdeaDetail, lifecycleOf } from "./idea-detail";
import { ScheduleDialog, slotLabel } from "./schedule-dialog";
import { PlannerDialog } from "./planner-dialog";

type View = "list" | "cards" | "kanban";
const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const PLATFORM_CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
const DEFAULT_FILTERS: BacklogFilters = { planning: "backlog", sort: "score" };
const scoreTone = (s: number | null) => ({ high: "success", good: "info", fair: "warning", low: "destructive", unscored: "outline" } as const)[scoreBand(s)];

export function BacklogApp(props: {
  projectId: string; projectName: string; tz: string; canEdit: boolean; canAdmin: boolean;
  initial: { ideas: Idea[]; total: number }; pillars: { id: string; name: string; segment?: string; target_share?: number | null }[]; tags: string[]; presets: FilterPreset[]; audienceMix: AudienceMix | null;
  weights: Weights; aiEnabled: boolean; today: string;
}) {
  const { projectId, tz, canEdit } = props;
  const router = useRouter();
  const [view, setView] = React.useState<View>(() => { try { return (localStorage.getItem("backlog.view") as View) || "cards"; } catch { return "cards"; } });
  const [filters, setFilters] = React.useState<BacklogFilters>(DEFAULT_FILTERS);
  const [data, setData] = React.useState(props.initial);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<Idea | null>(null);
  const [place, setPlace] = React.useState<{ idea: Idea; date?: string; time?: string } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [presets, setPresets] = React.useState(props.presets);
  const [weightsOpen, setWeightsOpen] = React.useState(false);
  const [planning, setPlanning] = React.useState(false);
  const pillarName = (id: string | null) => props.pillars.find((p) => p.id === id)?.name ?? null;

  const load = React.useCallback(async (f: BacklogFilters, p = 0) => {
    setLoading(true);
    const r = await listIdeasAction(projectId, f, p);
    setLoading(false);
    if (!r.ok) return void toast.error(r.error);
    setData((cur) => (p === 0 ? r.data! : { ideas: [...cur.ideas, ...r.data!.ideas], total: r.data!.total }));
    setPage(p);
  }, [projectId]);
  // filters reload from the server (debounced for typing); the first render uses the server-rendered page
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { void load(filters, 0); setSelected(new Set()); }, 250);
    return () => clearTimeout(t);
  }, [filters, load]);
  const setF = (patch: Partial<BacklogFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const reload = async () => { await load(filters, 0); router.refresh(); };
  const changed = async (patch: Partial<Idea> & { id: string }) => {
    setData((d) => ({ ...d, ideas: d.ideas.map((i) => (i.id === patch.id ? { ...i, ...patch } : i)) }));
    await load(filters, 0);
    setOpen((o) => (o && o.id === patch.id ? { ...o, ...patch } : o));
  };
  // the open idea follows reloads of the list
  const current = open ? data.ideas.find((i) => i.id === open.id) ?? open : null;
  const chooseView = (v: View) => { setView(v); try { localStorage.setItem("backlog.view", v); } catch { /* private mode */ } };

  const ids = [...selected];
  const bulk = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Done");
    setSelected(new Set());
    await reload();
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const activeCount = Object.entries(filters).filter(([k, v]) => !["sort", "planning"].includes(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length)).length;

  const actions = (i: Idea) => ({
    preview: () => setOpen(i),
    place: () => setPlace({ idea: i }),
    production: () => bulk("production", () => sendToProductionAction(projectId, [i.id])),
    duplicate: () => bulk("dup", () => duplicateIdeaAction(projectId, i.id)),
    archive: () => bulk("archive", () => archiveIdeasAction(projectId, [i.id], !i.archived_at)),
    unplan: () => bulk("unplan", () => unplanIdeasAction(projectId, [i.id])),
    remove: async () => { if (await confirm({ title: `Delete “${i.title}”?`, description: "The idea and its stored files are deleted permanently. This can't be undone.", confirmLabel: "Delete permanently", destructive: true })) await bulk("delete", () => deleteIdeasAction(projectId, [i.id])); },
  });

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id); const to = e.over?.id as string | undefined;
    const idea = data.ideas.find((i) => i.id === id);
    if (!idea || !to || (idea.priority ?? "medium") === to) return;
    setData((d) => ({ ...d, ideas: d.ideas.map((i) => (i.id === id ? { ...i, priority: to as Idea["priority"] } : i)) }));
    void setPriorityAction(projectId, [id], to as "low" | "medium" | "high" | "urgent").then((r) => { if (!r.ok) { toast.error(r.error); void load(filters, 0); } });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title="Ideas Backlog" description={`Every ${props.projectName} idea lands here first: scored, filtered and waiting for you to give it a date. Nothing reaches the calendar or gets published on its own.`}
        actions={<>
          {props.canAdmin ? <Button variant="outline" onClick={() => setWeightsOpen(true)}><SlidersHorizontal /> Scoring weights</Button> : null}
          {canEdit ? <Button variant="outline" onClick={() => setPlanning(true)}><Sparkles /> Calendar Planner</Button> : null}
          {canEdit ? <Button onClick={() => setCreating(true)}><Plus /> New idea</Button> : null}
        </>} />

      {/* Search, quick filters, views */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search titles and descriptions…" value={filters.q ?? ""} onChange={(e) => setF({ q: e.target.value })} aria-label="Search ideas" /></div>
          <NativeSelect aria-label="Planning status" className="w-40" value={filters.archived ? "archived" : filters.planning} onChange={(e) => e.target.value === "archived" ? setF({ archived: true, planning: "all" }) : setF({ archived: false, planning: e.target.value as BacklogFilters["planning"] })}>
            <option value="backlog">In the Backlog</option><option value="planned">On the calendar</option><option value="all">Backlog + calendar</option><option value="archived">Archived</option>
          </NativeSelect>
          <NativeSelect aria-label="Audience" className="w-40" value={filters.segments?.[0] ?? ""} onChange={(e) => setF({ segments: e.target.value ? [e.target.value] : [] })}>
            <option value="">All audiences</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}<option value="none">Audience not set</option>
          </NativeSelect>
          <NativeSelect aria-label="Sort" className="w-40" value={filters.sort} onChange={(e) => setF({ sort: e.target.value as BacklogFilters["sort"] })}>
            <option value="score">Highest score</option><option value="audience">Audience</option><option value="priority">Priority</option><option value="suggested">Suggested date</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option>
          </NativeSelect>
          <Button variant={more || activeCount ? "secondary" : "outline"} onClick={() => setMore(!more)}><Filter /> Filters{activeCount ? ` (${activeCount})` : ""}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><Bookmark /> Saved</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {presets.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setFilters({ ...DEFAULT_FILTERS, ...p.filters })} className="justify-between gap-4">
                  {p.name}<button type="button" aria-label={`Delete ${p.name}`} onClick={async (e) => { e.stopPropagation(); await deletePresetAction(projectId, p.id); setPresets((l) => l.filter((x) => x.id !== p.id)); }}><X className="size-3.5" /></button>
                </DropdownMenuItem>
              ))}
              {presets.length ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={async () => {
                const name = window.prompt("Name this filter (e.g. “SOSProf reels above 85”)");
                if (!name) return;
                const r = await savePresetAction(projectId, name, filters);
                if (r.ok && r.data) { setPresets((l) => [...l.filter((x) => x.name !== r.data!.name), r.data!].sort((a, b) => a.name.localeCompare(b.name))); toast.success(r.message ?? "Saved"); } else if (!r.ok) toast.error(r.error);
              }}><Plus /> Save current filters</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div role="tablist" aria-label="View" className="inline-flex rounded-md bg-secondary p-0.5">
            {([["cards", LayoutGrid, "Cards"], ["list", List, "List"], ["kanban", Columns3, "Kanban"]] as const).map(([k, Icon, label]) => (
              <button key={k} role="tab" aria-selected={view === k} title={label} onClick={() => chooseView(k)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px]", view === k ? "bg-card shadow-xs" : "text-muted-foreground")}><Icon className="size-4" /><span className="hidden sm:inline">{label}</span></button>
            ))}
          </div>
        </div>
        {more ? (
          <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect label="Content pillar" value={filters.pillars?.[0] ?? ""} onChange={(v) => setF({ pillars: v ? [v] : [] })} options={[["none", "No pillar"], ...props.pillars.map((p) => [p.id, `${p.name}${p.segment === "teachers" ? " · Teachers" : ""}`])]} />
            <FilterSelect label="Conversion goal" value={filters.goals?.[0] ?? ""} onChange={(v) => setF({ goals: v ? [v] : [] })} options={(filters.segments?.[0] && filters.segments[0] !== "none" ? goalsFor(filters.segments[0]) : ALL_CONVERSIONS).map((g) => [g.key, g.label])} />
            <FilterSelect label="Format" value={filters.formats?.[0] ?? ""} onChange={(v) => setF({ formats: v ? [v] : [] })} options={FORMATS.map((f) => [f, f])} />
            <FilterSelect label="Platform" value={filters.platforms?.[0] ?? ""} onChange={(v) => setF({ platforms: v ? [v] : [] })} options={PLATFORM_CHOICES.map((p) => [p, PLATFORM_LABELS[p as Platform]])} />
            <label className="space-y-1 text-xs text-muted-foreground"><span>Audience contains</span><Input value={filters.audience ?? ""} placeholder="e.g. parents" onChange={(e) => setF({ audience: e.target.value })} /></label>
            <div className="space-y-1 text-xs text-muted-foreground"><span>Score</span><div className="flex gap-1.5"><Input type="number" min={0} max={100} placeholder="min" value={filters.scoreMin ?? ""} onChange={(e) => setF({ scoreMin: e.target.value === "" ? undefined : Number(e.target.value) })} /><Input type="number" min={0} max={100} placeholder="max" value={filters.scoreMax ?? ""} onChange={(e) => setF({ scoreMax: e.target.value === "" ? undefined : Number(e.target.value) })} /></div></div>
            <FilterSelect label="Priority" value={filters.priorities?.[0] ?? ""} onChange={(v) => setF({ priorities: v ? [v] : [] })} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} />
            <FilterSelect label="Production status" value={filters.stages?.[0] ?? ""} onChange={(v) => setF({ stages: v ? [v] : [] })} options={(["idea", "brief", "in_production", "internal_review", "ready"] as ProductionStage[]).map((s) => [s, STAGE_LABELS[s]])} />
            <FilterSelect label="AI confidence" value={filters.confidence?.[0] ?? ""} onChange={(v) => setF({ confidence: v ? [v] : [] })} options={[["high", "High"], ["medium", "Medium"], ["low", "Low"]]} />
            <FilterSelect label="Tag" value={filters.tags?.[0] ?? ""} onChange={(v) => setF({ tags: v ? [v] : [] })} options={props.tags.map((t) => [t, t])} />
            <label className="space-y-1 text-xs text-muted-foreground"><span>Recommended time</span><Input type="time" value={filters.slotTime ?? ""} onChange={(e) => setF({ slotTime: e.target.value || undefined })} /></label>
            <div className="space-y-1 text-xs text-muted-foreground"><span>Created between</span><div className="flex gap-1.5"><Input type="date" value={filters.createdFrom ?? ""} onChange={(e) => setF({ createdFrom: e.target.value || undefined })} /><Input type="date" value={filters.createdTo ?? ""} onChange={(e) => setF({ createdTo: e.target.value || undefined })} /></div></div>
            <div className="space-y-1 text-xs text-muted-foreground"><span>Suggested date between</span><div className="flex gap-1.5"><Input type="date" value={filters.suggestedFrom ?? ""} onChange={(e) => setF({ suggestedFrom: e.target.value || undefined })} /><Input type="date" value={filters.suggestedTo ?? ""} onChange={(e) => setF({ suggestedTo: e.target.value || undefined })} /></div></div>
            <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, planning: filters.planning, sort: filters.sort })}>Clear filters</Button></div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{loading ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}{data.total} idea{data.total === 1 ? "" : "s"} · times in {tz}</span>
          {canEdit && data.ideas.length ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={selected.size > 0 && selected.size === data.ideas.length} onChange={(e) => setSelected(e.target.checked ? new Set(data.ideas.map((i) => i.id)) : new Set())} /> Select all shown</label> : null}
        </div>
      </div>

      {/* Bulk actions */}
      {canEdit && selected.size ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2 shadow-sm">
          <span className="px-1 text-[13px] font-medium">{selected.size} selected</span>
          {props.aiEnabled ? <Button size="sm" variant="outline" disabled={busy !== null || selected.size > 20} title={selected.size > 20 ? "Score up to 20 at a time" : undefined} onClick={() => bulk("score", () => scoreIdeasAction(projectId, ids))}>{busy === "score" ? <Loader2 className="animate-spin" /> : <Sparkles />} Score with AI</Button> : null}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("suggest", () => refreshSuggestionsAction(projectId, ids))}>{busy === "suggest" ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Suggest times</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("production", () => sendToProductionAction(projectId, ids))}><Send /> Send to Production</Button>
          <NativeSelect aria-label="Set audience" className="h-8 w-36" value="" onChange={(e) => e.target.value && bulk("audience", () => setAudienceAction(projectId, ids, e.target.value === "none" ? null : (e.target.value as "students")))}><option value="">Set audience…</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}<option value="none">Clear audience</option></NativeSelect>
          {props.aiEnabled ? <Button size="sm" variant="outline" disabled={busy !== null || selected.size > 30} title={selected.size > 30 ? "Up to 30 at a time" : undefined} onClick={() => bulk("aiaudience", () => suggestAudienceAction(projectId, ids))}>{busy === "aiaudience" ? <Loader2 className="animate-spin" /> : <Sparkles />} AI: suggest audience</Button> : null}
          <NativeSelect aria-label="Set priority" className="h-8 w-32" value="" onChange={(e) => e.target.value && bulk("priority", () => setPriorityAction(projectId, ids, e.target.value as "low"))}><option value="">Priority…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</NativeSelect>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { const t = window.prompt("Tag to add"); if (t) void bulk("tag", () => tagIdeasAction(projectId, ids, t)); }}><Tag /> Tag</Button>
          {filters.planning === "planned" || filters.planning === "all" ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("unplan", () => unplanIdeasAction(projectId, ids))}><Undo2 /> Back to Backlog</Button> : null}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("archive", () => archiveIdeasAction(projectId, ids, !filters.archived))}>{filters.archived ? <ArchiveRestore /> : <Archive />} {filters.archived ? "Restore" : "Archive"}</Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={async () => { if (await confirm({ title: `Delete ${selected.size} idea${selected.size > 1 ? "s" : ""}?`, description: "They are deleted permanently with their stored files. Scheduled and published posts are skipped.", confirmLabel: "Delete permanently", destructive: true })) await bulk("delete", () => deleteIdeasAction(projectId, ids)); }}><Trash2 /> Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      ) : null}

      {/* Views */}
      {!data.ideas.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-[13px] text-muted-foreground">
          {activeCount || filters.q ? "No idea matches these filters." : filters.archived ? "No archived ideas." : "The Backlog is empty. Add your first idea, or create ideas from Opportunities."}
        </div>
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b text-left text-xs text-muted-foreground"><tr>
              {canEdit ? <th className="w-8 p-2" /> : null}<th className="p-2">Idea</th><th className="p-2">Score</th><th className="p-2">Suggested</th><th className="p-2">Priority</th><th className="p-2">Status</th><th className="w-10 p-2" />
            </tr></thead>
            <tbody>{data.ideas.map((i) => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-muted/40">
                {canEdit ? <td className="p-2"><input type="checkbox" aria-label={`Select ${i.title}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td> : null}
                <td className="max-w-md p-2"><button className="text-left font-medium hover:text-primary" onClick={() => setOpen(i)}>{i.title}</button><Meta idea={i} pillar={pillarName(i.pillar_id)} /></td>
                <td className="p-2"><ScoreBadge s={i.idea_score} /></td>
                <td className="p-2 text-xs">{i.suggested_slot ? <>{slotLabel(i.suggested_slot.date, i.suggested_slot.time)}<br /><span className="text-muted-foreground">{i.suggested_slot.confidence}</span></> : "—"}</td>
                <td className="p-2 text-xs">{PRIORITY_LABEL[i.priority ?? "medium"]}</td>
                <td className="p-2"><Badge variant="outline">{lifecycleOf(i)}</Badge></td>
                <td className="p-2"><RowMenu idea={i} canEdit={canEdit} a={actions(i)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.ideas.map((i) => <IdeaCard key={i.id} idea={i} pillar={pillarName(i.pillar_id)} canEdit={canEdit} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} a={actions(i)} />)}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {PRIORITIES.map((p) => {
              const col = data.ideas.filter((i) => (i.priority ?? "medium") === p);
              return (
                <KanbanColumn key={p} id={p} label={`${PRIORITY_LABEL[p]} priority`} count={col.length}>
                  {col.map((i) => <DraggableCard key={i.id} id={i.id} disabled={!canEdit}><IdeaCard idea={i} pillar={pillarName(i.pillar_id)} canEdit={canEdit} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} a={actions(i)} compact /></DraggableCard>)}
                </KanbanColumn>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Drag a card to another column to change its priority.</p>
        </DndContext>
      )}
      {data.ideas.length < data.total ? <div className="text-center"><Button variant="outline" disabled={loading} onClick={() => load(filters, page + 1)}>{loading ? <Loader2 className="animate-spin" /> : null} Load more ({data.total - data.ideas.length} left)</Button></div> : null}

      {current ? <IdeaDetail key={current.id + current.updated_at} projectId={projectId} idea={current} pillars={props.pillars} tz={tz} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={changed} onPlace={(idea, date, time) => setPlace({ idea, date, time })} /> : null}
      {place ? <ScheduleDialog projectId={projectId} tz={tz} idea={place.time ? { ...place.idea, suggested_slot: place.idea.suggested_slot && { ...place.idea.suggested_slot, date: place.date!, time: place.time } } : place.idea} date={place.date ?? null} onClose={() => setPlace(null)} onPlaced={async () => { setPlace(null); setOpen(null); await reload(); }} /> : null}
      {creating ? <NewIdeaDialog projectId={projectId} pillars={props.pillars} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} /> : null}
      {planning ? <PlannerDialog projectId={projectId} today={props.today} tz={tz} pillars={props.pillars} audienceMix={props.audienceMix} onClose={() => setPlanning(false)} onSaved={async () => { setPlanning(false); await reload(); }} /> : null}
      {weightsOpen ? <WeightsDialog projectId={projectId} initial={props.weights} onClose={() => setWeightsOpen(false)} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return <label className="space-y-1 text-xs text-muted-foreground"><span>{label}</span><NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="text-foreground"><option value="">All</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></label>;
}
const ScoreBadge = ({ s }: { s: number | null }) => <Badge variant={scoreTone(s)} className="tabular-nums">{s == null ? "Not scored" : `${s}/100`}</Badge>;

function Meta({ idea, pillar }: { idea: Idea; pillar: string | null }) {
  const platforms = idea.target_platforms?.length ? idea.target_platforms : idea.platform ? [idea.platform] : [];
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {idea.audience_segment ? <span className={cn("rounded px-1 font-medium", idea.audience_segment === "teachers" ? "bg-warning/15 text-warning-foreground" : "bg-primary-soft text-primary")}>{SEGMENT_LABELS[idea.audience_segment as keyof typeof SEGMENT_LABELS]}</span> : null}
      {pillar ? <span>{pillar}</span> : null}{pillar && idea.format ? <span>·</span> : null}{idea.format ? <span>{idea.format}</span> : null}
      {platforms.map((p) => <PlatformIcon key={p} platform={p} />)}
      {(idea.tags ?? []).slice(0, 3).map((t) => <span key={t} className="rounded bg-muted px-1">#{t}</span>)}
    </p>
  );
}

type Acts = Record<"preview" | "place" | "production" | "duplicate" | "archive" | "unplan" | "remove", () => void>;

function RowMenu({ idea, canEdit, a }: { idea: Idea; canEdit: boolean; a: Acts }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for ${idea.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={a.preview}><Eye /> Edit / preview</DropdownMenuItem>
        {canEdit ? <>
          {!idea.scheduled_date ? <DropdownMenuItem onSelect={a.place}><CalendarPlus /> Add to calendar</DropdownMenuItem> : idea.status !== "scheduled" ? <DropdownMenuItem onSelect={a.unplan}><Undo2 /> Back to Backlog</DropdownMenuItem> : null}
          {idea.production_stage === "idea" ? <DropdownMenuItem onSelect={a.production}><Send /> Send to Production</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={a.duplicate}><Copy /> Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={a.archive}>{idea.archived_at ? <ArchiveRestore /> : <Archive />} {idea.archived_at ? "Restore" : "Archive"}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={a.remove} className="text-destructive"><Trash2 /> Delete</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IdeaCard({ idea, pillar, canEdit, selected, onToggle, a, compact }: { idea: Idea; pillar: string | null; canEdit: boolean; selected: boolean; onToggle: () => void; a: Acts; compact?: boolean }) {
  const s = idea.suggested_slot;
  return (
    <article className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs", selected && "ring-2 ring-primary")}>
      <div className="flex items-start gap-2">
        {canEdit ? <input type="checkbox" className="mt-1" aria-label={`Select ${idea.title}`} checked={selected} onChange={onToggle} onPointerDown={(e) => e.stopPropagation()} /> : null}
        <button className="min-w-0 flex-1 text-left text-[13px] font-semibold leading-5 hover:text-primary" onClick={a.preview} onPointerDown={(e) => e.stopPropagation()}>{idea.title}</button>
        <div onPointerDown={(e) => e.stopPropagation()}><RowMenu idea={idea} canEdit={canEdit} a={a} /></div>
      </div>
      <Meta idea={idea} pillar={pillar} />
      {!compact && idea.description ? <p dir="auto" className="line-clamp-2 text-xs text-muted-foreground">{idea.description}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
        <ScoreBadge s={idea.idea_score} />
        <Badge variant="outline">{lifecycleOf(idea)}</Badge>
        {!compact ? <Badge variant="secondary">{PRIORITY_LABEL[idea.priority ?? "medium"]}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">{idea.scheduled_date ? <>On the calendar: <span className="text-foreground">{slotLabel(idea.scheduled_date, idea.scheduled_time?.slice(0, 5) ?? "—")}</span></> : s ? <>Suggested: <span className="text-foreground">{slotLabel(s.date, s.time)}</span> · {s.confidence}{s.source === "heuristic" ? " (heuristic)" : ""}</> : "No suggested time yet"}</p>
      {canEdit && !idea.scheduled_date && !compact ? (
        <div className="flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={a.place}><CalendarPlus /> Add to calendar</Button>
          {idea.production_stage === "idea" ? <Button size="sm" variant="ghost" onClick={a.production}><Send /> Production</Button> : null}
        </div>
      ) : null}
    </article>
  );
}

function KanbanColumn({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={cn("min-h-60 w-72 shrink-0 space-y-2 rounded-xl border bg-muted/25 p-2", isOver && "border-primary bg-primary/5")}>
      <header className="flex items-center justify-between px-1 py-1.5 text-xs font-semibold"><span>{label}</span><span className="rounded bg-background px-1.5 tabular-nums text-muted-foreground">{count}</span></header>
      {children}
    </section>
  );
}
function DraggableCard({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return <div ref={setNodeRef} {...attributes} {...listeners} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined} className={cn("touch-none", isDragging && "relative z-30 opacity-80")}>{children}</div>;
}

function NewIdeaDialog({ projectId, pillars, onClose, onCreated }: { projectId: string; pillars: { id: string; name: string; segment?: string }[]; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = React.useState({ title: "", description: "", pillar_id: "", format: "", platforms: ["facebook"] as string[], audience: "", tags: "", segment: "", goal: "" });
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await createIdeaAction(projectId, { title: f.title, description: f.description || null, pillar_id: f.pillar_id || null, format: f.format || null, target_platforms: f.platforms, target_audience: f.audience || null, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), audience_segment: (f.segment || null) as never, conversion_goal: f.goal || null });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Added");
    onCreated();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New idea</DialogTitle><DialogDescription>It goes to the Backlog with a suggested time. You decide when it reaches the calendar.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <Input autoFocus placeholder="Idea title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-[13px]" placeholder="Description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value, goal: "", pillar_id: "" })} aria-label="Audience"><option value="">Audience…</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</NativeSelect>
            <NativeSelect value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} aria-label="Conversion goal"><option value="">Conversion goal…</option>{goalsFor(f.segment).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</NativeSelect>
            <NativeSelect value={f.pillar_id} onChange={(e) => setF({ ...f, pillar_id: e.target.value })} aria-label="Content pillar"><option value="">No pillar</option>{(["students_parents", "teachers", "both"] as Side[]).map((side) => { const list = pillars.filter((p) => (p.segment ?? "students_parents") === side && (!f.segment || side === "both" || (side === "teachers") === (f.segment === "teachers"))); return list.length ? <optgroup key={side} label={SIDE_LABELS[side]}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null; })}</NativeSelect>
            <NativeSelect value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} aria-label="Format"><option value="">Format…</option>{FORMATS.map((x) => <option key={x} value={x}>{x}</option>)}</NativeSelect>
            <Input placeholder="Target audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
            <Input placeholder="Tags, comma separated" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-3">{PLATFORM_CHOICES.map((p) => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={f.platforms.includes(p)} onChange={() => setF({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] })} />{PLATFORM_LABELS[p as Platform]}</label>)}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || f.title.trim().length < 2}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Add to Backlog</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WeightsDialog({ projectId, initial, onClose }: { projectId: string; initial: Weights; onClose: () => void }) {
  const [w, setW] = React.useState<Weights>(initial);
  const [busy, setBusy] = React.useState(false);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Scoring weights for this brand</DialogTitle><DialogDescription>How much each criterion counts in the idea score. Weights are rescaled to 100%. Rescore ideas to apply new weights.</DialogDescription></DialogHeader>
        <div className="space-y-2 text-[13px]">
          {CRITERIA.map((c) => (
            <label key={c.key} className="flex items-center justify-between gap-3"><span>{c.label}</span><Input type="number" min={0} max={100} className="w-24" value={w[c.key]} onChange={(e) => setW({ ...w, [c.key]: Number(e.target.value) || 0 })} /></label>
          ))}
          <p className="text-xs text-muted-foreground">Total: {Math.round(total)} (saved as {Object.values(normalizeWeights(w)).map((x) => Math.round(x)).join(" / ")} %)</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button disabled={busy || !total} onClick={async () => { setBusy(true); const r = await saveScoreWeightsAction(projectId, w); setBusy(false); if (r.ok) { toast.success(r.message ?? "Saved"); onClose(); } else toast.error(r.error); }}>Save weights</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
