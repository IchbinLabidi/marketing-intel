"use client";

import { AudienceBadge } from "@/components/app/audience-badge";
import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Flag } from "lucide-react";
import { PRIORITY_LABELS, type Priority } from "@/lib/permissions";
import { STAGE_LABELS } from "@/lib/production/model";
import { cn } from "@/lib/utils";
import type { ContentItem } from "@/types/domain";
import { PlatformIcon } from "./platform-icon";
import { StatePill, stateOf } from "./post-card";
import { contentType, initials, isOverdue, type Person } from "./planning";
import { SelectAllBox } from "@/components/backlog/selection-bar";

type Row = { post: ContentItem; time: string | null; people: Person[] };
type Key = "publish" | "deadline" | "title" | "status" | "priority" | "owner";
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Sortable list of everything planned in the period, plus unscheduled items at the end. */
type Selection = { selected: Set<string>; toggle: (id: string) => void; setAll: (ids: string[], on: boolean) => void; canSelect: (post: ContentItem) => boolean };

export function ListView({ rows, today, onOpen, selection }: { rows: Row[]; today: string; onOpen: (post: ContentItem) => void; selection?: Selection }) {
  const [sort, setSort] = React.useState<{ key: Key; dir: 1 | -1 }>({ key: "publish", dir: 1 });
  const value = (r: Row, k: Key): string | number => {
    switch (k) {
      case "publish": return r.post.scheduled_date ? `${r.post.scheduled_date} ${r.time ?? "99"}` : "9999";
      case "deadline": return r.post.due_date ?? "9999";
      case "title": return r.post.title.toLowerCase();
      case "status": return stateOf(r.post);
      case "priority": return PRIORITY_RANK[r.post.priority ?? "medium"];
      case "owner": return r.people[0]?.name.toLowerCase() ?? "~";
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const head = (k: Key, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.key === k ? (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  );

  if (!rows.length) return null;
  return (
    <div className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr className="border-b text-left">
            {selection ? <th className="w-8 pl-4"><SelectAllBox ids={rows.filter((r) => selection.canSelect(r.post)).map((r) => r.post.id)} selected={selection.selected} onChange={(on) => selection.setAll(rows.filter((r) => selection.canSelect(r.post)).map((r) => r.post.id), on)} label="Select all shown" /></th> : null}
            {head("title", "Content", cn("w-[34%]", !selection && "pl-4"))}
            {head("status", "Status")}
            {head("owner", "Owner")}
            {head("priority", "Priority")}
            {head("publish", "Publication")}
            {head("deadline", "Deadline", "pr-4")}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ post, time, people }) => {
            const overdue = isOverdue(post, today);
            return (
              <tr key={post.id} className={cn("cursor-pointer border-b last:border-0", selection?.selected.has(post.id) && "bg-primary-soft/40")} onClick={() => onOpen(post)}>
                {selection ? <td className="w-8 pl-4" onClick={(e) => e.stopPropagation()}>{selection.canSelect(post) ? <input type="checkbox" aria-label={`Select ${post.title}`} checked={selection.selected.has(post.id)} onChange={() => selection.toggle(post.id)} /> : null}</td> : null}
                <td className={cn("py-2.5", !selection && "pl-4")}>
                  <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={(e) => { e.stopPropagation(); onOpen(post); }}>
                    <PlatformIcon platform={post.platform} className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium" dir="auto">{post.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><AudienceBadge audience={post.audience} />{contentType(post.format)}{post.production_stage ? ` · ${STAGE_LABELS[post.production_stage]}` : ""}</span>
                    </span>
                  </button>
                </td>
                <td><StatePill state={stateOf(post)} /></td>
                <td>
                  {people.length ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary-soft text-[9px] font-semibold text-primary">{initials(people[0].name)}</span>
                      <span className="max-w-28 truncate">{people[0].name}</span>
                      {people.length > 1 ? <span className="text-xs text-muted-foreground">+{people.length - 1}</span> : null}
                    </span>
                  ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                </td>
                <td className={cn("text-xs", post.priority === "urgent" ? "font-medium text-destructive" : post.priority === "high" ? "font-medium" : "text-muted-foreground")}>
                  {PRIORITY_LABELS[(post.priority ?? "medium") as Priority]}
                </td>
                <td className="tabular-nums">{post.scheduled_date ? `${post.scheduled_date}${time ? ` ${time}` : ""}` : <span className="text-xs text-muted-foreground">Not scheduled</span>}</td>
                <td className={cn("pr-4 tabular-nums", overdue && "font-medium text-destructive")}>
                  {post.due_date ? <span className="inline-flex items-center gap-1">{overdue ? <Flag className="size-3" /> : null}{post.due_date}</span> : <span className="text-xs text-muted-foreground">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
