"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CheckCircle2, CircleAlert, Clock, FileImage, Hourglass, Pencil } from "lucide-react";
import { FUNNEL_LABELS, STATUS_TO_WORKFLOW, WORKFLOW_LABELS, type FunnelStage, type WorkflowState } from "@/lib/domain/constants";
import type { ContentItem } from "@/types/domain";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./platform-icon";
import { STATE_STYLE } from "./styles";
import { STAGE_LABELS } from "@/lib/production/model";

export type PillarRef = { id: string; name: string; color: string | null; dot: string | null };

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

/**
 * A calendar item. `compact` is used in month cells; the full card in week/day views and the tray.
 * Draggable unless read-only or published.
 */
export function PostCard({
  post,
  time,
  pillar,
  compact,
  readOnly,
  onOpen,
}: {
  post: ContentItem;
  time: string | null;
  pillar: PillarRef | null;
  compact?: boolean;
  readOnly: boolean;
  onOpen: (post: ContentItem) => void;
}) {
  const state = stateOf(post);
  const locked = readOnly || state === "published";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id, disabled: locked, data: { post } });
  const preview = post.hook || post.caption || post.creative_brief || "";

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(locked ? {} : listeners)}
      {...attributes}
      onClick={() => onOpen(post)}
      title={`${post.title}${time ? ` · ${time}` : ""} · ${WORKFLOW_LABELS[state]}${post.production_stage ? ` · ${STAGE_LABELS[post.production_stage]}` : ""}`}
      className={cn(
        "group/card w-full rounded-md border border-l-[3px] bg-card text-left shadow-xs outline-none transition-[box-shadow,opacity] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50",
        STATE_STYLE[state].card,
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
          <span className="truncate font-medium">{post.title}</span>
        </span>
      ) : (
        <span className="flex gap-2">
          <span className="relative size-11 shrink-0 overflow-hidden rounded bg-muted">
            {post.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-provided external URL, no optimisation domain configured
              <img src={post.media_url} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground"><FileImage className="size-4" /></span>
            )}
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <PlatformIcon platform={post.platform} />
              <span className="tabular-nums">{time ?? "time not set"}</span>
              {post.format ? <span className="truncate">· {post.format}</span> : null}
            </span>
            <span className="line-clamp-1 text-[12px] font-medium">{post.title}</span>
            {preview ? <span className="line-clamp-2 text-[11px] text-muted-foreground">{preview}</span> : null}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5">
              <StatePill state={state} />
              {post.production_stage && <span className="text-[11px] text-muted-foreground">{STAGE_LABELS[post.production_stage]}</span>}
              {pillar ? (
                <span className="inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn("size-1.5 shrink-0 rounded-full", pillar.dot ?? "bg-primary")} />
                  <span className="truncate">{pillar.name}</span>
                </span>
              ) : null}
              {post.funnel_stage ? <span className="text-[11px] text-muted-foreground">{FUNNEL_LABELS[post.funnel_stage as FunnelStage]}</span> : null}
            </span>
          </span>
        </span>
      )}
    </button>
  );
}
