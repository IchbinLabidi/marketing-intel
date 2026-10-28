import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleHelp, Clock, Flag, Gauge, Send, ThumbsUp, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/app/stat";
import { SectionHeader } from "@/components/app/page-header";
import type { Tone } from "@/lib/analytics/ceo";
import type { AnalyticsData } from "@/server/services/analytics";
import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";
import { ShareBars } from "./charts";
import { periodLabel } from "./sections";

const DOT: Record<Tone, string> = { good: "bg-success", watch: "bg-warning", attention: "bg-destructive", neutral: "bg-muted-foreground/50" };
const TONE_TEXT: Record<Tone, string> = { good: "On track", watch: "Watch", attention: "Act", neutral: "Info" };
const LEVEL = {
  good: { className: "border-success/30 bg-success/6", icon: CheckCircle2, iconClass: "text-success", label: "On track" },
  watch: { className: "border-warning/40 bg-warning/8", icon: Gauge, iconClass: "text-warning", label: "Mostly on track" },
  attention: { className: "border-destructive/30 bg-destructive/6", icon: AlertTriangle, iconClass: "text-destructive", label: "Needs attention" },
  insufficient: { className: "border-border bg-card", icon: CircleHelp, iconClass: "text-muted-foreground", label: "Not enough data" },
} as const;

function Dot({ tone }: { tone: Tone }) {
  return <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[tone])} aria-label={TONE_TEXT[tone]} />;
}

