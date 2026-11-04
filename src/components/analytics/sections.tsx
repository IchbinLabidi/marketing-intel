import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarCheck2, CheckCircle2, Clock, Info, Lightbulb, PlugZap, Send, TrendingUp, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Stat } from "@/components/app/stat";
import { SectionHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { BarList } from "@/components/history/charts";
import { contentTypeLabel, platformLabelOf, stageLabelOf } from "@/lib/analytics/compute";
import type { AnalyticsData } from "@/server/services/analytics";
import { getFormatter, getT } from "@/i18n/server";
import type { Formatter } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { ShareBars, WeeklyColumns } from "./charts";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { InfoTip } from "./info-tip";

const change = (now: number | null | undefined, prev: number | null | undefined) => (now == null || prev == null || prev === 0 ? null : ((now - prev) / prev) * 100);
const fmtDate = (fmt: Formatter, d: string) => fmt.day(d, { day: "numeric", month: "short", year: "numeric" });
export const periodLabel = (p: { from: string; to: string }, fmt: Formatter) => `${fmtDate(fmt, p.from)} – ${fmtDate(fmt, p.to)}`;

/** Locale-aware formatting helpers shared by the sections. */
async function tools() {
  const [t, td, fmt] = await Promise.all([getT("analytics"), getT("domain"), getFormatter()]);
  const n = (v: number | null | undefined, digits = 0) => (v == null ? "—" : fmt.number(v, { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  const fixed = (v: number, digits: number) => fmt.number(v, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pct = (v: number, digits = 0) => fmt.number(v / 100, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits });
  const days = (v: number | null) => (v == null ? "—" : v < 1 ? t("labels.hours", { value: fixed(v * 24, 0) }) : t("labels.days", { value: fixed(v, 1) }));
  const stage = (s: string) => stageLabelOf(t, s);
  const platformLabel = (p: string) => platformLabelOf(td, p);
  const period = (p: { from: string; to: string }) => periodLabel(p, fmt);
  return { t, fmt, n, fixed, pct, days, stage, platformLabel, period };
}

function Section({ id, title, description, children, actions }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3 break-inside-avoid-page">
      <SectionHeader title={<span id={`${id}-h`}>{title}</span>} description={description} actions={actions} />
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A. Executive overview
// ---------------------------------------------------------------------------
export async function OverviewSection({ data }: { data: AnalyticsData }) {
  const { t, n, pct, period } = await tools();
  const o = data.overview, p = data.overviewPrev;
  const weeks = ((Date.parse(data.params.period.to) - Date.parse(data.params.period.from)) / 86_400_000 + 1) / 7;
  const prevHint = (value: string) => t("overview.vsPrevious", { value, period: period(data.prevPeriod) });
  return (
    <Section id="overview" title={t("overview.title")} description={data.periodOpen ? t("overview.descriptionOpen", { period: period(data.params.period), previous: period(data.prevPeriod) }) : t("overview.descriptionClosed", { period: period(data.params.period) })}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("overview.plannedInPeriod")} info={<InfoTip expert info={data.ceo.explain.planned} />} icon={CalendarCheck2} value={n(o.planned)} delta={p && !data.periodOpen ? change(o.planned, p.planned) : null} hint={p ? prevHint(n(p.planned)) : t("overview.plannedHint")} />
        <Stat label={t("overview.publishedInPeriod")} info={<InfoTip expert info={data.ceo.explain.published} />} icon={Send} value={n(o.published)} delta={p ? change(o.published, p.published) : null} hint={p ? prevHint(n(p.published)) : t("overview.publishedHint")} />
        <Stat label={t("overview.completionRate")} info={<InfoTip expert info={data.ceo.explain.completion} />} icon={CheckCircle2} value={o.completionRate == null ? "—" : pct(o.completionRate)} hint={o.completionBase ? t("overview.completionHint", { done: Math.round(((o.completionRate ?? 0) / 100) * o.completionBase), base: o.completionBase }) : t("overview.completionNone")} />
        <Stat label={t("overview.approvedPerWeek")} info={<InfoTip expert info={data.ceo.explain.approvedPerWeek} />} icon={TrendingUp} value={n(o.approvedInPeriod / weeks, 1)} delta={p ? change(o.approvedInPeriod, p.approvedInPeriod) : null} hint={t("overview.approvedHint", { count: o.approvedInPeriod })} />
        <Stat label={t("overview.inProductionNow")} info={<InfoTip expert info={data.ceo.explain.inProduction} />} icon={Clock} value={n(o.inProduction)} hint={t("overview.inProductionHint")} />
        <Stat label={t("overview.awaitingApprovalNow")} info={<InfoTip expert info={data.ceo.explain.awaitingApproval} />} icon={Users} value={n(o.awaitingApproval)} hint={t("overview.awaitingApprovalHint")} />
        <Stat label={t("overview.overdueNow")} icon={AlertTriangle} info={<InfoTip expert info={data.ceo.explain.overdue} />} value={n(o.overdueContent)} hint={t("overview.overdueHint", { count: o.overdueTasks })} className={o.overdueContent ? "border-destructive/30" : undefined} />
        <Stat label={t("overview.upcoming")} info={<InfoTip expert info={data.ceo.explain.upcoming} />} icon={CalendarCheck2} value={n(o.upcoming)} hint={t("overview.upcomingHint")} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export async function InsightsSection({ data }: { data: AnalyticsData }) {
  const { t } = await tools();
  const tc = await getT("common");
  const list = data.insights;
  return (
    <Section id="insights" title={t("insightsSection.title")} description={t("insightsSection.description")}>
      {list.length ? (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {list.map((i) => (
            <li key={i.id} className={cn("flex gap-3 rounded-xl border bg-card p-3.5 shadow-xs", i.tone === "warning" && "border-warning/40", i.tone === "positive" && "border-success/30")}>
              {i.tone === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : i.tone === "positive" ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />}
              <div className="min-w-0 space-y-1 text-[13px]">
                <p className="font-medium">{i.fact}</p>
                <p className="tabular-nums text-muted-foreground">{i.figures}</p>
                {i.action ? <p className="text-muted-foreground"><span className="font-medium text-foreground/80">{t("insightsSection.suggested")}</span> {i.action}</p> : null}
                {i.href ? <Link href={i.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline print:hidden">{tc("actions.open")} <ArrowRight className="size-3.5" /></Link> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Alert variant="success" title={t("insightsSection.emptyTitle")}>{t("insightsSection.emptyBody")}</Alert>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// B. Strategy balance
// ---------------------------------------------------------------------------
export async function BalanceSection({ data }: { data: AnalyticsData }) {
  const { t, n, pct, platformLabel } = await tools();
  const b = data.balance;
  const base = `/p/${data.project.id}`;
  return (
    <Section id="strategy" title={t("balance.title")} description={t("balance.description", { count: b.total })}>
      {b.total === 0 ? (
        <EmptyState compact icon={CalendarCheck2} title={t("balance.emptyTitle")} description={t("balance.emptyBody")} action={<Button asChild size="sm" variant="outline"><Link href={`${base}/calendar`}>{t("balance.openCalendar")}</Link></Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">{t("balance.pillars.title")} <InfoTip expert info={data.ceo.explain.pillars} /></CardTitle><CardDescription>{data.targetsOff ? t("balance.pillars.filtered") : data.hasPillarTargets ? t("balance.pillars.withTargets") : t.rich("balance.pillars.noTargets", { link: (c) => <Link className="text-primary hover:underline" href={`${base}/strategy`}>{c}</Link> })}</CardDescription></CardHeader>
            <CardContent><ShareBars rows={b.pillars} empty={t("balance.pillars.empty")} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">{t("balance.funnel.title")} <InfoTip expert info={data.ceo.explain.funnel} /></CardTitle><CardDescription>{t("balance.funnel.tagged", { tagged: b.funnelTagged, total: b.total })} {data.targetsOff ? t("balance.funnel.filtered") : data.hasFunnelTargets ? t("balance.funnel.withTargets") : t("balance.funnel.noTargets")}</CardDescription></CardHeader>
            <CardContent><ShareBars rows={b.funnel} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">{t("balance.platforms.title")} <InfoTip expert info={data.ceo.explain.platforms} /></CardTitle><CardDescription>{data.platformTargetsOff ? t("balance.platforms.filtered") : data.hasChannelTargets ? t("balance.platforms.withTargets") : t.rich("balance.platforms.noTargets", { link: (c) => <Link className="text-primary hover:underline" href={`${base}/settings`}>{c}</Link> })}</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>{t("balance.platforms.platform")}</TableHead><TableHead className="text-right">{t("balance.platforms.planned")}</TableHead><TableHead className="text-right">{t("balance.platforms.expected")}</TableHead><TableHead className="text-right">{t("balance.platforms.difference")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {b.platforms.map((pl) => (
                    <TableRow key={pl.key}>
                      <TableCell>{platformLabel(pl.key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pl.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{pl.target != null ? n(pl.target, 1) : t("balance.platforms.noTarget")}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", pl.diff != null && pl.diff < 0 && "text-destructive")}>{pl.diff == null ? "—" : `${pl.diff > 0 ? "+" : ""}${n(pl.diff, 1)}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("balance.types.title")}</CardTitle><CardDescription>{t("balance.types.description")}</CardDescription></CardHeader>
            <CardContent><BarList rows={b.types.map((x) => ({ key: x.key, label: x.label, value: x.count, note: pct(x.share) }))} /></CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>{t("balance.mix.title")}</CardTitle><CardDescription>{t("balance.mix.description", { planned: b.total, published: b.publishedTotal })}</CardDescription></CardHeader>
            <CardContent>
              {b.publishedTotal === 0 ? <p className="mb-3 text-[13px] text-muted-foreground">{t("balance.mix.nothingPublished")}</p> : null}
              <Table>
                <TableHeader><TableRow><TableHead>{t("balance.mix.pillar")}</TableHead><TableHead className="text-right">{t("balance.mix.planned")}</TableHead><TableHead className="text-right">{t("balance.mix.published")}</TableHead><TableHead className="text-right">{t("balance.mix.gap")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {b.mix.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>{m.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(m.planned)} <span className="text-muted-foreground">({m.plannedCount})</span></TableCell>
                      <TableCell className="text-right tabular-nums">{b.publishedTotal ? <>{pct(m.published)} <span className="text-muted-foreground">({m.publishedCount})</span></> : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{b.publishedTotal ? t("labels.points", { value: `${(m.published - m.planned) > 0 ? "+" : ""}${n(Number((m.published - m.planned).toFixed(0)))}` }) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// C. Production performance
// ---------------------------------------------------------------------------
export async function ProductionSection({ data }: { data: AnalyticsData }) {
  const { t, n, days, stage } = await tools();
  const pr = data.production, pp = data.productionPrev;
  const hint = (now: number, prev: number | undefined) => (prev == null ? undefined : t("productionSection.previous", { count: prev }));
  const maxStage = Math.max(1, ...pr.stages.map((s) => s.count));
  return (
    <Section id="production" title={t("productionSection.title")} description={t("productionSection.description")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("productionSection.ideasCreated")} value={n(pr.ideasCreated)} delta={pp ? change(pr.ideasCreated, pp.ideasCreated) : null} hint={hint(pr.ideasCreated, pp?.ideasCreated)} />
        <Stat label={t("productionSection.movedToBrief")} value={n(pr.briefsCompleted)} delta={pp ? change(pr.briefsCompleted, pp.briefsCompleted) : null} hint={hint(pr.briefsCompleted, pp?.briefsCompleted)} />
        <Stat label={t("productionSection.sentToReview")} value={n(pr.enteredReview)} delta={pp ? change(pr.enteredReview, pp.enteredReview) : null} hint={hint(pr.enteredReview, pp?.enteredReview)} />
        <Stat label={t("productionSection.approved")} value={n(pr.approved)} delta={pp ? change(pr.approved, pp.approved) : null} hint={hint(pr.approved, pp?.approved)} />
        <Stat label={t("productionSection.published")} value={n(pr.published)} delta={pp ? change(pr.published, pp.published) : null} hint={hint(pr.published, pp?.published)} />
        <Stat label={t("productionSection.overdueNow")} value={n(pr.overdue)} hint={t("productionSection.overdueHint")} />
        <Stat label={t("productionSection.medianProduction")} info={<InfoTip expert info={data.ceo.explain.productionTime} />} value={days(pr.medianProductionDays)} goodWhen="down" delta={pp ? change(pr.medianProductionDays, pp.medianProductionDays) : null} hint={pr.productionSample ? t("productionSection.productionHint", { count: pr.productionSample }) : t("productionSection.productionNone")} />
        <Stat label={t("productionSection.medianApproval")} info={<InfoTip expert info={data.ceo.explain.approvalTime} />} value={days(pr.medianApprovalDays)} goodWhen="down" delta={pp ? change(pr.medianApprovalDays, pp.medianApprovalDays) : null} hint={pr.approvalSample ? t("productionSection.approvalHint", { count: pr.approvalSample }) : t("productionSection.approvalNone")} />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="flex items-center gap-1.5">{t("productionSection.throughputTitle")} <InfoTip expert info={data.ceo.explain.throughput} /></CardTitle><CardDescription>{t("productionSection.throughputDescription")}</CardDescription></CardHeader>
          <CardContent>
            <WeeklyColumns weeks={pr.weeks} series={[{ key: "created", label: t("productionSection.seriesCreated"), className: "bg-chart-a" }, { key: "approved", label: t("productionSection.seriesApproved"), className: "bg-chart-b" }, { key: "published", label: t("productionSection.seriesPublished"), className: "bg-chart-c" }]} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">{t("productionSection.waitsTitle")} <InfoTip expert info={data.ceo.explain.waits} /></CardTitle>
            <CardDescription>{pr.bottleneck ? t.rich("productionSection.waitsLongest", { stage: stage(pr.bottleneck.stage), b: (c) => <span className="font-medium text-foreground">{c}</span> }) : t("productionSection.waitsNone")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2.5">
              {pr.stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className={cn("truncate", pr.bottleneck?.stage === s.stage && "font-medium")}>{stage(s.stage)}</span>
                  <span className="h-2 rounded-full bg-secondary"><span className={cn("block h-2 rounded-full", pr.bottleneck?.stage === s.stage ? "bg-warning" : "bg-chart-b")} style={{ width: `${(s.count / maxStage) * 100}%` }} /></span>
                  <span className="whitespace-nowrap text-right tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{n(s.count)}</span>{s.count ? ` · ${days(s.medianDays)}` : ""}{s.overdue ? <span className="ml-1 text-destructive">{t("productionSection.late", { count: s.overdue })}</span> : null}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{t("productionSection.waitsNote")}</p>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// D. Team workload
// ---------------------------------------------------------------------------
export async function TeamSection({ data }: { data: AnalyticsData }) {
  const { t, n, days } = await tools();
  if (!data.team) {
    const m = data.myWork;
    return (
      <Section id="team" title={t("teamSection.myTitle")} description={t("teamSection.myDescription")}>
        {m ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("teamSection.openTasks")} value={n(m.open)} />
            <Stat label={t("teamSection.inReview")} value={n(m.inReview)} />
            <Stat label={t("teamSection.overdue")} value={n(m.overdue)} />
            <Stat label={t("teamSection.completedInPeriod")} value={n(m.completed)} />
          </div>
        ) : <p className="text-[13px] text-muted-foreground">{t("teamSection.noTasks")}</p>}
      </Section>
    );
  }
  return (
    <Section id="team" title={t("teamSection.title")} description={t("teamSection.description")}>
      {data.team.length ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">{t("teamSection.columns.person")}</TableHead><TableHead className="text-right">{t("teamSection.columns.open")}</TableHead><TableHead className="text-right">{t("teamSection.columns.inReview")}</TableHead>
                  <TableHead className="text-right">{t("teamSection.columns.changesAsked")}</TableHead><TableHead className="text-right">{t("teamSection.columns.overdue")}</TableHead><TableHead className="text-right">{t("teamSection.columns.dueIn7")}</TableHead>
                  <TableHead className="text-right">{t("teamSection.columns.leadOn")}</TableHead><TableHead className="text-right">{t("teamSection.columns.completed")}</TableHead><TableHead className="pr-5 text-right">{t("teamSection.columns.medianTime")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.team.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell className="pl-5"><span className="font-medium">{r.name}</span>{r.roleName ? <span className="ml-1.5 text-xs text-muted-foreground">{r.roleName}</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.open}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.inReview}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.changesRequested}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.overdue && "font-medium text-destructive")}>{r.overdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.dueNext7}{r.overlappingDeadlines ? <Badge variant="warning" className="ml-1.5">{t("teamSection.sameDay")}</Badge> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leadOpen}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums text-muted-foreground">{r.completionSample ? `${days(r.medianCompletionDays)} (${r.completionSample})` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState compact icon={Users} title={t("teamSection.emptyTitle")} description={t("teamSection.emptyBody")} />
      )}
      <p className="text-xs text-muted-foreground">{t("teamSection.note")}</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// E. Social performance
// ---------------------------------------------------------------------------
export async function SocialSection({ data }: { data: AnalyticsData }) {
  const { t, fmt, n, pct, platformLabel } = await tools();
  const base = `/p/${data.project.id}`;
  if (!data.access.canSeeSocial) {
    return <Section id="social" title={t("socialSection.title")}><Alert title={t("socialSection.noRoleTitle")}>{t("socialSection.noRoleBody")}</Alert></Section>;
  }
  const s = data.social!, sp = data.socialPrev;
  const nowMsValue = Date.parse(data.nowIso);
  const stale = (iso: string | null) => !iso || nowMsValue - Date.parse(iso) > 48 * 3600 * 1000;
  const accountLabel = (id: string) => data.options.accounts.find((a) => a.id === id)?.label ?? t("labels.account");
  const notAvailable = <span className="text-base text-muted-foreground">{t("labels.notAvailable")}</span>;
  const metric = (label: string, explainKey: string, value: number | null, prev: number | null | undefined, key: keyof typeof s.available | null, digits = 0, suffix = "") => (
    <Stat label={label} info={<InfoTip expert info={data.ceo.explain[explainKey]} />} value={value == null ? notAvailable : `${n(value, digits)}${suffix}`} delta={sp && value != null ? change(value, prev) : null}
      hint={value == null ? (key && s.posts ? t("socialSection.notReturned") : t("socialSection.noPosts")) : key ? t("socialSection.reported", { available: s.available[key], posts: s.posts }) : undefined} />
  );
  const series = (data.weekly?.platforms ?? []).slice(0, 4).map((p, i) => ({ key: p, label: platformLabel(p), className: ["bg-chart-b", "bg-chart-a", "bg-chart-c", "bg-info"][i] }));
  return (
    <Section id="social" title={t("socialSection.title")} description={t("socialSection.description", { count: s.posts })}
      actions={<Button asChild size="sm" variant="outline" className="print:hidden"><Link href={`${base}/integrations`}><PlugZap className="size-3.5" /> {t("socialSection.integrations")}</Link></Button>}>
      {/* Data freshness */}
      {data.freshness.length ? (
        <ul className="grid gap-2 text-[13px] sm:grid-cols-2">
          {data.freshness.map((f) => {
            const bad = f.status === "needs_attention" || f.status === "permission_denied" || f.status === "expired" || f.status === "error" || f.lastStatus === "failed";
            const old = stale(f.lastSuccess);
            return (
              <li key={f.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", bad ? "border-destructive/30" : old ? "border-warning/40" : "")}>
                <PlatformIcon platform={f.provider === "meta" ? "facebook" : f.provider} />
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                <span className={cn("shrink-0 text-xs", bad ? "text-destructive" : old ? "text-warning-foreground" : "text-muted-foreground")}>
                  {bad ? t("socialSection.needsAttention") : f.lastSuccess ? t("socialSection.updated", { date: fmt.dateTime(f.lastSuccess, { timeZone: data.tz, dateStyle: "medium", timeStyle: "short" }) }) : t("socialSection.notSynced")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Alert title={t("socialSection.noAccountTitle")}>{t.rich("socialSection.noAccountBody", { link: (c) => <Link href={`${base}/integrations`} className="font-medium text-primary hover:underline">{c}</Link> })}</Alert>
      )}
      {data.params.account ? <p className="text-xs text-muted-foreground">{t("socialSection.oneAccount", { account: accountLabel(data.params.account) })}</p> : null}
      {data.socialIgnoredFilters.length ? <p className="text-xs text-muted-foreground">{t("socialSection.ignoredFilters")}</p> : null}
      {s.posts === 0 ? (
        <EmptyState compact icon={TrendingUp} title={t("socialSection.emptyTitle")} description={t("socialSection.emptyBody")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metric(t("socialSection.metrics.reach"), "reach", s.reach, sp?.reach, "reach")}
            {metric(t("socialSection.metrics.impressions"), "", s.impressions, sp?.impressions, "impressions")}
            {metric(t("socialSection.metrics.engagements"), "engagement", s.engagement, sp?.engagement, null)}
            <Stat label={t("socialSection.metrics.medianRate")} info={<InfoTip expert info={data.ceo.explain.engagementRate} />} value={s.medianEngagementRate == null ? notAvailable : pct(s.medianEngagementRate, 2)} delta={sp ? change(s.medianEngagementRate, sp.medianEngagementRate) : null} hint={s.rateSample ? t("socialSection.rateHint", { count: s.rateSample }) : t("socialSection.rateNone")} />
            {metric(t("socialSection.metrics.videoViews"), "", s.videoViews ?? s.views, sp ? sp.videoViews ?? sp.views : null, s.videoViews != null ? "video_views" : "views")}
            {metric(t("socialSection.metrics.watchTime"), "", s.watchTime, sp?.watchTime, "watch_time_minutes")}
            {metric(t("socialSection.metrics.linkClicks"), "clicks", s.clicks, sp?.clicks, "clicks")}
            {metric(t("socialSection.metrics.conversions"), "", s.conversions ?? s.leads, sp ? sp.conversions ?? sp.leads : null, s.conversions != null ? "conversions" : "leads")}
          </div>

          <Card>
            <CardHeader><CardTitle>{t("socialSection.platformsTitle")}</CardTitle><CardDescription>{t("socialSection.platformsDescription")}</CardDescription></CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-5">{t("socialSection.columns.platform")}</TableHead><TableHead className="text-right">{t("socialSection.columns.posts")}</TableHead><TableHead className="text-right">{t("socialSection.columns.reach")}</TableHead><TableHead className="text-right">{t("socialSection.columns.views")}</TableHead><TableHead className="text-right">{t("socialSection.columns.interactions")}</TableHead><TableHead className="text-right">{t("socialSection.columns.medianPerPost")}</TableHead><TableHead className="pr-5 text-right">{t("socialSection.columns.medianRate")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {s.byPlatform.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="pl-5"><span className="inline-flex items-center gap-1.5"><PlatformIcon platform={r.key} /> {platformLabel(r.key)}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{r.posts}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.reach)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.engagement)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.medianEngagement)}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{r.medianRate == null ? "—" : `${pct(r.medianRate, 2)} (${n(r.rateSample)})`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader><CardTitle>{t("socialSection.weeklyTitle")}</CardTitle><CardDescription>{t("socialSection.weeklyDescription")}</CardDescription></CardHeader>
              <CardContent>{data.weekly && series.length ? <WeeklyColumns weeks={data.weekly.weeks} series={series} /> : <p className="text-[13px] text-muted-foreground">{t("socialSection.weeklyNone")}</p>}</CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>{t("socialSection.growthTitle")}</CardTitle><CardDescription>{t("socialSection.growthDescription")}</CardDescription></CardHeader>
              <CardContent>
                {data.growth.length ? (
                  <ul className="grid gap-2 text-[13px]">
                    {data.growth.map((g) => (
                      <li key={g.connection_id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">{accountLabel(g.connection_id)}</span>
                        <span className="shrink-0 tabular-nums">
                          <span className="font-medium">{n(g.end)}</span>
                          {g.change == null ? <span className="ml-1 text-xs text-muted-foreground">{t("socialSection.growthOne")}</span>
                            : <span className={cn("ml-1 text-xs", g.change > 0 ? "text-success" : g.change < 0 ? "text-destructive" : "text-muted-foreground")}>{t("socialSection.growthSince", { change: `${g.change > 0 ? "+" : ""}${n(g.change)}`, date: g.from })}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-[13px] text-muted-foreground">{t("socialSection.growthNone")}</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {([[t("socialSection.byType"), s.byFormat, (k: string) => contentTypeLabel(t, k)], [t("socialSection.byPillar"), s.byPillar, (k: string) => (k === "none" ? t("labels.noPillar") : data.pillarNames[k] ?? t("labels.unknownPillar"))]] as const).map(([title, rows, label]) => (
              <Card key={title}>
                <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{t("socialSection.medianPerPost")}</CardDescription></CardHeader>
                <CardContent><BarList rows={rows.filter((r) => r.medianEngagement != null).map((r) => ({ key: r.key, label: label(r.key), value: Math.round(r.medianEngagement!), note: t("socialSection.postsNote", { count: r.posts }) }))} empty={t("socialSection.noEngagement")} /></CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle>{t("socialSection.topTitle")}</CardTitle><CardDescription>{t("socialSection.topDescription")}{s.bottom.length ? ` ${t("socialSection.topLowestNote")}` : ""}</CardDescription></CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-5">{t("socialSection.columns.post")}</TableHead><TableHead>{t("socialSection.columns.platform")}</TableHead><TableHead>{t("socialSection.columns.date")}</TableHead><TableHead className="text-right">{t("socialSection.columns.reach")}</TableHead><TableHead className="text-right">{t("socialSection.columns.views")}</TableHead><TableHead className="pr-5 text-right">{t("socialSection.columns.interactions")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...s.top.map((r) => ({ ...r, group: "top" })), ...s.bottom.map((r) => ({ ...r, group: "bottom" }))].map((r, i) => (
                    <TableRow key={`${r.group}-${r.id}`} className={cn(r.group === "bottom" && i === s.top.length && "border-t-2")}>
                      <TableCell className="max-w-[22rem] pl-5"><span className="line-clamp-1" dir="auto">{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" className="hover:underline">{r.title || t("labels.untitledPost")}</a> : r.title || t("labels.untitledPost")}</span>{r.group === "bottom" ? <span className="text-xs text-muted-foreground">{t("socialSection.lowest")}</span> : null}</TableCell>
                      <TableCell>{r.platform ? platformLabel(r.platform) : "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.reach)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.video_views ?? r.views)}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{n(r.engagement)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Definitions (shown on the page and in the printable report)
// ---------------------------------------------------------------------------
export const DEFINITION_KEYS = [
  "planned", "published", "completion", "approvedPerWeek", "inProduction", "overdue", "moved", "productionTime", "approvalTime", "waits", "targets",
  "engagements", "engagementRate", "comparison",
] as const;

export async function DefinitionsSection() {
  const t = await getT("analytics");
  return (
    <details id="definitions" className="rounded-xl border bg-card p-4 text-[13px] shadow-xs print:hidden">
      <summary className="cursor-pointer font-medium">{t("definitions.summary")}</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        {DEFINITION_KEYS.map((k) => <div key={k}><dt className="font-medium">{t(`definitions.${k}.term`)}</dt><dd className="text-muted-foreground">{t(`definitions.${k}.text`)}</dd></div>)}
      </dl>
    </details>
  );
}

export async function NoContentState({ projectId }: { projectId: string }) {
  const t = await getT("analytics");
  return (
    <EmptyState icon={Lightbulb} title={t("noContent.title")} description={t("noContent.body")}
      action={<><Button asChild size="sm"><Link href={`/p/${projectId}/calendar`}>{t("noContent.openCalendar")}</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/history`}>{t("noContent.history")}</Link></Button></>} />
  );
}
