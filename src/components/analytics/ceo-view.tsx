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
import { getFormatter, getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";

const DOT: Record<Tone, string> = { good: "bg-success", watch: "bg-warning", attention: "bg-destructive", neutral: "bg-muted-foreground/50" };
const LEVEL = {
  good: { className: "border-success/30 bg-success/6", icon: CheckCircle2, iconClass: "text-success" },
  watch: { className: "border-warning/40 bg-warning/8", icon: Gauge, iconClass: "text-warning" },
  attention: { className: "border-destructive/30 bg-destructive/6", icon: AlertTriangle, iconClass: "text-destructive" },
  insufficient: { className: "border-border bg-card", icon: CircleHelp, iconClass: "text-muted-foreground" },
} as const;

function Dot({ tone, t }: { tone: Tone; t: TFor<"analytics"> }) {
  return <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[tone])} aria-label={t(`ceoView.tone.${tone}`)} />;
}

/** The 5-minute view: overall health, the five questions, what's going well / wrong / late, and what to do now. */
export async function CeoView({ data }: { data: AnalyticsData }) {
  const [t, fmt] = await Promise.all([getT("analytics"), getFormatter()]);
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ceoView.health", { period: periodLabel(data.params.period, fmt) })}</p>
            <h2 id="health-h" className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">{summary.headline}</h2>
            {summary.signals.length ? (
              <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
                {summary.signals.map((sig) => (
                  <li key={sig.label} className="flex gap-2"><Dot tone={sig.tone} t={t} /><span><span className="font-medium">{t("ceoView.signalLabel", { label: sig.label })}</span> <span className="text-muted-foreground">{sig.evidence}</span></span></li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {summary.level === "insufficient"
                ? t("ceoView.insufficientNote")
                : t("ceoView.basedOn", { count: summary.signals.length })}
            </p>
          </div>
        </div>
      </section>

      {/* Five questions */}
      <section aria-labelledby="q-h" className="space-y-3">
        <SectionHeader title={<span id="q-h">{t("ceoView.questionsTitle")}</span>} description={t("ceoView.questionsDescription")} />
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {answers.map((a) => (
            <li key={a.question} className="flex gap-3 px-4 py-3 text-[13.5px]">
              <Dot tone={a.tone} t={t} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.question}</p>
                <p className="text-muted-foreground">{a.answer}</p>
              </div>
              {a.href ? <Link href={a.href} className="shrink-0 self-center text-[13px] font-medium text-primary hover:underline print:hidden">{t("ceoView.details")}</Link> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Going well / Needs attention / Behind schedule */}
      <section aria-label={t("ceoView.summaryLabel")} className="grid gap-3 lg:grid-cols-3">
        <SummaryCard t={t} title={t("ceoView.winsTitle")} icon={ThumbsUp} empty={t("ceoView.winsEmpty")} points={summary.wins} />
        <SummaryCard t={t} title={t("ceoView.concernsTitle")} icon={AlertTriangle} empty={t("ceoView.concernsEmpty")} points={summary.concerns} />
        <SummaryCard t={t} title={t("ceoView.behindTitle")} icon={CalendarClock} empty={t("ceoView.behindEmpty")} points={summary.behind} />
      </section>

      {/* Action center */}
      <section aria-labelledby="act-h" className="space-y-3">
        <SectionHeader title={<span id="act-h">{t("ceoView.actionsTitle")}</span>} description={t("ceoView.actionsDescription")} />
        {issues.length ? (
          <ol className="grid gap-2.5">
            {issues.map((x, n) => (
              <li key={x.id} className={cn("rounded-xl border bg-card p-4 shadow-xs", x.severity === 1 && "border-destructive/35", x.severity === 2 && "border-warning/40")}>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", x.severity === 1 ? "bg-destructive/10 text-destructive" : x.severity === 2 ? "bg-warning/15 text-warning-foreground" : "bg-secondary text-muted-foreground")}>{n + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1 text-[13px]">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                      {x.title}
                      {n < 3 ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">{t("ceoView.recommended")}</span> : null}
                      <span className="text-[11px] font-normal text-muted-foreground">{x.severity === 1 ? t("ceoView.severity.actNow") : x.severity === 2 ? t("ceoView.severity.thisWeek") : t("ceoView.severity.keepAnEye")}</span>
                    </p>
                    <p><span className="text-muted-foreground">{t("ceoView.evidence")}</span> {x.evidence}</p>
                    {x.impact ? <p><span className="text-muted-foreground">{t("ceoView.why")}</span> {x.impact}</p> : null}
                    <p><span className="text-muted-foreground">{t("ceoView.next")}</span> {x.next}</p>
                  </div>
                  <Link href={x.href} className="inline-flex shrink-0 items-center gap-1 self-center text-[13px] font-medium text-primary hover:underline print:hidden">{x.linkLabel} <ArrowRight className="size-3.5" /></Link>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/6 p-4 text-[13px]">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            <p>{t("ceoView.noActions")}</p>
          </div>
        )}
      </section>

      {/* Key numbers */}
      <section aria-labelledby="kpi-h" className="space-y-3">
        <SectionHeader title={<span id="kpi-h">{t("ceoView.kpisTitle")}</span>} description={<>{t.rich("ceoView.kpisTap", { icon: () => <span className="inline-flex translate-y-0.5"><CircleHelp className="size-3.5" /></span> })}{p ? ` ${data.periodOpen ? t("ceoView.kpisArrowsOpen", { period: periodLabel(data.prevPeriod, fmt) }) : t("ceoView.kpisArrows", { period: periodLabel(data.prevPeriod, fmt) })}` : ""}</>} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label={t("ceoView.delivered")} icon={CheckCircle2} info={<InfoTip info={explain.completion} />} value={o.completionRate == null ? "—" : fmt.percent(Math.round(o.completionRate) / 100)}
            hint={o.completionBase ? t("ceoView.deliveredHint", { done: Math.round(((o.completionRate ?? 0) / 100) * o.completionBase), base: o.completionBase }) : t("ceoView.deliveredNone")} />
          <Stat label={t("ceoView.published")} icon={Send} info={<InfoTip info={explain.published} />} value={fmt.number(o.published)} delta={p && p.published ? ((o.published - p.published) / p.published) * 100 : null} hint={p ? t("ceoView.publishedHint", { count: p.published }) : undefined} />
          <Stat label={t("ceoView.planned")} icon={CalendarClock} info={<InfoTip info={explain.planned} />} value={fmt.number(o.planned)} hint={t("ceoView.plannedHint", { count: o.upcoming })} />
          <Stat label={t("ceoView.late")} icon={Flag} info={<InfoTip info={explain.overdue} />} value={fmt.number(o.overdueContent)} hint={o.overdueTasks ? t("ceoView.lateTasks", { count: o.overdueTasks }) : t("ceoView.lateHint")} className={o.overdueContent ? "border-destructive/30" : undefined} />
          <Stat label={t("ceoView.waiting")} icon={Clock} info={<InfoTip info={explain.awaitingApproval} />} value={fmt.number(o.awaitingApproval)} hint={t("ceoView.waitingHint")} />
          {s && s.posts ? (
            <Stat label={t("ceoView.reached")} icon={Users} info={<InfoTip info={explain.reach} />} value={s.reach == null ? t("labels.notAvailable") : fmt.number(s.reach)}
              delta={data.socialPrev?.reach ? (((s.reach ?? 0) - data.socialPrev.reach) / data.socialPrev.reach) * 100 : null} hint={t("ceoView.reachedHint", { count: s.posts })} />
          ) : (
            <Stat label={t("ceoView.preparing")} icon={Clock} info={<InfoTip info={explain.inProduction} />} value={fmt.number(o.inProduction)} hint={t("ceoView.preparingHint")} />
          )}
        </div>
      </section>

      {/* Strategy themes, simplified */}
      {data.balance.total > 0 && data.balance.pillars.some((x) => x.target != null) ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">{t("ceoView.themesTitle")} <InfoTip info={explain.pillars} /></CardTitle>
            <CardDescription>{t("ceoView.themesDescription", { count: data.balance.total })}</CardDescription>
          </CardHeader>
          <CardContent><ShareBars rows={data.balance.pillars} /></CardContent>
        </Card>
      ) : null}

      <p className="text-[13px] text-muted-foreground print:hidden">
        {t.rich("ceoView.expertHint", { b: (c) => <span className="font-medium text-foreground">{c}</span> })}
      </p>
    </div>
  );
}

function SummaryCard({ title, icon: Icon, points, empty, t }: { title: string; icon: typeof ThumbsUp; points: { text: string; tone: Tone }[]; empty: string; t: TFor<"analytics"> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden /> {title}</CardTitle></CardHeader>
      <CardContent className="pt-2">
        {points.length ? (
          <ul className="grid gap-2 text-[13px]">{points.map((pt) => <li key={pt.text} className="flex gap-2"><Dot tone={pt.tone} t={t} /><span>{pt.text}</span></li>)}</ul>
        ) : <p className="text-[13px] text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}
