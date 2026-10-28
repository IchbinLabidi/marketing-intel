"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { ContextMenu } from "radix-ui";
import { ArrowUp, CalendarClock, CheckCircle2, ChevronsUp, CircleAlert, Clock, Copy, ExternalLink, Flag, Hourglass, PanelRight, Pencil } from "lucide-react";
import { FUNNEL_LABELS, STATUS_TO_WORKFLOW, WORKFLOW_LABELS, type FunnelStage, type WorkflowState } from "@/lib/domain/constants";
import type { ContentItem } from "@/types/domain";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./platform-icon";
import { STATE_STYLE } from "./styles";
import { STAGE_LABELS } from "@/lib/production/model";
import { contentType, initials, type Person } from "./planning";

export type PillarRef = { id: string; name: string; color: string | null; dot: string | null };
export type CardAction = "open" | "brief" | "duplicate" | "tomorrow" | "next-week";

const STATE_ICON: Record<WorkflowState, typeof Clock> = {
  draft: Pencil, pending: Hourglass, approved: CheckCircle2, scheduled: Clock, published: CheckCircle2, failed: CircleAlert,
};

export function stateOf(p: Pick<ContentItem, "status">) {
  return STATUS_TO_WORKFLOW[p.status] ?? "draft";
}

export function StatePill({ state, className }: { state: WorkflowState; className?: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", className)}>
      <span className={cn("size-1.5 rounded-full", STATE_STYLE[state].dot)} />
      <Icon className="size-3 text-muted-foreground" />
      {WORKFLOW_LABELS[state]}
    </span>
  );
}

function PriorityMark({ priority }: { priority?: string }) {
  if (priority === "urgent") return <ChevronsUp className="size-3 shrink-0 text-destructive" aria-label="Urgent" />;
  if (priority === "high") return <ArrowUp className="size-3 shrink-0 text-[color-mix(in_oklch,var(--warning)_75%,black)]" aria-label="High priority" />;
  return null;
}

function Faces({ people, size = "sm" }: { people: Person[]; size?: "sm" | "xs" }) {
  if (!people.length) return null;
  const shown = people.slice(0, 2);
  return (
    <span className="flex shrink-0 -space-x-1" aria-label={`Assigned: ${people.map((p) => p.name).join(", ")}`}>
      {shown.map((p) => (
        <span
          key={p.user_id}
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-primary-soft font-semibold text-primary ring-2 ring-card",
            size === "xs" ? "size-4 text-[8px]" : "size-5 text-[9px]",
          )}
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > 2 ? <span className={cn("inline-flex items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-card", size === "xs" ? "size-4 text-[8px]" : "size-5 text-[9px]")}>+{people.length - 2}</span> : null}
    </span>
  );
}

/**
 * A calendar item. `compact` is used in month cells; the full card in week/day views and the tray.
 * Draggable when the user may move it; right-click (or the context-menu key) opens the item's actions.
 */