/** The 5-minute view: overall health, the five questions, what's going well / wrong / late, and what to do now. */
export function CeoView({ data }: { data: AnalyticsData }) {
  const { summary, answers, issues, explain } = data.ceo;
  const lvl = LEVEL[summary.level];
  const o = data.overview, p = data.overviewPrev;
  const s = data.social;
  return (
    <div className="space-y-8">
      {/* Health */}
      <section aria-labelledby="health-h" className={cn("rounded-xl border p-4 sm:p-5", lvl.className)}>
        <div className="flex items-start gap-3">
          <lvl.icon className={cn("mt-0.5 size-5 shrink-0", lvl.iconClass)} aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Marketing health · {periodLabel(data.params.period)}</p>
            <h2 id="health-h" className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">{summary.headline}</h2>
            {summary.signals.length ? (
              <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
                {summary.signals.map((sig) => (
                  <li key={sig.label} className="flex gap-2"><Dot tone={sig.tone} /><span><span className="font-medium">{sig.label}:</span> <span className="text-muted-foreground">{sig.evidence}</span></span></li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {summary.level === "insufficient"
                ? "At least two of these need data: delivery vs plan (5+ past planned dates), deadlines, theme balance (5+ planned items with targets), approvals, audience response (5+ posts in both periods)."
                : `Based on ${summary.signals.length} measured signal${summary.signals.length === 1 ? "" : "s"}. The overall rating is the most serious of them.`}
            </p>
          </div>
        </div>
      </section>

      {/* Five questions */}
      <section aria-labelledby="q-h" className="space-y-3">
        <SectionHeader title={<span id="q-h">Your five questions</span>} description="Short answers from this period's data." />
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {answers.map((a) => (
            <li key={a.question} className="flex gap-3 px-4 py-3 text-[13.5px]">
              <Dot tone={a.tone} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.question}</p>
                <p className="text-muted-foreground">{a.answer}</p>
              </div>
              {a.href ? <Link href={a.href} className="shrink-0 self-center text-[13px] font-medium text-primary hover:underline print:hidden">Details</Link> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Going well / Needs attention / Behind schedule */}
      <section aria-label="Summary" className="grid gap-3 lg:grid-cols-3">
        <SummaryCard title="What is going well" icon={ThumbsUp} empty="Nothing stands out as clearly positive in this period's data." points={summary.wins} />
        <SummaryCard title="What needs attention" icon={AlertTriangle} empty="No problem detected in strategy, team or results." points={summary.concerns} />
        <SummaryCard title="What is behind schedule" icon={CalendarClock} empty="Nothing is late, and no approval is waiting." points={summary.behind} />
      </section>

      {/* Action center */}
      <section aria-labelledby="act-h" className="space-y-3">
        <SectionHeader title={<span id="act-h">What should I do now?</span>} description="Problems found in your data, most important first. Each one shows the evidence and where to act." />
        {issues.length ? (
          <ol className="grid gap-2.5">
            {issues.map((x, n) => (
              <li key={x.id} className={cn("rounded-xl border bg-card p-4 shadow-xs", x.severity === 1 && "border-destructive/35", x.severity === 2 && "border-warning/40")}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", x.severity === 1 ? "bg-destructive/10 text-destructive" : x.severity === 2 ? "bg-warning/15 text-[color-mix(in_oklch,var(--warning)_72%,black)]" : "bg-secondary text-muted-foreground")}>{n + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1 text-[13px]">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                      {x.title}
                      {n < 3 ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">Recommended action</span> : null}
                      <span className="text-[11px] font-normal text-muted-foreground">{x.severity === 1 ? "Act now" : x.severity === 2 ? "This week" : "Keep an eye on"}</span>
                    </p>
                    <p><span className="text-muted-foreground">Evidence:</span> {x.evidence}</p>
                    {x.impact ? <p><span className="text-muted-foreground">Why it matters:</span> {x.impact}</p> : null}
                    <p><span className="text-muted-foreground">Suggested next step:</span> {x.next}</p>
                  </div>
                  <Link href={x.href} className="inline-flex shrink-0 items-center gap-1 self-center text-[13px] font-medium text-primary hover:underline print:hidden">{x.linkLabel} <ArrowRight className="size-3.5" /></Link>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/6 p-4 text-[13px]">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            <p>Nothing in the data calls for action right now. No late work, no stuck approvals, and no theme or channel far from its target.</p>
          </div>
        )}
      </section>

      {/* Key numbers */}
      <section aria-labelledby="kpi-h" className="space-y-3">
        <SectionHeader title={<span id="kpi-h">Key numbers</span>} description={<>Tap <span className="inline-flex translate-y-0.5"><CircleHelp className="size-3.5" /></span> on any number for a plain explanation.{p ? ` Arrows compare with ${periodLabel(data.prevPeriod)}${data.periodOpen ? ", the same number of days before this period (it isn't over yet)" : ""}.` : ""}</>} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Delivered vs planned" icon={CheckCircle2} info={<InfoTip info={explain.completion} />} value={o.completionRate == null ? "—" : `${Math.round(o.completionRate)}%`}
            hint={o.completionBase ? `${Math.round(((o.completionRate ?? 0) / 100) * o.completionBase)} of ${o.completionBase} published` : "No past planned dates yet"} />
          <Stat label="Published" icon={Send} info={<InfoTip info={explain.published} />} value={o.published} delta={p && p.published ? ((o.published - p.published) / p.published) * 100 : null} hint={p ? `${p.published} in the previous period` : undefined} />
          <Stat label="Planned" icon={CalendarClock} info={<InfoTip info={explain.planned} />} value={o.planned} hint={`${o.upcoming} in the next 7 days`} />
          <Stat label="Late" icon={Flag} info={<InfoTip info={explain.overdue} />} value={o.overdueContent} hint={o.overdueTasks ? `${o.overdueTasks} late task${o.overdueTasks === 1 ? "" : "s"}` : "Past internal deadline"} className={o.overdueContent ? "border-destructive/30" : undefined} />
          <Stat label="Waiting for approval" icon={Clock} info={<InfoTip info={explain.awaitingApproval} />} value={o.awaitingApproval} hint="Ready, needs sign-off" />
          {s && s.posts ? (
            <Stat label="People reached" icon={Users} info={<InfoTip info={explain.reach} />} value={s.reach == null ? "Not available" : s.reach.toLocaleString("en")}
              delta={data.socialPrev?.reach ? (((s.reach ?? 0) - data.socialPrev.reach) / data.socialPrev.reach) * 100 : null} hint={`${s.posts} posts in the period`} />
          ) : (
            <Stat label="Being prepared" icon={Clock} info={<InfoTip info={explain.inProduction} />} value={o.inProduction} hint="Brief or in production" />
          )}
        </div>
      </section>

      {/* Strategy themes, simplified */}
      {data.balance.total > 0 && data.balance.pillars.some((x) => x.target != null) ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">Content themes vs your strategy <InfoTip info={explain.pillars} /></CardTitle>
            <CardDescription>Share of the {data.balance.total} items planned in this period for each theme. The black tick is your target; amber means clearly below it.</CardDescription>
          </CardHeader>
          <CardContent><ShareBars rows={data.balance.pillars} /></CardContent>
        </Card>
      ) : null}

      <p className="text-[13px] text-muted-foreground print:hidden">
        Want every metric, breakdown and formula? Use the <span className="font-medium text-foreground">Expert view</span> switch at the top of the page. Your period and filters are kept.
      </p>
    </div>
  );
}

function SummaryCard({ title, icon: Icon, points, empty }: { title: string; icon: typeof ThumbsUp; points: { text: string; tone: Tone }[]; empty: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden /> {title}</CardTitle></CardHeader>
      <CardContent className="pt-2">
        {points.length ? (
          <ul className="grid gap-2 text-[13px]">{points.map((pt) => <li key={pt.text} className="flex gap-2"><Dot tone={pt.tone} /><span>{pt.text}</span></li>)}</ul>
        ) : <p className="text-[13px] text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}
