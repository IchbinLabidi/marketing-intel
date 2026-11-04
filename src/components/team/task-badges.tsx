"use client";

import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { Priority, TaskStatus, TaskType } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";

// domain.taskType has an "other" key, so its type reads as plural forms; the full path still resolves to the label.
type TaskTypeKey = Parameters<TFor<"domain">>[0];

const STATUS_VARIANT: Record<TaskStatus, "secondary" | "default" | "warning" | "success" | "destructive" | "info" | "outline"> = {
  backlog: "outline",
  assigned: "secondary",
  in_progress: "info",
  in_review: "default",
  changes_requested: "warning",
  approved: "success",
  completed: "success",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const td = useT("domain");
  return (
    <Badge variant={STATUS_VARIANT[status]} dot>
      {td(`taskStatus.${status}`)}
    </Badge>
  );
}

const PRIORITY_ICON = { low: ArrowDown, medium: Minus, high: ArrowUp, urgent: ChevronsUp } as const;

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const td = useT("domain");
  const Icon = PRIORITY_ICON[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        priority === "urgent" ? "text-destructive" : priority === "high" ? "text-warning-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {td(`priority.${priority}`)}
    </span>
  );
}

export function TaskTypeLabel({ type }: { type: TaskType }) {
  const td = useT("domain");
  return <span className="text-xs font-medium text-muted-foreground">{td(`taskType.${type}` as TaskTypeKey)}</span>;
}

/** Avatar + name + role, used wherever a teammate is shown. */
export function PersonChip({ name, role, size = "sm" }: { name: string; role?: string | null; size?: "sm" | "md" }) {
  const t = useT("team");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name || "?"} className={size === "md" ? "size-8" : "size-6 text-[10px]"} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-tight">{name || t("members.unnamed")}</span>
        {role ? <span className="block truncate text-[11px] leading-tight text-muted-foreground">{role}</span> : null}
      </span>
    </span>
  );
}

/** "Due today", "Overdue by 3 days", "Due 12 Nov" relative to a YYYY-MM-DD "today". */
export function DueLabel({ due, today, closed }: { due: string | null; today: string; closed?: boolean }) {
  const t = useT("team");
  const fmt = useFormatter();
  if (!due) return <span className="text-xs text-subtle-foreground">{t("due.none")}</span>;
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const label =
    days === 0 ? t("due.today") : days === 1 ? t("due.tomorrow") : days < 0 ? t("due.overdue", { count: -days }) : t("due.on", { date: fmt.day(due, { day: "numeric", month: "short" }) });
  return (
    <span className={cn("text-xs tabular-nums", !closed && days < 0 ? "font-medium text-destructive" : !closed && days <= 1 ? "font-medium text-foreground" : "text-muted-foreground")}>
      {label}
    </span>
  );
}
