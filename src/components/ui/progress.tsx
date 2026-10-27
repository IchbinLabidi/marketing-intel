import { cn } from "@/lib/utils";

/** Determinate progress bar. `value` is 0-100. */
function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", clamped >= 100 ? "bg-success" : "bg-primary")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
