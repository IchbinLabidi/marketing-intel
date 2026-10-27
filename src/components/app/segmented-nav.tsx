import Link from "next/link";
import { cn } from "@/lib/utils";

/** Segmented control made of links, for URL-driven filters (period, status, archived…). */
export function SegmentedNav({
  items,
  label,
  className,
}: {
  items: { label: React.ReactNode; href: string; active: boolean; key?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("scrollbar-thin inline-flex max-w-full overflow-x-auto rounded-lg border bg-secondary p-0.5 text-[13px]", className)}>
      {items.map((t, i) => (
        <Link
          key={t.key ?? i}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-3 py-1 font-medium transition-colors",
            t.active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
