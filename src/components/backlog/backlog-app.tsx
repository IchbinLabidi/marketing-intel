"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  Archive, ArchiveRestore, Bookmark, CalendarPlus, Columns3, Copy, Eye, Filter, LayoutGrid, List, Loader2, MoreHorizontal, Plus, Search,
  Send, SlidersHorizontal, Sparkles, Tag, Trash2, Undo2, UserRound, X,
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
import { ideaCreator } from "@/lib/backlog/creator";
import { CRITERIA, impactEffort, normalizeWeights, scoreBand, type Weights } from "@/lib/backlog/score";
import { ALL_CONVERSIONS, AUDIENCES, goalsFor, SEGMENTS, type Audience, type AudienceMix, type Side } from "@/lib/backlog/audience";
import { useFormatter, useT } from "@/i18n/client";
import { AudienceFilter, AudienceSelect } from "@/components/app/audience-badge";
import { FORMATS, type ProductionStage } from "@/lib/production/model";
import { cn } from "@/lib/utils";
import {
  archiveIdeasAction, createIdeaAction, deleteIdeasAction, deletePresetAction, duplicateIdeaAction, listIdeasAction, refreshSuggestionsAction,
  saveScoreWeightsAction, savePresetAction, scoreIdeasAction, sendToProductionAction, setAudienceTagAction, setPriorityAction, suggestAudienceAction, tagIdeasAction, tagUntaggedAction, unplanIdeasAction,
  type FilterPreset,
} from "@/server/actions/backlog";
import type { BacklogFilters, Idea } from "@/server/services/backlog";
import { IdeaDetail, lifecycleOf } from "./idea-detail";
import { ScheduleDialog, slotLabel } from "./schedule-dialog";
import { PlannerDialog } from "./planner-dialog";

type View = "list" | "cards" | "kanban";
const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const BRIEF_STAGES = ["brief", "in_production", "internal_review", "approval", "ready"] as const;
type Priority = (typeof PRIORITIES)[number];
const prio = (p: string | null | undefined): Priority => ((PRIORITIES as readonly string[]).includes(p ?? "") ? (p as Priority) : "medium");
type ConversionKey = "forum_participation" | "teacher_profile_visits" | "lesson_requests" | "completed_bookings" | "teacher_registration" | "profile_completion" | "teacher_activation" | "lesson_requests_received" | "completed_sessions";
const goalKey = (k: string) => `conversion.${k as ConversionKey}` as const;
const PLATFORM_CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
const scoreTone = (s: number | null) => ({ high: "success", good: "info", fair: "warning", low: "destructive", unscored: "outline" } as const)[scoreBand(s)];

