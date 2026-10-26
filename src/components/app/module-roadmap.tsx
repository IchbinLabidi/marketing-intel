import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";

/**
 * Honest placeholder for modules that are designed but not built yet.
 * Shows what the module will do and the one useful action available today; no decorative buttons.
 */
export function ModuleRoadmap({
  title,
  description,
  icon: Icon,
  phase,
  capabilities,
  prerequisite,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  phase: string;
  capabilities: string[];
  prerequisite?: { label: string; href: string };
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-5 text-primary" />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">In development · {phase}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">This module is designed and its database tables exist. It will ship with:</p>
            </div>
            <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
              {capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {c}
                </li>
              ))}
            </ul>
            {prerequisite ? (
              <Button asChild size="sm" variant="outline">
                <Link href={prerequisite.href}>
                  {prerequisite.label} <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
