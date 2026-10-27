import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven section tabs (one link per section), styled like the in-page Tabs component. */
export function TabNav({
  items,
  label,
  className,
}: {
  items: { key: string; label: React.ReactNode; href: string; active: boolean; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn("scrollbar-thin flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)]", className)}
    >
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors",
            t.active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count ? (
            <span className="rounded-[4px] bg-secondary px-1 text-[11px] tabular-nums text-muted-foreground">{t.count.toLocaleString("en")}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
