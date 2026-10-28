import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS, type Priority, type TaskStatus, type TaskType } from "@/lib/permissions";
import { cn } from "@/lib/utils";

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
  return (
    <Badge variant={STATUS_VARIANT[status]} dot>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY_ICON = { low: ArrowDown, medium: Minus, high: ArrowUp, urgent: ChevronsUp } as const;

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
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
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function TaskTypeLabel({ type }: { type: TaskType }) {
  return <span className="text-xs font-medium text-muted-foreground">{TASK_TYPE_LABELS[type]}</span>;
}

/** Avatar + name + role, used wherever a teammate is shown. */
export function PersonChip({ name, role, size = "sm" }: { name: string; role?: string | null; size?: "sm" | "md" }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name || "?"} className={size === "md" ? "size-8" : "size-6 text-[10px]"} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-tight">{name || "Unnamed member"}</span>
        {role ? <span className="block truncate text-[11px] leading-tight text-muted-foreground">{role}</span> : null}
      </span>
    </span>
  );
}

/** "Due today", "Overdue by 3 days", "Due 12 Nov" relative to a YYYY-MM-DD "today". */
export function DueLabel({ due, today, closed }: { due: string | null; today: string; closed?: boolean }) {
  if (!due) return <span className="text-xs text-subtle-foreground">No due date</span>;
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const label =
    days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : days < 0 ? `Overdue ${-days}d` : `Due ${new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return (
    <span className={cn("text-xs tabular-nums", !closed && days < 0 ? "font-medium text-destructive" : !closed && days <= 1 ? "font-medium text-foreground" : "text-muted-foreground")}>
      {label}
    </span>
  );
}
