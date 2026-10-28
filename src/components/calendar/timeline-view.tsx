"use client";

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { addDays } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import type { ContentItem } from "@/types/domain";
import { PlatformIcon } from "./platform-icon";
import { STATE_STYLE } from "./styles";
import { stateOf } from "./post-card";
import { isOverdue, type Person } from "./planning";

type Row = { post: ContentItem; people: Person[] };

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/**
 * Work windows per person: each bar runs from the internal deadline to the publication date (the production
 * window), or marks a single day when only one date exists. Overlapping windows for the same person are flagged.
 * Dependencies between items aren't tracked by the app, so none are drawn.
 */
export function TimelineView({ rows, from, to, today, onOpen }: { rows: Row[]; from: string; to: string; today: string; onOpen: (post: ContentItem) => void }) {
  const cols = days(from, to);
  const index = (d: string) => Math.max(0, Math.min(cols.length - 1, cols.indexOf(d < from ? from : d > to ? to : d)));
  const span = (p: ContentItem) => {
    const dates = [p.due_date, p.scheduled_date].filter(Boolean).sort() as string[];
    if (!dates.length) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  };

  // Group by lead (first participant); unassigned last.
  const groups = new Map<string, { person: Person | null; items: Row[] }>();
  for (const r of rows) {
    if (!span(r.post)) continue;
    const key = r.people[0]?.user_id ?? "none";
    const g = groups.get(key) ?? { person: r.people[0] ?? null, items: [] };
    g.items.push(r);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.person ? 0 : 1) - (b.person ? 0 : 1) || (a.person?.name ?? "").localeCompare(b.person?.name ?? ""));

  const overlaps = (items: Row[]) => {
    const set = new Set<string>();
    const spans = items.map((r) => ({ id: r.post.id, ...span(r.post)! })).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length && spans[j].start <= spans[i].end; j++) { set.add(spans[i].id); set.add(spans[j].id); }
    return set;
  };

  if (!ordered.length) return null;
  const grid = { gridTemplateColumns: `11rem repeat(${cols.length}, minmax(1.6rem, 1fr))` };

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" aria-hidden /> Bars run from the internal deadline to the publication date. Dependencies aren&apos;t tracked, so none are shown.
      </p>
      <div className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
        <div className="min-w-[900px]">
          <div className="sticky top-0 z-10 grid border-b bg-card text-[10px] text-muted-foreground" style={grid}>
            <div className="px-3 py-1.5 font-medium">Owner / content</div>
            {cols.map((d) => (
              <div key={d} className={cn("border-l py-1.5 text-center tabular-nums", d === today && "bg-primary-soft font-semibold text-primary")}>{Number(d.slice(8))}</div>
            ))}
          </div>
          {ordered.map((g) => {
            // Overlap only means something for one person's workload.
            const clash = g.person ? overlaps(g.items) : new Set<string>();
            return (
              <div key={g.person?.user_id ?? "none"} className="border-b last:border-0">
                <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 text-xs font-medium">
                  {g.person ? g.person.name : "Unassigned"}
                  <span className="font-normal text-muted-foreground">· {g.items.length}</span>
                  {clash.size ? <span className="ml-1 inline-flex items-center gap-1 font-normal text-warning-foreground"><AlertTriangle className="size-3" /> {clash.size} overlapping</span> : null}
                </div>
                {g.items.map(({ post }) => {
                  const s = span(post)!;
                  const a = index(s.start), b = index(s.end);
                  const state = stateOf(post);
                  const overdue = isOverdue(post, today);
                  return (
                    <div key={post.id} className="grid items-center" style={grid}>
                      <button type="button" onClick={() => onOpen(post)} className="flex min-w-0 items-center gap-1.5 truncate px-3 py-1.5 text-left text-xs hover:text-primary" dir="auto">
                        <PlatformIcon platform={post.platform} className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{post.title}</span>
                      </button>
                      <div className="relative col-span-full col-start-2 h-7" style={{ gridColumn: `2 / span ${cols.length}` }}>
                        <button
                          type="button"
                          onClick={() => onOpen(post)}
                          title={`${post.title}\nDeadline ${post.due_date ?? "—"} · Publication ${post.scheduled_date ?? "—"}`}
                          className={cn(
                            "absolute top-1 h-5 rounded border border-l-[3px] text-left text-[10px] leading-5 shadow-xs transition-shadow hover:shadow-sm",
                            STATE_STYLE[state].card,
                            clash.has(post.id) && "ring-1 ring-warning/60",
                            overdue && "ring-1 ring-destructive/60",
                          )}
                          style={{ left: `calc(${(a / cols.length) * 100}% + 2px)`, width: `calc(${((b - a + 1) / cols.length) * 100}% - 4px)` }}
                        >
                          <span className="sr-only">{post.title}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