export function BacklogApp(props: {
  projectId: string; projectName: string; tz: string; canEdit: boolean; canAdmin: boolean;
  initial: { ideas: Idea[]; total: number }; pillars: { id: string; name: string; segment?: string; target_share?: number | null }[]; tags: string[]; presets: FilterPreset[]; audienceMix: AudienceMix | null;
  weights: Weights; aiEnabled: boolean; today: string; defaultSort?: BacklogFilters["sort"];
  /** workspace members by user id → display name (for "created by") */
  members?: Record<string, string>;
}) {
  const { projectId, tz, canEdit } = props;
  const t = useT("backlog");
  const tc = useT("common");
  const td = useT("domain");
  const fmt = useFormatter();
  const DEFAULT_FILTERS: BacklogFilters = { planning: "backlog", sort: props.defaultSort ?? "score" };
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
    toast.success(r.message ?? tc("actions.done"));
    setSelected(new Set());
    await reload();
  };
  // every idea matching the filters, page by page (up to 2,000)
  const selectAllMatching = async () => {
    setBusy("selectall");
    const all = new Set<string>();
    for (let p = 0; p < 10; p++) {
      const r = await listIdeasAction(projectId, filters, p);
      if (!r.ok) { setBusy(null); return void toast.error(r.error); }
      for (const i of r.data!.ideas) all.add(i.id);
      if (all.size >= r.data!.total || !r.data!.ideas.length) break;
    }
    setBusy(null);
    setSelected(all);
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const activeCount = Object.entries(filters).filter(([k, v]) => !["sort", "planning"].includes(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length)).length;

  const setTag = async (i: Idea, audience: Audience) => {
    setData((d) => ({ ...d, ideas: d.ideas.map((x) => (x.id === i.id ? { ...x, audience } : x)) }));
    const r = await setAudienceTagAction(projectId, [i.id], audience);
    if (!r.ok) toast.error(r.error);
    await load(filters, 0);
  };
  const actions = (i: Idea) => ({
    preview: () => setOpen(i),
    place: () => setPlace({ idea: i }),
    production: () => bulk("production", () => sendToProductionAction(projectId, [i.id])),
    duplicate: () => bulk("dup", () => duplicateIdeaAction(projectId, i.id)),
    archive: () => bulk("archive", () => archiveIdeasAction(projectId, [i.id], !i.archived_at)),
    unplan: () => bulk("unplan", () => unplanIdeasAction(projectId, [i.id])),
    remove: async () => { if (await confirm({ title: t("row.deleteConfirmTitle", { title: i.title }), description: t("row.deleteConfirmBody"), confirmLabel: t("bulk.deletePermanently"), destructive: true })) await bulk("delete", () => deleteIdeasAction(projectId, [i.id])); },
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
      <PageHeader title={t("page.title")} description={t("page.description", { project: props.projectName })}
        actions={<>
          {props.canAdmin ? <Button variant="outline" onClick={() => setWeightsOpen(true)}><SlidersHorizontal /> {t("page.scoringWeights")}</Button> : null}
          {canEdit ? <Button variant="outline" onClick={() => setPlanning(true)}><Sparkles /> {t("page.planner")}</Button> : null}
          {canEdit ? <Button onClick={() => setCreating(true)}><Plus /> {t("page.newIdea")}</Button> : null}
        </>} />

      {/* Search, quick filters, views */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder={t("toolbar.searchPlaceholder")} value={filters.q ?? ""} onChange={(e) => setF({ q: e.target.value })} aria-label={t("toolbar.searchLabel")} /></div>
          <NativeSelect aria-label={t("toolbar.planningLabel")} className="w-40" value={filters.archived ? "archived" : filters.planning} onChange={(e) => e.target.value === "archived" ? setF({ archived: true, planning: "all" }) : setF({ archived: false, planning: e.target.value as BacklogFilters["planning"] })}>
            <option value="backlog">{t("toolbar.planning.backlog")}</option><option value="planned">{t("toolbar.planning.planned")}</option><option value="all">{t("toolbar.planning.all")}</option><option value="published">{t("toolbar.planning.published")}</option><option value="archived">{t("toolbar.planning.archived")}</option>
          </NativeSelect>
          <AudienceFilter className="w-40" value={filters.audiences?.[0] ?? ""} onChange={(v) => setF({ audiences: v ? [v] : [] })} />
          <NativeSelect aria-label={t("toolbar.typeLabel")} className="w-40" value={!filters.stages?.length ? "" : filters.stages.length === 1 && filters.stages[0] === "idea" ? "ideas" : "briefs"} onChange={(e) => setF({ stages: e.target.value === "ideas" ? ["idea"] : e.target.value === "briefs" ? [...BRIEF_STAGES] : [] })}>
            <option value="">{t("toolbar.type.all")}</option><option value="ideas">{t("toolbar.type.ideas")}</option><option value="briefs">{t("toolbar.type.briefs")}</option>
          </NativeSelect>
          <NativeSelect aria-label={t("toolbar.sortLabel")} className="w-40" value={filters.sort} onChange={(e) => setF({ sort: e.target.value as BacklogFilters["sort"] })}>
            {(["score", "audience", "priority", "suggested", "newest", "oldest", "title"] as const).map((k) => <option key={k} value={k}>{t(`toolbar.sort.${k}`)}</option>)}
          </NativeSelect>
          <Button variant={more || activeCount ? "secondary" : "outline"} onClick={() => setMore(!more)}><Filter /> {activeCount ? t("toolbar.filtersCount", { count: activeCount }) : t("toolbar.filters")}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline"><Bookmark /> {t("toolbar.saved")}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {presets.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setFilters({ ...DEFAULT_FILTERS, ...p.filters })} className="justify-between gap-4">
                  {p.name}<button type="button" aria-label={t("toolbar.deletePreset", { name: p.name })} onClick={async (e) => { e.stopPropagation(); await deletePresetAction(projectId, p.id); setPresets((l) => l.filter((x) => x.id !== p.id)); }}><X className="size-3.5" /></button>
                </DropdownMenuItem>
              ))}
              {presets.length ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={async () => {
                const name = window.prompt(t("toolbar.presetPrompt"));
                if (!name) return;
                const r = await savePresetAction(projectId, name, filters);
                if (r.ok && r.data) { setPresets((l) => [...l.filter((x) => x.name !== r.data!.name), r.data!].sort((a, b) => a.name.localeCompare(b.name))); toast.success(r.message ?? t("savedToast")); } else if (!r.ok) toast.error(r.error);
              }}><Plus /> {t("toolbar.saveFilters")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div role="tablist" aria-label={t("toolbar.viewLabel")} className="inline-flex rounded-md bg-secondary p-0.5">
            {([["cards", LayoutGrid, t("toolbar.view.cards")], ["list", List, t("toolbar.view.list")], ["kanban", Columns3, t("toolbar.view.kanban")]] as const).map(([k, Icon, label]) => (
              <button key={k} role="tab" aria-selected={view === k} title={label} onClick={() => chooseView(k)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px]", view === k ? "bg-card shadow-xs" : "text-muted-foreground")}><Icon className="size-4" /><span className="hidden sm:inline">{label}</span></button>
            ))}
          </div>
        </div>
        {more ? (
          <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect label={t("filters.pillar")} value={filters.pillars?.[0] ?? ""} onChange={(v) => setF({ pillars: v ? [v] : [] })} options={[["none", t("filters.noPillar")], ...props.pillars.map((p) => [p.id, `${p.name}${p.segment === "teachers" ? t("filters.teachersSuffix") : ""}`])]} />
            <FilterSelect label={t("filters.segment")} value={filters.segments?.[0] ?? ""} onChange={(v) => setF({ segments: v ? [v] : [] })} options={[...SEGMENTS.map((x) => [x, td(`segment.${x}`)]), ["none", t("filters.segmentNotSet")]]} />
            <FilterSelect label={t("filters.goal")} value={filters.goals?.[0] ?? ""} onChange={(v) => setF({ goals: v ? [v] : [] })} options={(filters.segments?.[0] && filters.segments[0] !== "none" ? goalsFor(filters.segments[0]) : ALL_CONVERSIONS).map((g) => [g.key, td(goalKey(g.key))])} />
            <FilterSelect label={t("filters.format")} value={filters.formats?.[0] ?? ""} onChange={(v) => setF({ formats: v ? [v] : [] })} options={FORMATS.map((f) => [f, f])} />
            <FilterSelect label={t("filters.platform")} value={filters.platforms?.[0] ?? ""} onChange={(v) => setF({ platforms: v ? [v] : [] })} options={PLATFORM_CHOICES.map((p) => [p, PLATFORM_LABELS[p as Platform]])} />
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.audienceContains")}</span><Input value={filters.audience ?? ""} placeholder={t("filters.audiencePlaceholder")} onChange={(e) => setF({ audience: e.target.value })} /></label>
            <div className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.score")}</span><div className="flex gap-1.5"><Input type="number" min={0} max={100} placeholder={t("filters.min")} value={filters.scoreMin ?? ""} onChange={(e) => setF({ scoreMin: e.target.value === "" ? undefined : Number(e.target.value) })} /><Input type="number" min={0} max={100} placeholder={t("filters.max")} value={filters.scoreMax ?? ""} onChange={(e) => setF({ scoreMax: e.target.value === "" ? undefined : Number(e.target.value) })} /></div></div>
            <FilterSelect label={t("filters.priority")} value={filters.priorities?.[0] ?? ""} onChange={(v) => setF({ priorities: v ? [v] : [] })} options={PRIORITIES.map((p) => [p, td(`priority.${p}`)])} />
            <FilterSelect label={t("filters.productionStatus")} value={filters.stages?.[0] ?? ""} onChange={(v) => setF({ stages: v ? [v] : [] })} options={(["idea", "brief", "in_production", "internal_review", "ready"] as const satisfies readonly ProductionStage[]).map((s) => [s, t(`stage.${s}`)])} />
            <FilterSelect label={t("filters.aiConfidence")} value={filters.confidence?.[0] ?? ""} onChange={(v) => setF({ confidence: v ? [v] : [] })} options={[["high", t("confidence.high")], ["medium", t("confidence.medium")], ["low", t("confidence.low")]]} />
            <FilterSelect label={t("filters.tag")} value={filters.tags?.[0] ?? ""} onChange={(v) => setF({ tags: v ? [v] : [] })} options={props.tags.map((x) => [x, x])} />
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.recommendedTime")}</span><Input type="time" value={filters.slotTime ?? ""} onChange={(e) => setF({ slotTime: e.target.value || undefined })} /></label>
            <div className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.createdBetween")}</span><div className="flex gap-1.5"><Input type="date" value={filters.createdFrom ?? ""} onChange={(e) => setF({ createdFrom: e.target.value || undefined })} /><Input type="date" value={filters.createdTo ?? ""} onChange={(e) => setF({ createdTo: e.target.value || undefined })} /></div></div>
            <div className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.publicationBetween")}</span><div className="flex gap-1.5"><Input type="date" value={filters.scheduledFrom ?? ""} onChange={(e) => setF({ scheduledFrom: e.target.value || undefined, ...(filters.planning === "backlog" && e.target.value ? { planning: "all" } : {}) })} /><Input type="date" value={filters.scheduledTo ?? ""} onChange={(e) => setF({ scheduledTo: e.target.value || undefined, ...(filters.planning === "backlog" && e.target.value ? { planning: "all" } : {}) })} /></div></div>
            <div className="space-y-1 text-xs text-muted-foreground"><span>{t("filters.suggestedBetween")}</span><div className="flex gap-1.5"><Input type="date" value={filters.suggestedFrom ?? ""} onChange={(e) => setF({ suggestedFrom: e.target.value || undefined })} /><Input type="date" value={filters.suggestedTo ?? ""} onChange={(e) => setF({ suggestedTo: e.target.value || undefined })} /></div></div>
            <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, planning: filters.planning, sort: filters.sort })}>{t("filters.clear")}</Button></div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{loading ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}{t("summary.count", { count: data.total, tz })}
            {canEdit && props.aiEnabled && filters.audiences?.[0] === "none" && data.total ? <button type="button" className="ml-3 text-primary hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => bulk("backfill", () => tagUntaggedAction(projectId))}>{busy === "backfill" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : <Sparkles className="mr-1 inline size-3" />}{t("summary.tagUntagged")}</button> : null}
          </span>
          {canEdit && data.ideas.length ? <span className="flex items-center gap-3">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={selected.size > 0 && selected.size === data.ideas.length} onChange={(e) => setSelected(e.target.checked ? new Set(data.ideas.map((i) => i.id)) : new Set())} /> {t("summary.selectShown")}</label>
            {data.total > data.ideas.length ? <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void selectAllMatching()}>{busy === "selectall" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}{t("summary.selectAllCount", { count: data.total })}</button> : null}
          </span> : null}
        </div>
      </div>

      {/* Bulk actions */}
      {canEdit && selected.size ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2 shadow-sm">
          <span className="px-1 text-[13px] font-medium">{t("bulk.selected", { count: selected.size })}</span>
          {props.aiEnabled ? <Button size="sm" variant="outline" disabled={busy !== null} title={selected.size > 200 ? t("bulk.scoreLimit") : undefined} onClick={() => bulk("score", () => scoreIdeasAction(projectId, ids))}>{busy === "score" ? <Loader2 className="animate-spin" /> : <Sparkles />} {t("bulk.score")}</Button> : null}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("suggest", () => refreshSuggestionsAction(projectId, ids))}>{busy === "suggest" ? <Loader2 className="animate-spin" /> : <CalendarPlus />} {t("bulk.suggestTimes")}</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("production", () => sendToProductionAction(projectId, ids))}><Send /> {t("bulk.sendToProduction")}</Button>
          <NativeSelect aria-label={t("bulk.setAudience")} className="h-8 w-36" value="" onChange={(e) => e.target.value && bulk("audience", () => setAudienceTagAction(projectId, ids, e.target.value as Audience))}><option value="">{t("bulk.setAudiencePlaceholder")}</option>{AUDIENCES.map((a) => <option key={a} value={a}>{td(`audience.${a}`)}</option>)}</NativeSelect>
          {props.aiEnabled ? <Button size="sm" variant="outline" disabled={busy !== null} title={selected.size > 200 ? t("bulk.audienceLimit") : undefined} onClick={() => bulk("aiaudience", () => suggestAudienceAction(projectId, ids))}>{busy === "aiaudience" ? <Loader2 className="animate-spin" /> : <Sparkles />} {t("bulk.suggestAudience")}</Button> : null}
          <NativeSelect aria-label={t("bulk.setPriority")} className="h-8 w-32" value="" onChange={(e) => e.target.value && bulk("priority", () => setPriorityAction(projectId, ids, e.target.value as "low"))}><option value="">{t("bulk.priorityPlaceholder")}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{td(`priority.${p}`)}</option>)}</NativeSelect>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { const tag = window.prompt(t("bulk.tagPrompt")); if (tag) void bulk("tag", () => tagIdeasAction(projectId, ids, tag)); }}><Tag /> {t("bulk.tag")}</Button>
          {filters.planning !== "backlog" || filters.scheduledFrom || filters.scheduledTo ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={async () => { if (ids.length > 20 && !(await confirm({ title: t("bulk.unplanConfirmTitle", { count: ids.length }), description: t("bulk.unplanConfirmBody"), confirmLabel: t("bulk.backToBacklog") }))) return; await bulk("unplan", () => unplanIdeasAction(projectId, ids)); }}><Undo2 /> {t("bulk.backToBacklog")}</Button> : null}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => bulk("archive", () => archiveIdeasAction(projectId, ids, !filters.archived))}>{filters.archived ? <ArchiveRestore /> : <Archive />} {filters.archived ? tc("actions.restore") : tc("actions.archive")}</Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy !== null} onClick={async () => { if (await confirm({ title: t("bulk.deleteConfirmTitle", { count: selected.size }), description: t("bulk.deleteConfirmBody"), confirmLabel: t("bulk.deletePermanently"), destructive: true })) await bulk("delete", () => deleteIdeasAction(projectId, ids)); }}><Trash2 /> {tc("actions.delete")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{tc("actions.clear")}</Button>
        </div>
      ) : null}

      {/* Views */}
      {!data.ideas.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-[13px] text-muted-foreground">
          {activeCount || filters.q ? t("empty.filtered") : filters.archived ? t("empty.archived") : t("empty.backlog")}
        </div>
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b text-left text-xs text-muted-foreground"><tr>
              {canEdit ? <th className="w-8 p-2" /> : null}<th className="p-2">{t("table.idea")}</th><th className="p-2">{t("table.score")}</th><th className="p-2">{t("table.suggested")}</th><th className="p-2">{t("table.priority")}</th><th className="p-2">{t("table.status")}</th><th className="w-10 p-2" />
            </tr></thead>
            <tbody>{data.ideas.map((i) => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-muted/40">
                {canEdit ? <td className="p-2"><input type="checkbox" aria-label={t("row.select", { title: i.title })} checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td> : null}
                <td className="max-w-md p-2"><button className="text-left font-medium hover:text-primary" onClick={() => setOpen(i)}>{i.title}</button><Meta idea={i} pillar={pillarName(i.pillar_id)} canEdit={canEdit} onAudience={(a) => void setTag(i, a)} /></td>
                <td className="p-2"><ScoreBadge s={i.idea_score} /> <ImpactEffort idea={i} /></td>
                <td className="p-2 text-xs">{i.suggested_slot ? <>{slotLabel(fmt, t, i.suggested_slot.date, i.suggested_slot.time)}<br /><span className="text-muted-foreground">{t(`confidence.${i.suggested_slot.confidence}`).toLowerCase()}</span></> : "—"}</td>
                <td className="p-2 text-xs">{td(`priority.${prio(i.priority)}`)}</td>
                <td className="p-2"><Badge variant="outline">{t(`lifecycle.${lifecycleOf(i)}`)}</Badge></td>
                <td className="p-2"><RowMenu idea={i} canEdit={canEdit} a={actions(i)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.ideas.map((i) => <IdeaCard key={i.id} idea={i} members={props.members} pillar={pillarName(i.pillar_id)} canEdit={canEdit} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} a={actions(i)} onAudience={(a) => void setTag(i, a)} />)}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {PRIORITIES.map((p) => {
              const col = data.ideas.filter((i) => (i.priority ?? "medium") === p);
              return (
                <KanbanColumn key={p} id={p} label={t(`kanban.column.${p}`)} count={col.length}>
                  {col.map((i) => <DraggableCard key={i.id} id={i.id} disabled={!canEdit}><IdeaCard idea={i} members={props.members} pillar={pillarName(i.pillar_id)} canEdit={canEdit} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} a={actions(i)} onAudience={(a) => void setTag(i, a)} compact /></DraggableCard>)}
                </KanbanColumn>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("kanban.hint")}</p>
        </DndContext>
      )}
      {data.ideas.length < data.total ? <div className="text-center"><Button variant="outline" disabled={loading} onClick={() => load(filters, page + 1)}>{loading ? <Loader2 className="animate-spin" /> : null} {t("loadMore", { count: data.total - data.ideas.length })}</Button></div> : null}

      {current ? <IdeaDetail key={current.id + current.updated_at} projectId={projectId} idea={current} pillars={props.pillars} tz={tz} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={changed} onPlace={(idea, date, time) => setPlace({ idea, date, time })} /> : null}
      {place ? <ScheduleDialog projectId={projectId} tz={tz} idea={place.time ? { ...place.idea, suggested_slot: place.idea.suggested_slot && { ...place.idea.suggested_slot, date: place.date!, time: place.time } } : place.idea} date={place.date ?? null} onClose={() => setPlace(null)} onPlaced={async () => { setPlace(null); setOpen(null); await reload(); }} /> : null}
      {creating ? <NewIdeaDialog projectId={projectId} pillars={props.pillars} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} /> : null}
      {planning ? <PlannerDialog projectId={projectId} today={props.today} tz={tz} pillars={props.pillars} audienceMix={props.audienceMix} onClose={() => setPlanning(false)} onSaved={async () => { setPlanning(false); await reload(); }} /> : null}
      {weightsOpen ? <WeightsDialog projectId={projectId} initial={props.weights} onClose={() => setWeightsOpen(false)} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  const tc = useT("common");
  return <label className="space-y-1 text-xs text-muted-foreground"><span>{label}</span><NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="text-foreground"><option value="">{tc("states.all")}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></label>;
}
function ScoreBadge({ s }: { s: number | null }) {
  const t = useT("backlog");
  return <Badge variant={scoreTone(s)} className="tabular-nums">{s == null ? t("score.notScored") : t("score.outOf", { score: s })}</Badge>;
}

function ImpactEffort({ idea }: { idea: Idea }) {
  const t = useT("backlog");
  const ie = impactEffort(idea.score_details);
  return ie ? <span className="whitespace-nowrap text-xs text-muted-foreground" title={t("score.impactEffortHint")}>{t("score.impactEffort", { impact: ie.impact, effort: ie.effort })}</span> : null;
}

function Meta({ idea, pillar, canEdit, onAudience }: { idea: Idea; pillar: string | null; canEdit: boolean; onAudience: (a: Audience) => void }) {
  const t = useT("backlog");
  const td = useT("domain");
  const platforms = idea.target_platforms?.length ? idea.target_platforms : idea.platform ? [idea.platform] : [];
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <AudienceSelect value={idea.audience} onChange={onAudience} disabled={!canEdit} />
      {idea.audience_segment === "both" ? <span className="rounded bg-primary-soft px-1 font-medium text-primary" title={t("segmentBothHint")}>{td("segment.both")}</span> : null}
      {pillar ? <span>{pillar}</span> : null}{pillar && idea.format ? <span>·</span> : null}{idea.format ? <span>{idea.format}</span> : null}
      {platforms.map((p) => <PlatformIcon key={p} platform={p} />)}
      {(idea.tags ?? []).slice(0, 3).map((x) => <span key={x} className="rounded bg-muted px-1">#{x}</span>)}
    </p>
  );
}

type Acts = Record<"preview" | "place" | "production" | "duplicate" | "archive" | "unplan" | "remove", () => void>;

function RowMenu({ idea, canEdit, a }: { idea: Idea; canEdit: boolean; a: Acts }) {
  const t = useT("backlog");
  const tc = useT("common");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={t("row.actionsFor", { title: idea.title })}><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={a.preview}><Eye /> {t("row.editPreview")}</DropdownMenuItem>
        {canEdit ? <>
          {!idea.scheduled_date ? <DropdownMenuItem onSelect={a.place}><CalendarPlus /> {t("row.addToCalendar")}</DropdownMenuItem> : idea.status !== "scheduled" ? <DropdownMenuItem onSelect={a.unplan}><Undo2 /> {t("bulk.backToBacklog")}</DropdownMenuItem> : null}
          {idea.production_stage === "idea" ? <DropdownMenuItem onSelect={a.production}><Send /> {t("bulk.sendToProduction")}</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={a.duplicate}><Copy /> {tc("actions.duplicate")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={a.archive}>{idea.archived_at ? <ArchiveRestore /> : <Archive />} {idea.archived_at ? tc("actions.restore") : tc("actions.archive")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={a.remove} className="text-destructive"><Trash2 /> {tc("actions.delete")}</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreatedBy({ idea, members }: { idea: Idea; members?: Record<string, string> }) {
  const t = useT("backlog");
  const c = ideaCreator(idea);
  if (c === "ai") return <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary" title={t("row.creatorAiHint")}><Sparkles className="size-3" /> {t("row.creatorAi")}</span>;
  const name = members?.[c.userId] || t("row.creatorMember");
  return <span className="ml-auto inline-flex min-w-0 max-w-[50%] shrink items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title={t("row.creatorHint", { name })}><UserRound className="size-3 shrink-0" /> <span className="truncate">{name}</span></span>;
}

function IdeaCard({ idea, members, pillar, canEdit, selected, onToggle, a, onAudience, compact }: { idea: Idea; members?: Record<string, string>; pillar: string | null; canEdit: boolean; selected: boolean; onToggle: () => void; a: Acts; onAudience: (a: Audience) => void; compact?: boolean }) {
  const t = useT("backlog");
  const td = useT("domain");
  const fmt = useFormatter();
  const s = idea.suggested_slot;
  return (
    <article className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs", selected && "ring-2 ring-primary")}>
      <div className="flex items-start gap-2">
        {canEdit ? <input type="checkbox" className="mt-1" aria-label={t("row.select", { title: idea.title })} checked={selected} onChange={onToggle} onPointerDown={(e) => e.stopPropagation()} /> : null}
        <button className="min-w-0 flex-1 text-left text-[13px] font-semibold leading-5 hover:text-primary" onClick={a.preview} onPointerDown={(e) => e.stopPropagation()}>{idea.title}</button>
        <div onPointerDown={(e) => e.stopPropagation()}><RowMenu idea={idea} canEdit={canEdit} a={a} /></div>
      </div>
      <Meta idea={idea} pillar={pillar} canEdit={canEdit} onAudience={onAudience} />
      {!compact && idea.description ? <p dir="auto" className="line-clamp-2 text-xs text-muted-foreground">{idea.description}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
        <ScoreBadge s={idea.idea_score} />
        <ImpactEffort idea={idea} />
        <Badge variant="outline">{t(`lifecycle.${lifecycleOf(idea)}`)}</Badge>
        {!compact ? <Badge variant="secondary">{td(`priority.${prio(idea.priority)}`)}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">{idea.scheduled_date ? <>{t("row.onCalendar")}<span className="text-foreground">{slotLabel(fmt, t, idea.scheduled_date, idea.scheduled_time?.slice(0, 5) ?? "—")}</span></> : s ? <>{t("row.suggested")}<span className="text-foreground">{slotLabel(fmt, t, s.date, s.time)}</span> · {t(`confidence.${s.confidence}`).toLowerCase()}{s.source === "heuristic" ? t("row.heuristicSuffix") : ""}</> : t("row.noSuggestion")}</p>
      <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {canEdit && !idea.scheduled_date && !compact ? <>
          <Button size="sm" variant="outline" onClick={a.place}><CalendarPlus /> {t("row.addToCalendar")}</Button>
          {idea.production_stage === "idea" ? <Button size="sm" variant="ghost" onClick={a.production}><Send /> {t("row.production")}</Button> : null}
        </> : null}
        <CreatedBy idea={idea} members={members} />
      </div>
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
  const [f, setF] = React.useState({ title: "", description: "", pillar_id: "", format: "", platforms: ["facebook"] as string[], audience: "", tags: "", tag: "", goal: "" });
  const segment = f.tag ? `${f.tag}s` : "";
  const [busy, setBusy] = React.useState(false);
  const t = useT("backlog");
  const tc = useT("common");
  const td = useT("domain");
  const submit = async () => {
    setBusy(true);
    const r = await createIdeaAction(projectId, { title: f.title, description: f.description || null, pillar_id: f.pillar_id || null, format: f.format || null, target_platforms: f.platforms, target_audience: f.audience || null, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), audience: (f.tag || null) as Audience | null, conversion_goal: f.goal || null });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? t("newIdea.added"));
    onCreated();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("newIdea.title")}</DialogTitle><DialogDescription>{t("newIdea.description")}</DialogDescription></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <Input autoFocus placeholder={t("newIdea.titlePlaceholder")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-[13px]" placeholder={t("newIdea.descriptionPlaceholder")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <NativeSelect value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value, goal: "", pillar_id: "" })} aria-label={t("newIdea.audience")}><option value="">{t("newIdea.audienceAi")}</option>{AUDIENCES.map((a) => <option key={a} value={a}>{td(`audience.${a}`)}</option>)}</NativeSelect>
            <NativeSelect value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} aria-label={t("newIdea.goal")}><option value="">{t("newIdea.goalPlaceholder")}</option>{goalsFor(segment).map((g) => <option key={g.key} value={g.key}>{td(goalKey(g.key))}</option>)}</NativeSelect>
            <NativeSelect value={f.pillar_id} onChange={(e) => setF({ ...f, pillar_id: e.target.value })} aria-label={t("newIdea.pillar")}><option value="">{t("newIdea.noPillar")}</option>{(["students_parents", "teachers", "both"] as Side[]).map((side) => { const list = pillars.filter((p) => (p.segment ?? "students_parents") === side && (!segment || side === "both" || (side === "teachers") === (segment === "teachers"))); return list.length ? <optgroup key={side} label={td(`side.${side}`)}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null; })}</NativeSelect>
            <NativeSelect value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} aria-label={t("newIdea.format")}><option value="">{t("newIdea.formatPlaceholder")}</option>{FORMATS.map((x) => <option key={x} value={x}>{x}</option>)}</NativeSelect>
            <Input placeholder={t("newIdea.targetAudience")} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
            <Input placeholder={t("newIdea.tags")} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-3">{PLATFORM_CHOICES.map((p) => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={f.platforms.includes(p)} onChange={() => setF({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] })} />{PLATFORM_LABELS[p as Platform]}</label>)}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button><Button onClick={submit} disabled={busy || f.title.trim().length < 2}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} {t("newIdea.submit")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WeightsDialog({ projectId, initial, onClose }: { projectId: string; initial: Weights; onClose: () => void }) {
  const [w, setW] = React.useState<Weights>(initial);
  const [busy, setBusy] = React.useState(false);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const t = useT("backlog");
  const tc = useT("common");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("weights.title")}</DialogTitle><DialogDescription>{t("weights.description")}</DialogDescription></DialogHeader>
        <div className="space-y-2 text-[13px]">
          {CRITERIA.map((c) => (
            <label key={c.key} className="flex items-center justify-between gap-3"><span>{t(`criteria.${c.key}`)}</span><Input type="number" min={0} max={100} className="w-24" value={w[c.key]} onChange={(e) => setW({ ...w, [c.key]: Number(e.target.value) || 0 })} /></label>
          ))}
          <p className="text-xs text-muted-foreground">{t("weights.total", { total: Math.round(total), weights: Object.values(normalizeWeights(w)).map((x) => Math.round(x)).join(" / ") })}</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button><Button disabled={busy || !total} onClick={async () => { setBusy(true); const r = await saveScoreWeightsAction(projectId, w); setBusy(false); if (r.ok) { toast.success(r.message ?? t("savedToast")); onClose(); } else toast.error(r.error); }}>{t("weights.save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
