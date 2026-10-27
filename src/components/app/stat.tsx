import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single KPI: label, value, and optional context (comparison delta or a hint).
 * `delta` is a signed percentage; `goodWhen` says which direction is positive for this metric.
 */
export function Stat({
  label,
  value,
  hint,
  delta,
  goodWhen = "up",
  icon: Icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number | null;
  goodWhen?: "up" | "down";
  icon?: LucideIcon;
  className?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const positive = hasDelta && (goodWhen === "up" ? delta! > 0 : delta! < 0);
  const negative = hasDelta && (goodWhen === "up" ? delta! < 0 : delta! > 0);
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card px-4 py-3.5 shadow-xs", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="truncate text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</span>
        {hasDelta ? (
          <span
            className={cn(
              "inline-flex items-center text-xs font-medium tabular-nums",
              positive && "text-success",
              negative && "text-destructive",
              !positive && !negative && "text-muted-foreground",
            )}
          >
            {delta! > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : delta! < 0 ? <ArrowDownRight className="size-3.5" aria-hidden /> : null}
            {Math.abs(delta!).toFixed(Math.abs(delta!) < 10 ? 1 : 0)}%
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Responsive row of Stats. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}
