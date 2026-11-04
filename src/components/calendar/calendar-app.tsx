"use client";

import { AudienceFilter } from "@/components/app/audience-badge";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ScheduleDialog } from "@/components/backlog/schedule-dialog";
import type { Idea } from "@/server/services/backlog";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertTriangle, Bookmark, CalendarDays, ChevronLeft, ChevronRight, Filter, Flag, GanttChartSquare, Inbox, List, Loader2, Plus, Search, Trash2, User, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
  CALENDAR_PLATFORMS, FUNNEL_STAGES, WORKFLOW_STATES, type Platform, type WorkflowState,
} from "@/lib/domain/constants";
import { PRIORITIES } from "@/lib/permissions";
import { useFormatter, useT } from "@/i18n/client";
import type { Formatter } from "@/i18n/format";
import { suggestedTime, type PlatformTiming } from "@/lib/calendar/insights";
import { addDays, monthGrid, shiftView, utcToZoned, viewRange, weekDays, weekdayOf, zonedToUtc, type CalendarView } from "@/lib/calendar/time";
import { duplicatePostAction, reschedulePostAction, setProjectTimezoneAction, type Conflict } from "@/server/actions/calendar";
import type { Task } from "@/server/services/team";
import type { ContentItem } from "@/types/domain";
import { cn } from "@/lib/utils";
import { PostCard, type CardAction, type PillarRef } from "./post-card";
import { PostEditor, WorkflowLegend, type EditorDefaults } from "./post-editor";
import { pillarDotClass } from "./styles";
import { CONTENT_TYPES, deadlineConflicts, domainLabel, isOverdue, participants, type Person } from "./planning";
import { DetailPanel } from "./detail-panel";
import { QuickCreate } from "./quick-create";
import { ListView } from "./list-view";
import { BackToBacklogBar, useSelection } from "@/components/backlog/selection-bar";
import { TimelineView } from "./timeline-view";
import { AgendaView } from "./agenda-view";

export type CalendarFilters = {
  platform: string[]; state: string[]; pillar: string; funnel: string; campaign: string; plan: string; from: string; to: string;
  assignee: string; priority: string[]; format: string[]; q: string; mine: boolean; overdue: boolean;
  /** audience tag: student | parent | teacher | none (untagged) */
  audience: string;
};

const EMPTY_FILTERS: Omit<CalendarFilters, never> = {
  platform: [], state: [], pillar: "", funnel: "", campaign: "", plan: "", from: "", to: "", assignee: "", priority: [], format: [], q: "", mine: false, overdue: false, audience: "",
};
const HOURS = Array.from({ length: 18 }, (_, k) => k + 6); // 06:00–23:00; earlier posts sit in the 06 row
const TIMEZONES = ["Africa/Tunis", "Africa/Algiers", "Africa/Casablanca", "Europe/Paris", "Europe/London", "Asia/Dubai", "America/New_York", "UTC"];
const VIEW_META: { id: CalendarView; icon?: typeof List }[] = [
  { id: "month" }, { id: "week" }, { id: "day" },
  { id: "list", icon: List }, { id: "timeline", icon: GanttChartSquare },
];

