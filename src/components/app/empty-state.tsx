import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Smaller padding for use inside a card or panel. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong/70 bg-card/60 px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      <div className="mb-3.5 flex size-10 items-center justify-center rounded-lg border bg-card shadow-sm">
        <Icon className="size-[18px] text-muted-foreground" aria-hidden />
      </div>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
