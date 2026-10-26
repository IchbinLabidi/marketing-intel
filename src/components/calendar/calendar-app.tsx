"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Filter, Inbox, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CALENDAR_PLATFORMS, FUNNEL_LABELS, FUNNEL_STAGES, PLATFORM_LABELS, WORKFLOW_LABELS, WORKFLOW_STATES, type Platform, type WorkflowState,
} from "@/lib/domain/constants";
import { suggestedTime, type PlatformTiming } from "@/lib/calendar/insights";
import { monthGrid, shiftView, utcToZoned, weekDays, weekdayOf, zonedToUtc, type CalendarView } from "@/lib/calendar/time";
import { reschedulePostAction, setProjectTimezoneAction, type Conflict } from "@/server/actions/calendar";
import type { ContentItem } from "@/types/domain";
import { cn } from "@/lib/utils";
import { PostCard, stateOf, type PillarRef } from "./post-card";
import { PostEditor, WorkflowLegend, type EditorDefaults } from "./post-editor";
import { pillarDotClass } from "./styles";

export type CalendarFilters = { platform: string[]; state: string[]; pillar: string; funnel: string; campaign: string; plan: string; from: string; to: string };

const HOURS = Array.from({ length: 18 }, (_, k) => k + 6); // 06:00–23:00; earlier posts sit in the 06 row
const TIMEZONES = ["Africa/Tunis", "Africa/Algiers", "Africa/Casablanca", "Europe/Paris", "Europe/London", "Asia/Dubai", "America/New_York", "UTC"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The cell under the pointer wins (the drag overlay is wider than a month cell); keyboard drags fall back to overlap.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

function periodLabel(view: CalendarView, date: string) {
  if (view === "month") return fmtDay(date, { month: "long", year: "numeric" });
  if (view === "day") return fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const days = weekDays(date);
  return `${fmtDay(days[0], { day: "numeric", month: "short" })} – ${fmtDay(days[6], { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Local date and time of a post in the project zone (exact slot when set, otherwise its date only). */
function placement(p: ContentItem, tz: string) {
  if (p.scheduled_at) {
    const z = utcToZoned(p.scheduled_at, tz);
    return { date: z.date, time: z.time, hour: z.hour };
  }
  return { date: p.scheduled_date, time: null as string | null, hour: null as number | null };
}

export function CalendarApp({
  projectId, view, date, today, tz, posts: initialPosts, undated: initialUndated, pillars, campaigns, plans, filters, readOnly, aiEnabled, timing: timingPromise, insights, initialItem,
}: {
  projectId: string;
  initialItem?: ContentItem | null;
  view: CalendarView;
  date: string;
  today: string;
  tz: string;
  posts: ContentItem[];
  undated: ContentItem[];
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
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = React.useTransition();
  const [posts, setPosts] = React.useState(initialPosts);
  const [undated, setUndated] = React.useState(initialUndated);
  const [editor, setEditor] = React.useState<{ post: ContentItem | null; defaults: EditorDefaults } | null>(() => initialItem ? { post: initialItem, defaults: { date: null, time: null, platform: initialItem.platform || "instagram" } } : null);
  const [dragging, setDragging] = React.useState<ContentItem | null>(null);
  const [conflict, setConflict] = React.useState<{ post: ContentItem; date: string; time: string | null; list: Conflict[]; previous: ContentItem } | null>(null);
  const [showFilters, setShowFilters] = React.useState(Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v)));
  const [timing, setTiming] = React.useState<PlatformTiming[]>([]);
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
  const activeFilters = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length : v)).length;

  const go = (patch: Partial<{ view: CalendarView; date: string } & CalendarFilters>) => {
    const next = { view, date, ...filters, ...patch };
    const q = new URLSearchParams();
    q.set("view", next.view);
    q.set("date", next.date);
    for (const p of next.platform) q.append("platform", p);
    for (const s of next.state) q.append("state", s);
    for (const k of ["pillar", "funnel", "campaign", "plan", "from", "to"] as const) if (next[k]) q.set(k, next[k]);
    startNav(() => router.push(`${pathname}?${q}`, { scroll: false }));
  };

  // --- Grouping -------------------------------------------------------------------------------------------
  const byDate = new Map<string, { post: ContentItem; time: string | null; hour: number | null }[]>();
  for (const p of posts) {
    const pl = placement(p, tz);
    if (!pl.date) continue;
    byDate.set(pl.date, [...(byDate.get(pl.date) ?? []), { post: p, ...pl }]);
  }
  for (const list of byDate.values()) list.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  // --- Create / edit --------------------------------------------------------------------------------------
  const defaultPlatform = (filters.platform[0] as Platform) ?? "instagram";
  const openNew = (d: string | null, time: string | null) => {
    if (readOnly) return;
    const t = time ?? (d ? suggestedTime(timing.find((x) => x.platform === defaultPlatform), weekdayOf(d)) : null);
    setEditor({ post: null, defaults: { date: d, time: t, platform: defaultPlatform } });
  };
  const upsertLocal = (p: ContentItem) => {
    setPosts((list) => [...list.filter((x) => x.id !== p.id), ...(p.scheduled_date ? [p] : [])]);
    setUndated((list) => [...list.filter((x) => x.id !== p.id), ...(!p.scheduled_date ? [p] : [])]);
  };
  const removeLocal = (id: string) => {
    setPosts((list) => list.filter((x) => x.id !== id));
    setUndated((list) => list.filter((x) => x.id !== id));
  };

  // --- Drag and drop: the database is updated; the UI moves first and reverts on failure -----------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));

  const move = async (post: ContentItem, toDate: string, toTime: string | null, force = false, previous = post) => {
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
    if (r.data?.post) upsertLocal(r.data.post);
    toast.success(r.message); // the action revalidates the page; no extra refresh needed
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.post as ContentItem) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const post = e.active.data.current?.post as ContentItem | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!post || !target) return;
    const [kind, d, hour] = target.split("|");
    const pl = placement(post, tz);
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
    <PostCard key={entry.post.id} post={entry.post} time={entry.time} pillar={pillarOf(entry.post.pillar_id)} compact={compact} readOnly={readOnly} onOpen={(p) => setEditor({ post: p, defaults: { date: null, time: null, platform: (p.platform as Platform) ?? "instagram" } })} />
  );

  return (
    <div className="space-y-4">
      {/* Toolbar ---------------------------------------------------------------------------------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Calendar view">
            {(["month", "week", "day"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => go({ view: v })} className={cn("rounded px-2.5 py-1 text-[13px] font-medium capitalize transition-colors", view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {v}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={`Previous ${view}`} onClick={() => go({ date: shiftView(view, date, -1) })}><ChevronLeft /></Button>
            <Button variant="outline" size="sm" onClick={() => go({ date: today })}>Today</Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Next ${view}`} onClick={() => go({ date: shiftView(view, date, 1) })}><ChevronRight /></Button>
          </div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {periodLabel(view, date)}
            {navigating ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={showFilters ? "secondary" : "outline"} size="sm" onClick={() => setShowFilters((s) => !s)}>
            <Filter /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          <NativeSelect
            aria-label="Time zone"
            value={tz}
            disabled={readOnly}
            onChange={async (e) => {
              const r = await setProjectTimezoneAction(projectId, e.target.value);
              if (!r.ok) toast.error(r.error);
              else if (r.message) toast.success(r.message);
            }}
            className="h-8 w-44 text-[13px]"
          >
            {[...new Set([tz, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
          </NativeSelect>
          {!readOnly ? <Button size="sm" onClick={() => openNew(view === "month" ? null : date, null)}><Plus /> Create post</Button> : null}
        </div>
      </div>

      {/* Filters ---------------------------------------------------------------------------------------- */}
      {showFilters ? (
        <div className="grid gap-3 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
          <FilterGroup label="Platform">
            {CALENDAR_PLATFORMS.map((p) => (
              <Chip key={p} on={filters.platform.includes(p)} onClick={() => go({ platform: toggle(filters.platform, p) })}>{PLATFORM_LABELS[p]}</Chip>
            ))}
          </FilterGroup>
          <FilterGroup label="Status" className="lg:col-span-3">
            {WORKFLOW_STATES.map((s) => <Chip key={s} on={filters.state.includes(s)} onClick={() => go({ state: toggle(filters.state, s) })}>{WORKFLOW_LABELS[s]}</Chip>)}
          </FilterGroup>
          <Select label="Content pillar" value={filters.pillar} onChange={(v) => go({ pillar: v })} options={[...pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No pillar" }]} />
          <Select label="Funnel stage" value={filters.funnel} onChange={(v) => go({ funnel: v })} options={FUNNEL_STAGES.map((f) => ({ value: f, label: FUNNEL_LABELS[f] }))} />
          <Select label="Campaign" value={filters.campaign} onChange={(v) => go({ campaign: v })} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
          <Select label="Plan" value={filters.plan} onChange={(v) => go({ plan: v })} options={plans.map((c) => ({ value: c.id, label: c.name }))} />
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <label className="grid gap-1 text-xs font-medium">From<Input type="date" value={filters.from} onChange={(e) => go({ from: e.target.value })} className="h-8" /></label>
            <label className="grid gap-1 text-xs font-medium">To<Input type="date" value={filters.to} onChange={(e) => go({ to: e.target.value })} className="h-8" /></label>
          </div>
          <div className="flex items-end justify-between gap-2 sm:col-span-2">
            <WorkflowLegend />
            {activeFilters ? (
              <Button variant="ghost" size="sm" onClick={() => go({ platform: [], state: [], pillar: "", funnel: "", campaign: "", plan: "", from: "", to: "" })}>
                <X /> Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <DndContext id="editorial-calendar" sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className={cn("min-w-0 space-y-4 transition-opacity", navigating && "opacity-60")}>
            {view === "month" ? (
              <MonthGrid date={date} today={today} byDate={byDate} card={card} onCreate={(d) => openNew(d, null)} onShowDay={(d) => go({ view: "day", date: d })} readOnly={readOnly} />
            ) : (
              <TimeGrid days={view === "week" ? weekDays(date) : [date]} today={today} byDate={byDate} card={card} onCreate={openNew} readOnly={readOnly} wide={view === "day"} />
            )}
            {!posts.length && !navigating ? (
              <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">
                <CalendarDays className="size-4" />
                {activeFilters ? "No posts match these filters in this period." : readOnly ? "Nothing planned in this period." : "Nothing planned in this period. Click a day or “Create post” to add one."}
              </p>
            ) : null}
          </div>
          <div className="space-y-4">
            <UndatedTray posts={undated} card={card} />
            {insights}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className="w-56 rotate-1 opacity-90">{card({ post: dragging, time: placement(dragging, tz).time })}</div> : null}
        </DragOverlay>
      </DndContext>

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
          readOnly={readOnly}
          onClose={() => setEditor(null)}
          onSaved={(p) => { upsertLocal(p); setEditor(null); }}
          onDeleted={(id) => { removeLocal(id); setEditor(null); }}
        />
      ) : null}

      <Dialog open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Close to another post</DialogTitle>
            <DialogDescription>
              {conflict ? `Another ${PLATFORM_LABELS[conflict.post.platform as Platform] ?? ""} post is scheduled within an hour of ${conflict.date}${conflict.time ? ` ${conflict.time}` : ""}:` : null}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-[13px]">{conflict?.list.map((c) => <li key={c.id}>{c.time} · {c.title}</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>Cancel</Button>
            <Button onClick={() => { const c = conflict!; setConflict(null); void move(c.post, c.date, c.time, true, c.previous); }}>Move anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function FilterGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="text-xs font-medium">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-md border px-2 py-1 text-xs transition-colors", on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent")}>
      {children}
    </button>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );
}

type Entry = { post: ContentItem; time: string | null; hour: number | null };

function DayCell({ id, className, onCreate, readOnly, children }: { id: string; className?: string; onCreate?: () => void; readOnly: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { if (e.target === e.currentTarget && onCreate) onCreate(); }}
      className={cn(className, isOver && "bg-primary/10 ring-2 ring-inset ring-primary/40", !readOnly && onCreate && "cursor-pointer")}
    >
      {children}
    </div>
  );
}

function MonthGrid({ date, today, byDate, card, onCreate, onShowDay, readOnly }: {
  date: string; today: string; byDate: Map<string, Entry[]>; card: (e: Entry, compact?: boolean) => React.ReactNode;
  onCreate: (d: string) => void; onShowDay: (d: string) => void; readOnly: boolean;
}) {
  const month = date.slice(0, 7);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b text-[11px] font-medium text-muted-foreground">
          {DOW.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        {monthGrid(date).map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((d) => {
              const entries = byDate.get(d) ?? [];
              const other = !d.startsWith(month);
              return (
                <DayCell key={d} id={`day|${d}`} readOnly={readOnly} onCreate={() => onCreate(d)} className={cn("group/day min-h-28 space-y-1 border-r p-1 last:border-r-0", other && "bg-muted/30")}>
                  <div className="pointer-events-none flex items-center justify-between px-0.5">
                    <span className={cn("text-[11px] tabular-nums", other ? "text-muted-foreground/60" : "text-muted-foreground", d === today && "rounded bg-primary px-1 font-semibold text-primary-foreground")}>{Number(d.slice(8))}</span>
                    {!readOnly ? <Plus className="size-3 text-muted-foreground opacity-0 group-hover/day:opacity-100" /> : null}
                  </div>
                  {entries.slice(0, 3).map((e) => card(e, true))}
                  {entries.length > 3 ? (
                    <button type="button" onClick={() => onShowDay(d)} className="w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:bg-accent">+{entries.length - 3} more</button>
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

function TimeGrid({ days, today, byDate, card, onCreate, readOnly, wide }: {
  days: string[]; today: string; byDate: Map<string, Entry[]>; card: (e: Entry, compact?: boolean) => React.ReactNode;
  onCreate: (d: string, time: string | null) => void; readOnly: boolean; wide: boolean;
}) {
  const cols = wide ? "grid-cols-[3.5rem_1fr]" : "grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <div className={cn(wide ? "min-w-0" : "min-w-[860px]")}>
        <div className={cn("sticky top-0 z-10 grid border-b bg-card", cols)}>
          <div />
          {days.map((d) => (
            <div key={d} className="border-l px-2 py-1.5 text-[12px]">
              <span className="text-muted-foreground">{fmtDay(d, { weekday: "short" })}</span>{" "}
              <span className={cn("font-medium tabular-nums", d === today && "rounded bg-primary px-1 text-primary-foreground")}>{fmtDay(d, { day: "numeric", month: wide ? "long" : "short" })}</span>
            </div>
          ))}
        </div>
        {/* date-only posts (no time yet) */}
        <div className={cn("grid border-b bg-muted/20", cols)}>
          <div className="px-1 py-1.5 text-[10px] leading-tight text-muted-foreground">No time</div>
          {days.map((d) => (
            <DayCell key={d} id={`day|${d}`} readOnly={readOnly} onCreate={() => onCreate(d, null)} className="min-h-10 space-y-1 border-l p-1">
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

function UndatedTray({ posts, card }: { posts: ContentItem[]; card: (e: Entry, compact?: boolean) => React.ReactNode }) {
  if (!posts.length) return null;
  return (
    <div className="rounded-xl border bg-card p-3 shadow-xs">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Inbox className="size-4" /> Unscheduled <span className="text-xs font-normal text-muted-foreground">· drag onto a day</span></p>
      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {posts.map((p) => card({ post: p, time: null, hour: null }))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{posts.filter((p) => stateOf(p) === "draft").length} drafts without a date</p>
    </div>
  );
}

export type { WorkflowState };