// The cell under the pointer wins (the drag overlay is wider than a month cell); keyboard drags fall back to overlap.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function periodLabel(fmt: Formatter, view: CalendarView, date: string) {
  if (view === "day") return fmt.day(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "week") {
    const days = weekDays(date);
    return `${fmt.day(days[0], { day: "numeric", month: "short" })} – ${fmt.day(days[6], { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return fmt.day(date, { month: "long", year: "numeric" });
}

/** Local date and time of a post in the project zone (exact slot when set, otherwise its date only). */
function placement(p: ContentItem, tz: string) {
  if (p.scheduled_at) {
    const z = utcToZoned(p.scheduled_at, tz);
    return { date: z.date, time: z.time, hour: z.hour };
  }
  return { date: p.scheduled_date, time: null as string | null, hour: null as number | null };
}

type Preset = { name: string; query: string };
const presetKey = (projectId: string) => `signal:calendar-presets:${projectId}`;
function readPresets(projectId: string): Preset[] {
  try {
    return JSON.parse(localStorage.getItem(presetKey(projectId)) ?? "[]") as Preset[];
  } catch {
    return [];
  }
}

export function CalendarApp({
  projectId, view, date, today, tz, posts: initialPosts, undated: initialUndated, deadlines, tasks, people: peopleList, perms: permList, userId,
  pillars, campaigns, plans, filters, readOnly, aiEnabled, timing: timingPromise, insights, initialItem,
}: {
  projectId: string;
  initialItem?: ContentItem | null;
  view: CalendarView;
  date: string;
  today: string;
  tz: string;
  posts: ContentItem[];
  undated: ContentItem[];
  /** items whose internal deadline is in the period (publication may be elsewhere) */
  deadlines: ContentItem[];
  tasks: Task[];
  people: Person[];
  perms: string[];
  userId: string;
  pillars: { id: string; name: string; color: string | null }[];
  campaigns: { id: string; name: string }[];
  plans: { id: string; name: string }[];
  filters: CalendarFilters;
  readOnly: boolean;
  aiEnabled: boolean;
  /** Streams in after the calendar renders; suggested times appear once it resolves. */
  timing: Promise<PlatformTiming[]>;
  insights: React.ReactNode;
}) {
  const t = useT("calendar");
  const tc = useT("common");
  const td = useT("domain");
  const fmt = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = React.useTransition();
  const [posts, setPosts] = React.useState(initialPosts);
  const [undated, setUndated] = React.useState(initialUndated);
  const selection = useSelection();
  const [editor, setEditor] = React.useState<{ post: ContentItem | null; defaults: EditorDefaults } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(initialItem?.id ?? null);
  const [extra, setExtra] = React.useState<ContentItem | null>(initialItem ?? null);
  const [quick, setQuick] = React.useState<{ date: string | null; time: string | null } | null>(null);
  const [dragging, setDragging] = React.useState<ContentItem | null>(null);
  const [placing, setPlacing] = React.useState<{ post: ContentItem; date: string; time: string | null } | null>(null);
  const [conflict, setConflict] = React.useState<{ post: ContentItem; date: string; time: string | null; list: Conflict[]; previous: ContentItem } | null>(null);
  const [showFilters, setShowFilters] = React.useState(false);
  const [showDeadlines, setShowDeadlines] = React.useState(true);
  const [search, setSearch] = React.useState(filters.q);
  // Presets live in this browser only (per project). They're only rendered inside the closed-by-default menu.
  const [presets, setPresets] = React.useState<Preset[]>(() => (typeof window === "undefined" ? [] : readPresets(projectId)));
  const [timing, setTiming] = React.useState<PlatformTiming[]>([]);
  const perms = React.useMemo(() => new Set(permList), [permList]);
  // Phones get an agenda instead of a dense grid. Rendering only one of the two keeps drag ids unique.
  const narrow = React.useSyncExternalStore(
    (cb) => { const m = window.matchMedia("(max-width: 767px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
  const people = React.useMemo(() => new Map(peopleList.map((p) => [p.user_id, p])), [peopleList]);

  React.useEffect(() => {
    let live = true;
    timingPromise.then((t) => live && setTiming(t), () => live && setTiming([]));
    return () => { live = false; };
  }, [timingPromise]);
  // Server data replaces local (optimistic) state whenever a navigation or refresh delivers new props.
  const [source, setSource] = React.useState({ initialPosts, initialUndated });
  if (source.initialPosts !== initialPosts || source.initialUndated !== initialUndated) {
    setSource({ initialPosts, initialUndated });
    setPosts(initialPosts);
    setUndated(initialUndated);
  }

  const pillarRefs: PillarRef[] = pillars.map((p) => ({ ...p, dot: pillarDotClass(pillars, p.id) }));
  const pillarOf = (id: string | null) => pillarRefs.find((p) => p.id === id) ?? null;
  const activeFilters = (Object.keys(EMPTY_FILTERS) as (keyof CalendarFilters)[])
    .filter((k) => k !== "q" && k !== "mine")
    .filter((k) => { const v = filters[k]; return Array.isArray(v) ? v.length : Boolean(v); }).length;

  const queryOf = (next: { view: CalendarView; date: string } & CalendarFilters) => {
    const q = new URLSearchParams();
    q.set("view", next.view);
    q.set("date", next.date);
    for (const p of next.platform) q.append("platform", p);
    for (const s of next.state) q.append("state", s);
    for (const p of next.priority) q.append("priority", p);
    for (const f of next.format) q.append("format", f);
    for (const k of ["pillar", "funnel", "campaign", "plan", "from", "to", "assignee", "q", "audience"] as const) if (next[k]) q.set(k, next[k]);
    if (next.mine) q.set("mine", "1");
    if (next.overdue) q.set("overdue", "1");
    return q;
  };
  const go = (patch: Partial<{ view: CalendarView; date: string } & CalendarFilters>) => {
    const q = queryOf({ view, date, ...filters, ...patch });
    startNav(() => router.push(`${pathname}?${q}`, { scroll: false }));
  };
  // Search applies after a short pause in typing.
  React.useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => go({ q: search.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` closes over current filters; re-running on its identity would loop
  }, [search]);

  // --- Lookup ---------------------------------------------------------------------------------------------
  const all = React.useMemo(() => {
    const m = new Map<string, ContentItem>();
    for (const p of [...deadlines, ...undated, ...posts, ...(extra ? [extra] : [])]) m.set(p.id, p);
    return m;
  }, [deadlines, undated, posts, extra]);
  const selectedPost = selected ? all.get(selected) ?? null : null;
  const peopleOf = (p: ContentItem) => participants(p, tasks, people, t);
  const isMine = (p: ContentItem) => peopleOf(p).some((x) => x.user_id === userId);
  // Item-level: managers move anything; others only what they lead, created, or collaborate on.
  const canMove = (p: ContentItem) => !readOnly && (perms.has("content.edit_any") || p.created_by === userId || isMine(p));

  // --- Grouping -------------------------------------------------------------------------------------------
  const byDate = new Map<string, { post: ContentItem; time: string | null; hour: number | null }[]>();
  for (const p of posts) {
    const pl = placement(p, tz);
    if (!pl.date) continue;
    byDate.set(pl.date, [...(byDate.get(pl.date) ?? []), { post: p, ...pl }]);
  }
  for (const list of byDate.values()) list.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const deadlinesByDate = new Map<string, ContentItem[]>();
  for (const p of deadlines) if (p.due_date) deadlinesByDate.set(p.due_date, [...(deadlinesByDate.get(p.due_date) ?? []), p]);
  const conflicts = deadlineConflicts([...deadlines, ...posts], tasks);
  const overdueCount = [...all.values()].filter((p) => isOverdue(p, today)).length;

  // --- Create / edit --------------------------------------------------------------------------------------
  const defaultPlatform = (filters.platform[0] as Platform) ?? "instagram";
  const openQuick = (d: string | null, time: string | null) => {
    if (readOnly || !perms.has("content.create")) return;
    setQuick({ date: d, time });
  };
  const openEditor = (post: ContentItem | null, d: string | null = null, time: string | null = null) => {
    const slot = post ? null : time ?? (d ? suggestedTime(timing.find((x) => x.platform === defaultPlatform), weekdayOf(d)) : null);
    setEditor({ post, defaults: { date: d, time: slot, platform: (post?.platform as Platform) ?? defaultPlatform } });
  };
  const upsertLocal = (p: ContentItem) => {
    setPosts((list) => [...list.filter((x) => x.id !== p.id), ...(p.scheduled_date ? [p] : [])]);
    setUndated((list) => [...list.filter((x) => x.id !== p.id), ...(!p.scheduled_date ? [p] : [])]);
    setExtra((e) => (e?.id === p.id ? p : e));
  };
  const removeLocal = (id: string) => {
    setPosts((list) => list.filter((x) => x.id !== id));
    setUndated((list) => list.filter((x) => x.id !== id));
    if (selected === id) setSelected(null);
  };
  const openDetails = (p: ContentItem) => {
    setExtra(p);
    setSelected(p.id);
  };

  // --- Moving: the UI moves first and reverts on failure; every move offers Undo ------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const move = async (post: ContentItem, toDate: string, toTime: string | null, force = false, previous = post, undoable = true) => {
    const keep = toTime ?? post.scheduled_time?.slice(0, 5) ?? null;
    const optimistic: ContentItem = { ...post, scheduled_date: toDate, scheduled_time: keep, scheduled_at: keep ? zonedToUtc(toDate, keep, tz) : null };
    upsertLocal(optimistic);
    const r = await reschedulePostAction(projectId, post.id, toDate, toTime, force);
    if (!r.ok) {
      upsertLocal(previous);
      return toast.error(r.error);
    }
    if (r.data?.conflicts?.length) {
      upsertLocal(previous);
      return setConflict({ post, date: toDate, time: toTime, list: r.data.conflicts, previous });
    }
    const moved = r.data?.post;
    if (moved) upsertLocal(moved);
    const back = previous.scheduled_date;
    toast.success(r.message, undoable && back && moved
      ? { action: { label: t("grid.undo"), onClick: () => void move(moved, back, previous.scheduled_time?.slice(0, 5) ?? null, true, moved, false) } }
      : undefined);
  };

  const duplicate = async (post: ContentItem) => {
    const r = await duplicatePostAction(projectId, post.id);
    if (!r.ok) return toast.error(r.error);
    if (r.data?.post) { upsertLocal(r.data.post); openDetails(r.data.post); }
    toast.success(r.message);
  };

  const onCardAction = (action: CardAction, post: ContentItem) => {
    if (action === "open") return openDetails(post);
    if (action === "brief") return router.push(`/p/${projectId}/production?item=${post.id}`);
    if (action === "duplicate") return void duplicate(post);
    const from = post.scheduled_date ?? today;
    void move(post, addDays(from, action === "tomorrow" ? 1 : 7), null);
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.post as ContentItem) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const post = e.active.data.current?.post as ContentItem | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!post || !target) return;
    const [kind, d, hour] = target.split("|");
    const pl = placement(post, tz);
    // an idea dropped from the Backlog opens the scheduling panel (suggested time, alternatives, platforms) first
    if (!post.scheduled_date && (kind === "day" || kind === "slot")) {
      setPlacing({ post, date: d, time: kind === "slot" ? `${hour.padStart(2, "0")}:00` : null });
      return;
    }
    if (kind === "day") {
      if (pl.date === d) return;
      void move(post, d, null);
    } else if (kind === "slot") {
      const minutes = pl.hour === Number(hour) && pl.time ? pl.time.slice(3, 5) : "00";
      const time = `${hour.padStart(2, "0")}:${minutes}`;
      if (pl.date === d && pl.time === time) return;
      void move(post, d, time);
    }
  };

  const card = (entry: { post: ContentItem; time: string | null }, compact = false) => (
    <PostCard
      key={entry.post.id}
      post={entry.post}
      time={entry.time}
      pillar={pillarOf(entry.post.pillar_id)}
      compact={compact}
      readOnly={!canMove(entry.post)}
      people={peopleOf(entry.post)}
      overdue={isOverdue(entry.post, today)}
      mine={isMine(entry.post)}
      onOpen={openDetails}
      onAction={onCardAction}
    />
  );
  const deadlineChip = (p: ContentItem) => (
    <Tooltip key={`dl-${p.id}`} content={p.scheduled_date ? t("grid.deadlineTooltipPublishes", { title: p.title, date: p.scheduled_date }) : t("grid.deadlineTooltip", { title: p.title })}>
      <button
        type="button"
        onClick={() => openDetails(p)}
        className={cn(
          "flex w-full items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-left text-[10.5px] leading-tight transition-colors hover:bg-accent",
          isOverdue(p, today) ? "border-destructive/50 text-destructive" : "text-muted-foreground",
        )}
      >
        <Flag className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">{t("grid.deadlineSr")}</span>
        <span className="truncate" dir="auto">{p.title}</span>
      </button>
    </Tooltip>
  );
  const conflictMark = (d: string) => {
    const busy = conflicts.get(d);
    if (!busy) return null;
    const names = busy.map((b) => t("grid.workloadEntry", { name: people.get(b.userId)?.name ?? t("people.someone"), count: b.count })).join(", ");
    return (
      <Tooltip content={t("grid.workload", { names })}>
        <span className="inline-flex"><AlertTriangle className="size-3 text-warning" aria-label={t("grid.workloadAria", { names })} /></span>
      </Tooltip>
    );
  };

  const range = viewRange(view, date);
  // Backlog ideas live only in the Backlog: the calendar lists dated posts
  const listRows = posts.map((p) => ({ post: p, time: placement(p, tz).time, people: peopleOf(p) }));
  const timelineRows = [...new Map([...posts, ...deadlines].map((p) => [p.id, p])).values()].map((p) => ({ post: p, people: peopleOf(p) }));
  const agendaDays = view === "day" ? [date] : view === "week" ? weekDays(date) : (() => { const out: string[] = []; for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d); return out; })();

  const savePreset = () => {
    const name = window.prompt(t("presets.prompt"), filters.mine ? t("presets.myWork") : t("presets.defaultName"))?.trim();
    if (!name) return;
    const q = queryOf({ view, date, ...filters });
    q.delete("view");
    q.delete("date");
    const next = [...presets.filter((p) => p.name !== name), { name, query: q.toString() }].slice(-12);
    try { localStorage.setItem(presetKey(projectId), JSON.stringify(next)); } catch { /* private mode: keep in memory */ }
    setPresets(next);
    toast.success(t("presets.saved", { name }));
  };
  const applyPreset = (p: Preset) => {
    const q = new URLSearchParams(p.query);
    q.set("view", view);
    q.set("date", date);
    startNav(() => router.push(`${pathname}?${q}`, { scroll: false }));
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    try { localStorage.setItem(presetKey(projectId), JSON.stringify(next)); } catch { /* ignore */ }
    setPresets(next);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar ---------------------------------------------------------------------------------------- */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="scrollbar-thin inline-flex max-w-full overflow-x-auto rounded-lg border bg-secondary p-0.5" role="tablist" aria-label={t("toolbar.viewTabs")}>
            {VIEW_META.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => go({ view: v.id })}
                className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors", view === v.id ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
              >
                {v.icon ? <v.icon className="size-3.5" /> : null}
                {t(`views.${v.id}`)}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={t("toolbar.previous")} onClick={() => go({ date: shiftView(view, date, -1) })}><ChevronLeft /></Button>
            <Button variant="outline" size="sm" onClick={() => go({ date: today })}>{t("toolbar.today")}</Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("toolbar.next")} onClick={() => go({ date: shiftView(view, date, 1) })}><ChevronRight /></Button>
          </div>
          <label className="relative inline-flex items-center">
            <span className="sr-only">{t("toolbar.goToDate")}</span>
            <h2 className="pointer-events-none flex items-center gap-2 text-[15px] font-semibold">
              {periodLabel(fmt, view, date)}
              {navigating ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            </h2>
            <Input type="date" aria-label={t("toolbar.goToDate")} value={date} onChange={(e) => e.target.value && go({ date: e.target.value })} className="absolute inset-0 h-full cursor-pointer opacity-0" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AudienceFilter className="h-8 w-36 text-[13px]" value={filters.audience} onChange={(v) => go({ audience: v })} />
          <div className="inline-flex rounded-lg border bg-secondary p-0.5" role="group" aria-label={t("toolbar.whoseWork")}>
            <button type="button" aria-pressed={!filters.mine} onClick={() => go({ mine: false })} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium", !filters.mine ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}><Users className="size-3.5" /> {t("toolbar.team")}</button>
            <button type="button" aria-pressed={filters.mine} onClick={() => go({ mine: true })} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium", filters.mine ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}><User className="size-3.5" /> {t("toolbar.myWork")}</button>
          </div>
          <label className="relative">
            <span className="sr-only">{t("toolbar.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("toolbar.searchPlaceholder")} className="h-8 w-44 pl-8 text-[13px]" />
          </label>
          <Button variant={showFilters || activeFilters ? "secondary" : "outline"} size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <Filter /> {activeFilters ? t("toolbar.filtersCount", { count: activeFilters }) : t("toolbar.filters")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t("toolbar.presets")}><Bookmark /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>{t("presets.heading")}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => go({ ...EMPTY_FILTERS, mine: true })}><User /> {t("presets.myWork")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go({ ...EMPTY_FILTERS, overdue: true })}><Flag /> {t("presets.overdue")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go({ ...EMPTY_FILTERS, assignee: "none" })}><Users /> {t("presets.unassigned")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go({ ...EMPTY_FILTERS, state: ["pending"] })}><Inbox /> {t("presets.awaitingApproval")}</DropdownMenuItem>
              {presets.length ? <DropdownMenuSeparator /> : null}
              {presets.map((p) => (
                <DropdownMenuItem key={p.name} onSelect={() => applyPreset(p)}>
                  <Bookmark /> <span className="flex-1 truncate">{p.name}</span>
                  <button type="button" aria-label={t("presets.delete", { name: p.name })} className="rounded p-0.5 hover:bg-muted" onClick={(e) => { e.preventDefault(); e.stopPropagation(); deletePreset(p.name); }}>
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={savePreset}><Plus /> {t("presets.saveCurrent")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!readOnly && perms.has("content.create") ? <Button size="sm" onClick={() => openQuick(view === "day" ? date : null, null)}><Plus /> {t("toolbar.newIdea")}</Button> : null}
        </div>
      </div>

      {/* Quick status line ---------------------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <button type="button" onClick={() => go({ overdue: !filters.overdue })} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent", filters.overdue && "bg-destructive/10 font-medium text-destructive")} aria-pressed={filters.overdue}>
          <Flag className="size-3.5" /> {t("statusLine.overdue", { count: overdueCount })}
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="accent-[var(--primary)]" checked={showDeadlines} onChange={(e) => setShowDeadlines(e.target.checked)} />
          {t("statusLine.showDeadlines")}
        </label>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-l-[3px] bg-card" /> {t("statusLine.publication")}</span>
        <span className="inline-flex items-center gap-1"><Flag className="size-3" /> {t("statusLine.deadline")}</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3 text-warning" /> {t("statusLine.workload")}</span>
        {filters.mine || activeFilters || filters.q ? (
          <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-accent" onClick={() => { setSearch(""); go({ ...EMPTY_FILTERS }); }}>
            <X className="size-3.5" /> {t("statusLine.clearAll")}
          </button>
        ) : null}
        <span className="ml-auto">
          <NativeSelect
            aria-label={t("statusLine.timeZone")}
            value={tz}
            disabled={readOnly}
            onChange={async (e) => {
              const r = await setProjectTimezoneAction(projectId, e.target.value);
              if (!r.ok) toast.error(r.error);
              else if (r.message) toast.success(r.message);
            }}
            className="h-7 w-40 text-xs"
          >
            {[...new Set([tz, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
          </NativeSelect>
        </span>
      </div>

      {/* Filters ---------------------------------------------------------------------------------------- */}
      {showFilters ? (
        <div className="grid gap-3 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
          <Select label={t("filters.assignee")} allLabel={tc("states.all")} value={filters.assignee} onChange={(v) => go({ assignee: v })} options={[{ value: "none", label: t("people.unassigned") }, ...peopleList.map((p) => ({ value: p.user_id, label: p.name || t("people.unnamed") }))]} />
          <Select label={t("filters.pillar")} allLabel={tc("states.all")} value={filters.pillar} onChange={(v) => go({ pillar: v })} options={[...pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: t("filters.noPillar") }]} />
          <Select label={t("filters.campaign")} allLabel={tc("states.all")} value={filters.campaign} onChange={(v) => go({ campaign: v })} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
          <Select label={t("filters.plan")} allLabel={tc("states.all")} value={filters.plan} onChange={(v) => go({ plan: v })} options={plans.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterGroup label={t("filters.platform")} className="sm:col-span-2">
            {([...CALENDAR_PLATFORMS, "linkedin", "tiktok", "youtube"] as Platform[]).map((p) => <Chip key={p} on={filters.platform.includes(p)} onClick={() => go({ platform: toggle(filters.platform, p) })}>{domainLabel(td, "platform", p)}</Chip>)}
          </FilterGroup>
          <FilterGroup label={t("filters.status")} className="sm:col-span-2">
            {WORKFLOW_STATES.map((s) => <Chip key={s} on={filters.state.includes(s)} onClick={() => go({ state: toggle(filters.state, s) })}>{td(`workflow.${s}`)}</Chip>)}
          </FilterGroup>
          <FilterGroup label={t("filters.priority")}>
            {PRIORITIES.map((p) => <Chip key={p} on={filters.priority.includes(p)} onClick={() => go({ priority: toggle(filters.priority, p) })}>{td(`priority.${p}`)}</Chip>)}
          </FilterGroup>
          <FilterGroup label={t("filters.contentType")} className="lg:col-span-2">
            {CONTENT_TYPES.map((ct) => <Chip key={ct.value} on={filters.format.includes(ct.value)} onClick={() => go({ format: toggle(filters.format, ct.value) })}>{t(`formats.${ct.key}`)}</Chip>)}
          </FilterGroup>
          <Select label={t("filters.funnel")} allLabel={tc("states.all")} value={filters.funnel} onChange={(v) => go({ funnel: v })} options={FUNNEL_STAGES.map((f) => ({ value: f, label: td(`funnel.${f}`) }))} />
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <label className="grid gap-1 text-xs font-medium">{t("filters.from")}<Input type="date" value={filters.from} onChange={(e) => go({ from: e.target.value })} className="h-8" /></label>
            <label className="grid gap-1 text-xs font-medium">{t("filters.to")}<Input type="date" value={filters.to} onChange={(e) => go({ to: e.target.value })} className="h-8" /></label>
          </div>
          <div className="flex items-end justify-end sm:col-span-2"><WorkflowLegend /></div>
        </div>
      ) : null}

      <DndContext id="editorial-calendar" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className={cn("grid gap-4", view !== "list" && view !== "timeline" && "2xl:grid-cols-[minmax(0,1fr)_17rem]")}>
          <div className={cn("min-w-0 space-y-4 transition-opacity", navigating && "opacity-60")} aria-busy={navigating}>
            {view === "list" ? (
              listRows.length ? <>
                {!readOnly ? <BackToBacklogBar projectId={projectId} ids={[...selection.selected].filter((id) => listRows.some((r) => r.post.id === id))} onClear={selection.clear} onDone={() => { const gone = new Set(selection.selected); setPosts((l) => l.filter((p) => !gone.has(p.id) || p.status === "scheduled" || p.status === "published")); }} /> : null}
                <ListView rows={listRows} today={today} onOpen={openDetails} selection={readOnly ? undefined : { ...selection, canSelect: (p) => Boolean(p.scheduled_date) && canMove(p) && p.status !== "published" && p.status !== "scheduled" }} />
              </> : <Empty readOnly={readOnly} filtered={Boolean(activeFilters || filters.mine || filters.q)} onCreate={() => openQuick(null, null)} />
            ) : view === "timeline" ? (
              timelineRows.length ? <TimelineView rows={timelineRows} from={range.from} to={range.to} today={today} onOpen={openDetails} /> : <Empty readOnly={readOnly} filtered={Boolean(activeFilters || filters.mine || filters.q)} onCreate={() => openQuick(null, null)} />
            ) : (
              <>
                {!narrow ? (
                <div>
                  {view === "month" ? (
                    <MonthGrid date={date} today={today} byDate={byDate} deadlinesByDate={showDeadlines ? deadlinesByDate : new Map()} deadlineChip={deadlineChip} conflictMark={conflictMark} card={card} onCreate={(d) => openQuick(d, null)} onShowDay={(d) => go({ view: "day", date: d })} readOnly={readOnly} />
                  ) : (
                    <TimeGrid days={view === "week" ? weekDays(date) : [date]} today={today} byDate={byDate} deadlinesByDate={showDeadlines ? deadlinesByDate : new Map()} deadlineChip={deadlineChip} conflictMark={conflictMark} card={card} onCreate={openQuick} readOnly={readOnly} wide={view === "day"} />
                  )}
                </div>
                ) : (
                <div>
                  <AgendaView days={agendaDays} byDate={byDate} deadlinesByDate={showDeadlines ? deadlinesByDate : new Map()} today={today} card={(e) => card(e)} onCreate={(d) => openQuick(d, null)} readOnly={readOnly || !perms.has("content.create")} />
                </div>
                )}
                {!posts.length && !navigating ? <Empty readOnly={readOnly} filtered={Boolean(activeFilters || filters.mine || filters.q)} onCreate={() => openQuick(view === "day" ? date : null, null)} /> : null}
              </>
            )}
          </div>
          {view !== "list" && view !== "timeline" ? (
            <div className="space-y-4">
              <UndatedTray posts={undated} projectId={projectId} />
              {insights}
            </div>
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className="w-56 rotate-1 opacity-90">{card({ post: dragging, time: placement(dragging, tz).time })}</div> : null}
        </DragOverlay>
      </DndContext>

      {selectedPost ? (
        <DetailPanel
          key={selectedPost.id + selectedPost.updated_at}
          projectId={projectId}
          post={selectedPost}
          time={placement(selectedPost, tz).time}
          tz={tz}
          tasks={tasks}
          people={people}
          perms={perms}
          userId={userId}
          today={today}
          readOnly={!canMove(selectedPost)}
          onClose={() => setSelected(null)}
          onChanged={(p) => { upsertLocal({ ...selectedPost, ...p }); router.refresh(); }}
          onMove={(p, d, t) => void move(p, d, t)}
          onDuplicate={(p) => void duplicate(p)}
          onEdit={(p) => { setSelected(null); openEditor(p); }}
        />
      ) : null}

      {quick ? (
        <QuickCreate
          projectId={projectId}
          date={quick.date}
          time={quick.time}
          platform={defaultPlatform}
          people={peopleList}
          canAssign={perms.has("content.assign")}
          onClose={() => setQuick(null)}
          onCreated={(p) => { setQuick(null); upsertLocal(p); openDetails(p); }}
          onMore={() => { const q = quick; setQuick(null); openEditor(null, q.date, q.time); }}
        />
      ) : null}

      {editor ? (
        <PostEditor
          key={editor.post?.id ?? "new"}
          projectId={projectId}
          post={editor.post}
          defaults={editor.defaults}
          pillars={pillars}
          campaigns={campaigns}
          tz={tz}
          timing={timing}
          aiEnabled={aiEnabled}
          readOnly={readOnly || (editor.post ? !canMove(editor.post) : false)}
          onClose={() => setEditor(null)}
          onSaved={(p) => { upsertLocal(p); setEditor(null); }}
          onDeleted={(id) => { removeLocal(id); setEditor(null); }}
        />
      ) : null}

      {placing ? <ScheduleDialog projectId={projectId} tz={tz} idea={placing.post as Idea} date={placing.date} onClose={() => setPlacing(null)} onPlaced={() => { setPlacing(null); router.refresh(); }} /> : null}

      <Dialog open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> {t("conflictDialog.title")}</DialogTitle>
            <DialogDescription>
              {conflict ? t("conflictDialog.description", { platform: conflict.post.platform && td.has(`platform.${conflict.post.platform}`) ? domainLabel(td, "platform", conflict.post.platform) : "", when: `${conflict.date}${conflict.time ? ` ${conflict.time}` : ""}` }) : null}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-[13px]">{conflict?.list.map((c) => <li key={c.id}>{c.time} · {c.title}</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>{tc("actions.cancel")}</Button>
            <Button onClick={() => { const c = conflict!; setConflict(null); void move(c.post, c.date, c.time, true, c.previous); }}>{t("conflictDialog.moveAnyway")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Empty({ readOnly, filtered, onCreate }: { readOnly: boolean; filtered: boolean; onCreate: () => void }) {
  const t = useT("calendar");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 p-8 text-center">
      <CalendarDays className="size-5 text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">
        {filtered ? t("empty.filtered") : readOnly ? t("empty.readOnly") : t("empty.none")}
      </p>
      {!readOnly && !filtered ? <Button size="sm" variant="outline" onClick={onCreate}><Plus /> {t("empty.addIdea")}</Button> : null}
    </div>
  );
}

function FilterGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <span className="text-xs font-medium">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-md border px-2 py-1 text-xs transition-colors", on ? "border-primary/30 bg-primary-soft font-medium text-primary" : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground")}>
      {children}
    </button>
  );
}

function Select({ label, allLabel, value, onChange, options }: { label: string; allLabel: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );
}

type Entry = { post: ContentItem; time: string | null; hour: number | null };

function DayCell({ id, className, onCreate, readOnly, label, children }: { id: string; className?: string; onCreate?: () => void; readOnly: boolean; label?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { if (e.target === e.currentTarget && onCreate) onCreate(); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onCreate) { e.preventDefault(); onCreate(); } }}
      tabIndex={!readOnly && onCreate ? 0 : undefined}
      aria-label={!readOnly && onCreate ? label : undefined}
      className={cn(className, "transition-colors", isOver && "bg-primary-soft ring-2 ring-inset ring-primary/40", !readOnly && onCreate && "cursor-pointer hover:bg-muted/40")}
    >
      {children}
    </div>
  );
}