export function PostCard({
  post, time, pillar, compact, readOnly, people = [], overdue = false, mine = false, onOpen, onAction,
}: {
  post: ContentItem;
  time: string | null;
  pillar: PillarRef | null;
  compact?: boolean;
  readOnly: boolean;
  people?: Person[];
  overdue?: boolean;
  mine?: boolean;
  onOpen: (post: ContentItem) => void;
  onAction?: (action: CardAction, post: ContentItem) => void;
}) {
  const state = stateOf(post);
  const locked = readOnly || state === "published";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id, disabled: locked, data: { post } });
  const type = contentType(post.format);
  const tooltip = [
    post.title, `${type}${post.platform ? ` · ${post.platform}` : ""}`, time ? `Publishes ${post.scheduled_date} ${time}` : post.scheduled_date ? `Publishes ${post.scheduled_date}` : "No publication date",
    post.due_date ? `Deadline ${post.due_date}${overdue ? " (overdue)" : ""}` : null, WORKFLOW_LABELS[state], post.production_stage ? STAGE_LABELS[post.production_stage] : null,
    people.length ? `Team: ${people.map((p) => p.name).join(", ")}` : "Unassigned",
  ].filter(Boolean).join("\n");

  const button = (
    <button
      ref={setNodeRef}
      type="button"
      {...(locked ? {} : listeners)}
      {...attributes}
      onClick={() => onOpen(post)}
      title={tooltip}
      className={cn(
        "group/card w-full rounded-md border border-l-[3px] bg-card text-left shadow-xs outline-none transition-[box-shadow,opacity,transform] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50",
        STATE_STYLE[state].card,
        overdue && "ring-1 ring-destructive/50",
        mine && "bg-primary-soft/40",
        isDragging && "opacity-40",
        !locked && "cursor-grab active:cursor-grabbing",
        compact ? "px-1.5 py-1" : "p-2",
      )}
    >
      {compact ? (
        <span className="flex items-center gap-1 text-[11px] leading-tight">
          <span className={cn("size-1.5 shrink-0 rounded-full", STATE_STYLE[state].dot)} aria-label={WORKFLOW_LABELS[state]} />
          <PlatformIcon platform={post.platform} className="size-3 shrink-0 text-muted-foreground" />
          {time ? <span className="tabular-nums text-muted-foreground">{time}</span> : null}
          <span className="min-w-0 flex-1 truncate font-medium">{post.title}</span>
          <PriorityMark priority={post.priority} />
          {overdue ? <Flag className="size-3 shrink-0 text-destructive" aria-label="Deadline passed" /> : null}
          <Faces people={people} size="xs" />
        </span>
      ) : (
        <span className="block space-y-1">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <PlatformIcon platform={post.platform} />
            <span className="font-medium text-foreground/80">{type}</span>
            <span className="tabular-nums">· {time ?? "no time"}</span>
            <span className="ml-auto flex items-center gap-1"><PriorityMark priority={post.priority} /><Faces people={people} /></span>
          </span>
          <span className="line-clamp-2 text-[12.5px] font-medium leading-snug" dir="auto">{post.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <StatePill state={state} />
            {post.production_stage ? <span className="text-[11px] text-muted-foreground">{STAGE_LABELS[post.production_stage]}</span> : null}
            {post.due_date ? (
              <span className={cn("inline-flex items-center gap-0.5 text-[11px] tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                <Flag className="size-3" aria-hidden /> {post.due_date.slice(5).replace("-", "/")}
              </span>
            ) : null}
            {pillar ? (
              <span className="inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground">
                <span className={cn("size-1.5 shrink-0 rounded-full", pillar.dot ?? "bg-primary")} />
                <span className="truncate">{pillar.name}</span>
              </span>
            ) : null}
            {post.funnel_stage ? <span className="text-[11px] text-muted-foreground">{FUNNEL_LABELS[post.funnel_stage as FunnelStage]}</span> : null}
          </span>
        </span>
      )}
    </button>
  );

  if (!onAction) return button;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{button}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-fade-in">
          <MenuItem icon={PanelRight} onSelect={() => onAction("open", post)}>Open details</MenuItem>
          <MenuItem icon={ExternalLink} onSelect={() => onAction("brief", post)}>Open full brief</MenuItem>
          {!locked ? (
            <>
              <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
              <MenuItem icon={CalendarClock} onSelect={() => onAction("tomorrow", post)}>Move to next day</MenuItem>
              <MenuItem icon={CalendarClock} onSelect={() => onAction("next-week", post)}>Move one week later</MenuItem>
              <MenuItem icon={Copy} onSelect={() => onAction("duplicate", post)}>Duplicate</MenuItem>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItem({ icon: Icon, onSelect, children }: { icon: typeof Clock; onSelect: () => void; children: React.ReactNode }) {
  return (
    <ContextMenu.Item onSelect={onSelect} className="flex h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[13px] outline-none select-none focus:bg-accent">
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </ContextMenu.Item>
  );
}
