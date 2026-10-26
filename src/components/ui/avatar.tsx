import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary",
        className,
      )}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

export { Avatar };