function MonthGrid({ date, today, byDate, deadlinesByDate, deadlineChip, conflictMark, card, onCreate, onShowDay, readOnly }: {
  date: string; today: string; byDate: Map<string, Entry[]>; deadlinesByDate: Map<string, ContentItem[]>;
  deadlineChip: (p: ContentItem) => React.ReactNode; conflictMark: (d: string) => React.ReactNode;
  card: (e: Entry, compact?: boolean) => React.ReactNode; onCreate: (d: string) => void; onShowDay: (d: string) => void; readOnly: boolean;
}) {
  const t = useT("calendar");
  const fmt = useFormatter();
  const month = date.slice(0, 7);
  return (
    <div className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] font-medium text-muted-foreground">
          {monthGrid(date)[0].map((d) => <div key={d} className="px-2 py-1.5">{fmt.day(d, { weekday: "short" })}</div>)}
        </div>
        {monthGrid(date).map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((d) => {
              const entries = byDate.get(d) ?? [];
              const dls = deadlinesByDate.get(d) ?? [];
              const other = !d.startsWith(month);
              const past = d < today;
              return (
                <DayCell key={d} id={`day|${d}`} readOnly={readOnly} label={t("grid.addIdeaOn", { date: d })} onCreate={() => onCreate(d)} className={cn("group/day min-h-32 space-y-1 border-r p-1 last:border-r-0", other && "bg-muted/30", past && !other && "bg-muted/15")}>
                  <div className="pointer-events-none flex items-center justify-between gap-1 px-0.5">
                    <span className={cn("text-[11px] tabular-nums", other ? "text-muted-foreground/60" : "text-muted-foreground", d === today && "rounded bg-primary px-1 font-semibold text-primary-foreground")}>{Number(d.slice(8))}</span>
                    <span className="pointer-events-auto flex items-center gap-1">
                      {conflictMark(d)}
                      {!readOnly ? <Plus className="size-3 text-muted-foreground opacity-0 group-hover/day:opacity-100" /> : null}
                    </span>
                  </div>
                  {dls.slice(0, 2).map(deadlineChip)}
                  {entries.slice(0, 3).map((e) => card(e, true))}
                  {entries.length > 3 || dls.length > 2 ? (
                    <button type="button" onClick={() => onShowDay(d)} className="w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:bg-accent">
                      {t("grid.more", { count: Math.max(0, entries.length - 3) + Math.max(0, dls.length - 2) })}
                    </button>
                  ) : null}
                </DayCell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeGrid({ days, today, byDate, deadlinesByDate, deadlineChip, conflictMark, card, onCreate, readOnly, wide }: {
  days: string[]; today: string; byDate: Map<string, Entry[]>; deadlinesByDate: Map<string, ContentItem[]>;
  deadlineChip: (p: ContentItem) => React.ReactNode; conflictMark: (d: string) => React.ReactNode;
  card: (e: Entry, compact?: boolean) => React.ReactNode; onCreate: (d: string, time: string | null) => void; readOnly: boolean; wide: boolean;
}) {
  const t = useT("calendar");
  const fmt = useFormatter();
  const cols = wide ? "grid-cols-[3.5rem_1fr]" : "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
  return (
    <div className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
      <div className={cn(wide ? "min-w-0" : "min-w-[880px]")}>
        <div className={cn("sticky top-0 z-10 grid border-b bg-card", cols)}>
          <div />
          {days.map((d) => (
            <div key={d} className="flex items-center justify-between gap-1 border-l px-2 py-1.5 text-[12px]">
              <span>
                <span className="text-muted-foreground">{fmt.day(d, { weekday: "short" })}</span>{" "}
                <span className={cn("font-medium tabular-nums", d === today && "rounded bg-primary px-1 text-primary-foreground")}>{fmt.day(d, { day: "numeric", month: wide ? "long" : "short" })}</span>
              </span>
              {conflictMark(d)}
            </div>
          ))}
        </div>
        {/* deadlines and date-only posts (no time yet) */}
        <div className={cn("grid border-b bg-muted/20", cols)}>
          <div className="px-1 py-1.5 text-[10px] leading-tight text-muted-foreground">{t("grid.allDay")}</div>
          {days.map((d) => (
            <DayCell key={d} id={`day|${d}`} readOnly={readOnly} label={t("grid.addIdeaOn", { date: d })} onCreate={() => onCreate(d, null)} className="min-h-10 space-y-1 border-l p-1">
              {(deadlinesByDate.get(d) ?? []).map(deadlineChip)}
              {(byDate.get(d) ?? []).filter((e) => e.time === null).map((e) => card(e, !wide))}
            </DayCell>
          ))}
        </div>
        {HOURS.map((h) => (
          <div key={h} className={cn("grid border-b last:border-b-0", cols)}>
            <div className="px-1 pt-1 text-right text-[10px] tabular-nums text-muted-foreground">{String(h).padStart(2, "0")}:00</div>
            {days.map((d) => (
              <DayCell
                key={d}
                id={`slot|${d}|${h}`}
                readOnly={readOnly}
                label={t("grid.addIdeaAt", { date: d, time: `${String(h).padStart(2, "0")}:00` })}
                onCreate={() => onCreate(d, `${String(h).padStart(2, "0")}:00`)}
                className={cn("min-h-12 space-y-1 border-l p-1", d === today && "bg-primary/[0.03]")}
              >
                {(byDate.get(d) ?? []).filter((e) => e.hour !== null && (e.hour === h || (h === 6 && e.hour < 6))).map((e) => card(e, !wide))}
              </DayCell>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Backlog ideas aren't shown on the calendar: only a count and a link to the Backlog, where they get a date. */
function UndatedTray({ posts, projectId }: { posts: ContentItem[]; projectId: string }) {
  const t = useT("calendar");
  const tc = useT("common");
  if (!posts.length) return null;
  return (
    <Link href={`/p/${projectId}/backlog`} className="flex items-center gap-1.5 rounded-xl border bg-card p-3 text-[13px] font-semibold shadow-xs hover:border-primary">
      <Inbox className="size-4" /> {t("tray.title")} <span className="text-xs font-normal text-muted-foreground">{t("tray.waiting", { count: posts.length, plus: posts.length >= 200 ? "+" : "" })}</span>
      <span className="ml-auto text-xs font-normal text-primary">{tc("actions.open")}</span>
    </Link>
  );
}

export type { WorkflowState };
