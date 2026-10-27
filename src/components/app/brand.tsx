import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/** Three rising bars: the product mark. */
export function SignalGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5", className)} fill="currentColor" aria-hidden>
      <rect x="2" y="9" width="3" height="5" rx="1" />
      <rect x="6.5" y="5.5" width="3" height="8.5" rx="1" />
      <rect x="11" y="2" width="3" height="12" rx="1" />
    </svg>
  );
}

export function BrandMark({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-md bg-foreground text-background",
          size === "md" ? "size-7" : "size-6",
        )}
        aria-hidden
      >
        <SignalGlyph className={size === "md" ? "size-4" : undefined} />
      </span>
      <span className={cn("font-semibold tracking-[-0.01em] text-foreground", size === "md" ? "text-[15px]" : "text-[14px]")}>
        {siteConfig.name}
      </span>
    </span>
  );
}
