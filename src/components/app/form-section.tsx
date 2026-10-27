import { cn } from "@/lib/utils";

/**
 * Settings-style section: title and explanation on the left, the form on the right (stacked on small screens).
 * Use for long, sectioned forms so each block reads as one decision.
 */
export function FormSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("grid scroll-mt-20 gap-4 py-8 first:pt-2 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10", className)}>
      <div className="space-y-1 lg:pt-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0 rounded-xl border bg-card p-5 shadow-xs sm:p-6">{children}</div>
    </section>
  );
}
