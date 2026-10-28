import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, CircleHelp, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadAnalytics } from "@/server/services/analytics";
import { hasPermission } from "@/server/services/team";
import { cn } from "@/lib/utils";

const LEVEL = {
  good: { icon: CheckCircle2, className: "text-success" },
  watch: { icon: Gauge, className: "text-warning" },
  attention: { icon: AlertTriangle, className: "text-destructive" },
  insufficient: { icon: CircleHelp, className: "text-muted-foreground" },
} as const;

/**
 * "Start here" on the project overview: the last 30 days' health and top actions from Analytics, plus the setup
 * steps that make those answers possible. Shown only to people who can open Analytics.
 */
export async function ProjectSnapshot({ projectId, workspaceId, strategyPercent }: { projectId: string; workspaceId: string; strategyPercent: number }) {
  if (!(await hasPermission(workspaceId, "calendar.view"))) return null;
  const data = await loadAnalytics(projectId, {});
  const { summary, issues } = data.ceo;
  const lvl = LEVEL[summary.level];
  const base = `/p/${projectId}`;
  const steps = [
    { done: strategyPercent >= 100, label: "Complete the strategy", hint: "goals, audiences and content themes with target shares", href: `${base}/strategy` },
    { done: data.ceo.issues.every((x) => x.id !== "no-data") && (!data.access.canSeeSocial || Boolean(data.meta && data.meta.status === "active")), label: "Connect Facebook and Instagram", hint: "so results can be measured", href: `${base}/history` },
    { done: data.counts.allItems > 0, label: "Plan content", hint: "in the calendar or from Opportunities", href: `${base}/calendar` },
    { done: data.hasChannelTargets, label: "Set a posting rhythm per channel", hint: "posts per week, below on this page", href: "#channels" },
  ];
  const todo = steps.filter((s) => !s.done);

  return (
    <section aria-labelledby="start-h" className="grid gap-4 rounded-xl border bg-card p-5 shadow-xs lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="min-w-0 space-y-3">
        <p className="eyebrow">Last 30 days</p>
        <h2 id="start-h" className="flex items-start gap-2 text-[16px] font-semibold leading-snug">
          <lvl.icon className={cn("mt-0.5 size-4.5 shrink-0", lvl.className)} aria-hidden /> {summary.headline}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {data.overview.planned} planned and {data.overview.published} published in the last 30 days · {data.overview.upcoming} planned for the next 7 days · {data.overview.overdueContent} late.
        </p>
        {issues.length ? (
          <ol className="grid gap-1.5 text-[13px]">
            {issues.slice(0, 3).map((x, n) => (
              <li key={x.id} className="flex gap-2">
                <span className="tabular-nums text-muted-foreground">{n + 1}.</span>
                <span><Link href={x.href} className="font-medium hover:underline">{x.title}</Link> <span className="text-muted-foreground">{x.next}</span></span>
              </li>
            ))}
          </ol>
        ) : <p className="text-[13px] text-muted-foreground">Nothing in the data needs your attention right now.</p>}
        <Button asChild size="sm"><Link href={`${base}/analytics?mode=ceo`}>See the full picture <ArrowRight /></Link></Button>
      </div>
      {todo.length ? (
        <div className="space-y-2 rounded-lg bg-muted/50 p-4">
          <p className="text-[13px] font-medium">Setup for reliable answers</p>
          <ul className="grid gap-1.5 text-[13px]">
            {steps.map((s) => (
              <li key={s.label} className="flex gap-2">
                {s.done ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Done" /> : <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" aria-label="To do" />}
                <span>{s.done ? <span className="text-muted-foreground">{s.label}</span> : <><Link href={s.href} className="font-medium hover:underline">{s.label}</Link> <span className="text-muted-foreground">({s.hint})</span></>}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-1.5 rounded-lg bg-muted/50 p-4 text-[13px]">
          <p className="font-medium">How to use this project</p>
          <p className="text-muted-foreground"><span className="font-medium text-foreground">Monitor</span> weekly in Analytics. <span className="font-medium text-foreground">Act</span> in the Calendar and Production. Revisit the Strategy each quarter.</p>
        </div>
      )}
    </section>
  );
}
