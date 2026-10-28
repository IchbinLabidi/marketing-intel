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
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { STAGE_LABELS, type ProductionStage } from "@/lib/production/model";
import type { AnalyticsData } from "@/server/services/analytics";
import { cn } from "@/lib/utils";
import { ShareBars, WeeklyColumns } from "./charts";
import { InfoTip } from "./info-tip";

const n = (v: number | null | undefined, digits = 0) => (v == null ? "—" : v.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
const change = (now: number | null | undefined, prev: number | null | undefined) => (now == null || prev == null || prev === 0 ? null : ((now - prev) / prev) * 100);
const days = (v: number | null) => (v == null ? "—" : v < 1 ? `${(v * 24).toFixed(0)} h` : `${v.toFixed(1)} d`);
const stage = (s: string) => STAGE_LABELS[s as ProductionStage] ?? s;
const platformLabel = (p: string) => PLATFORM_LABELS[p as Platform] ?? p;
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const periodLabel = (p: { from: string; to: string }) => `${fmtDate(p.from)} – ${fmtDate(p.to)}`;

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
export function OverviewSection({ data }: { data: AnalyticsData }) {
  const o = data.overview, p = data.overviewPrev;
  const weeks = ((Date.parse(data.params.period.to) - Date.parse(data.params.period.from)) / 86_400_000 + 1) / 7;
  const prevHint = p ? `vs ${periodLabel(data.prevPeriod)}` : undefined;
  return (
    <Section id="overview" title="Overview" description={`${periodLabel(data.params.period)}. ${data.periodOpen ? `The period isn't over, so results so far are compared with ${periodLabel(data.prevPeriod)}` : "Counts in the period compare with the previous period of the same length"}; current workload is as of today.`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Planned in period" info={<InfoTip expert info={data.ceo.explain.planned} />} icon={CalendarCheck2} value={n(o.planned)} delta={p && !data.periodOpen ? change(o.planned, p.planned) : null} hint={p ? `${n(p.planned)} ${prevHint}` : "Planned publication date in the period"} />
        <Stat label="Published in period" info={<InfoTip expert info={data.ceo.explain.published} />} icon={Send} value={n(o.published)} delta={p ? change(o.published, p.published) : null} hint={p ? `${n(p.published)} ${prevHint}` : "Verified publications"} />
        <Stat label="Completion rate" info={<InfoTip expert info={data.ceo.explain.completion} />} icon={CheckCircle2} value={o.completionRate == null ? "—" : `${o.completionRate.toFixed(0)}%`} hint={o.completionBase ? `${Math.round(((o.completionRate ?? 0) / 100) * o.completionBase)} of ${o.completionBase} past planned dates published` : "No planned dates have passed yet"} />
        <Stat label="Approved per week" info={<InfoTip expert info={data.ceo.explain.approvedPerWeek} />} icon={TrendingUp} value={n(o.approvedInPeriod / weeks, 1)} delta={p ? change(o.approvedInPeriod, p.approvedInPeriod) : null} hint={`${o.approvedInPeriod} approved in the period`} />
        <Stat label="In production now" info={<InfoTip expert info={data.ceo.explain.inProduction} />} icon={Clock} value={n(o.inProduction)} hint="Brief or In Production stage" />
        <Stat label="Awaiting approval now" info={<InfoTip expert info={data.ceo.explain.awaitingApproval} />} icon={Users} value={n(o.awaitingApproval)} hint="Internal review or approval stage" />
        <Stat label="Overdue now" icon={AlertTriangle} info={<InfoTip expert info={data.ceo.explain.overdue} />} value={n(o.overdueContent)} hint={`${o.overdueTasks} overdue task${o.overdueTasks === 1 ? "" : "s"} · internal deadline passed`} className={o.overdueContent ? "border-destructive/30" : undefined} />
        <Stat label="Upcoming (7 days)" info={<InfoTip expert info={data.ceo.explain.upcoming} />} icon={CalendarCheck2} value={n(o.upcoming)} hint="Planned, not yet published" />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export function InsightsSection({ data }: { data: AnalyticsData }) {
  const list = data.insights;
  return (
    <Section id="insights" title="What needs attention" description="Each point is calculated from the figures on this page. Suggestions are labelled as such; nothing here is generated by AI.">
      {list.length ? (
        <ul className="grid gap-2.5 md:grid-cols-2">
          {list.map((i) => (
            <li key={i.id} className={cn("flex gap-3 rounded-xl border bg-card p-3.5 shadow-xs", i.tone === "warning" && "border-warning/40", i.tone === "positive" && "border-success/30")}>
              {i.tone === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : i.tone === "positive" ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />}
              <div className="min-w-0 space-y-1 text-[13px]">
                <p className="font-medium">{i.fact}</p>
                <p className="tabular-nums text-muted-foreground">{i.figures}</p>
                {i.action ? <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Suggested next step:</span> {i.action}</p> : null}
                {i.href ? <Link href={i.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline print:hidden">Open <ArrowRight className="size-3.5" /></Link> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Alert variant="success" title="Nothing stands out for this selection">No pillar is below target, nothing waits unusually long, and nothing is overdue. Insights need at least 5 planned items to compare shares.</Alert>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// B. Strategy balance
// ---------------------------------------------------------------------------
export function BalanceSection({ data }: { data: AnalyticsData }) {
  const b = data.balance;
  const base = `/p/${data.project.id}`;
  return (
    <Section id="strategy" title="Strategy balance" description={`Planned content in the period (${b.total} item${b.total === 1 ? "" : "s"}) compared with the targets set in the strategy. A tick marks the target; amber means more than 5 points under it.`}>
      {b.total === 0 ? (
        <EmptyState compact icon={CalendarCheck2} title="No content planned in this period" description="Plan content in the calendar, or widen the period or the filters." action={<Button asChild size="sm" variant="outline"><Link href={`${base}/calendar`}>Open the calendar</Link></Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">Content pillars <InfoTip expert info={data.ceo.explain.pillars} /></CardTitle><CardDescription>{data.targetsOff ? "Filters are applied, so shares are not compared with the strategy targets (they describe the whole plan)." : data.hasPillarTargets ? "Share of planned items vs each pillar's target share." : <>No pillar has a target share yet. <Link className="text-primary hover:underline" href={`${base}/strategy`}>Set targets in the strategy</Link>.</>}</CardDescription></CardHeader>
            <CardContent><ShareBars rows={b.pillars} empty="No pillars defined." /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">Funnel stages <InfoTip expert info={data.ceo.explain.funnel} /></CardTitle><CardDescription>{b.funnelTagged} of {b.total} planned items have a funnel stage. {data.targetsOff ? "Filters are applied, so shares are not compared with targets." : data.hasFunnelTargets ? "Targets come from percentages written in the strategy's funnel notes." : "No numeric funnel targets are set, so only the distribution is shown."}</CardDescription></CardHeader>
            <CardContent><ShareBars rows={b.funnel} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5">Platforms <InfoTip expert info={data.ceo.explain.platforms} /></CardTitle><CardDescription>{data.platformTargetsOff ? "Filters are applied, so planned posts are not compared with channel targets." : data.hasChannelTargets ? "Planned posts vs the channel's posts-per-week target, scaled to the period." : <>No channel has a posting target. <Link className="text-primary hover:underline" href={`${base}/settings`}>Add one in project settings</Link>.</>}</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Platform</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Difference</TableHead></TableRow></TableHeader>
                <TableBody>
                  {b.platforms.map((pl) => (
                    <TableRow key={pl.key}>
                      <TableCell>{platformLabel(pl.key)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pl.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{pl.target ?? "No target"}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", pl.diff != null && pl.diff < 0 && "text-destructive")}>{pl.diff == null ? "—" : `${pl.diff > 0 ? "+" : ""}${n(pl.diff, 1)}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Content types</CardTitle><CardDescription>Planned items by type (from the format field). No type targets exist in the strategy.</CardDescription></CardHeader>
            <CardContent><BarList rows={b.types.map((t) => ({ key: t.key, label: t.label, value: t.count, note: `${t.share.toFixed(0)}%` }))} /></CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Planned vs published mix by pillar</CardTitle><CardDescription>Share of the {b.total} planned items next to the share of the {b.publishedTotal} items published in the same period.</CardDescription></CardHeader>
            <CardContent>
              {b.publishedTotal === 0 ? <p className="mb-3 text-[13px] text-muted-foreground">Nothing was published in this period, so only the planned mix is shown.</p> : null}
              <Table>
                <TableHeader><TableRow><TableHead>Pillar</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Published</TableHead><TableHead className="text-right">Gap</TableHead></TableRow></TableHeader>
                <TableBody>
                  {b.mix.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell>{m.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.planned.toFixed(0)}% <span className="text-muted-foreground">({m.plannedCount})</span></TableCell>
                      <TableCell className="text-right tabular-nums">{b.publishedTotal ? <>{m.published.toFixed(0)}% <span className="text-muted-foreground">({m.publishedCount})</span></> : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{b.publishedTotal ? `${(m.published - m.planned) > 0 ? "+" : ""}${(m.published - m.planned).toFixed(0)} pts` : "—"}</TableCell>
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
export function ProductionSection({ data }: { data: AnalyticsData }) {
  const pr = data.production, pp = data.productionPrev;
  const hint = (now: number, prev: number | undefined) => (prev == null ? undefined : `${prev} previous period`);
  const maxStage = Math.max(1, ...pr.stages.map((s) => s.count));
  return (
    <Section id="production" title="Production" description="Movement through the workflow in the period, and where work is waiting now.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ideas created" value={n(pr.ideasCreated)} delta={pp ? change(pr.ideasCreated, pp.ideasCreated) : null} hint={hint(pr.ideasCreated, pp?.ideasCreated)} />
        <Stat label="Moved to brief" value={n(pr.briefsCompleted)} delta={pp ? change(pr.briefsCompleted, pp.briefsCompleted) : null} hint={hint(pr.briefsCompleted, pp?.briefsCompleted)} />
        <Stat label="Sent to review" value={n(pr.enteredReview)} delta={pp ? change(pr.enteredReview, pp.enteredReview) : null} hint={hint(pr.enteredReview, pp?.enteredReview)} />
        <Stat label="Approved" value={n(pr.approved)} delta={pp ? change(pr.approved, pp.approved) : null} hint={hint(pr.approved, pp?.approved)} />
        <Stat label="Published" value={n(pr.published)} delta={pp ? change(pr.published, pp.published) : null} hint={hint(pr.published, pp?.published)} />
        <Stat label="Overdue now" value={n(pr.overdue)} hint="Internal deadline passed, not approved" />
        <Stat label="Median production time" info={<InfoTip expert info={data.ceo.explain.productionTime} />} value={days(pr.medianProductionDays)} goodWhen="down" delta={pp ? change(pr.medianProductionDays, pp.medianProductionDays) : null} hint={pr.productionSample ? `Created → approved, ${pr.productionSample} item${pr.productionSample === 1 ? "" : "s"}` : "No item approved in the period"} />
        <Stat label="Median approval time" info={<InfoTip expert info={data.ceo.explain.approvalTime} />} value={days(pr.medianApprovalDays)} goodWhen="down" delta={pp ? change(pr.medianApprovalDays, pp.medianApprovalDays) : null} hint={pr.approvalSample ? `First review → approved, ${pr.approvalSample} item${pr.approvalSample === 1 ? "" : "s"}` : "No reviewed item approved in the period"} />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="flex items-center gap-1.5">Throughput per week <InfoTip expert info={data.ceo.explain.throughput} /></CardTitle><CardDescription>Ideas created, items approved and items published, by week of the period.</CardDescription></CardHeader>
          <CardContent>
            <WeeklyColumns weeks={pr.weeks} series={[{ key: "created", label: "Created", className: "bg-chart-a" }, { key: "approved", label: "Approved", className: "bg-chart-b" }, { key: "published", label: "Published", className: "bg-chart-c" }]} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">Where work waits now <InfoTip expert info={data.ceo.explain.waits} /></CardTitle>
            <CardDescription>{pr.bottleneck ? <>Longest wait: <span className="font-medium text-foreground">{stage(pr.bottleneck.stage)}</span> (items × median days in stage).</> : "Nothing is waiting beyond the idea stage."}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2.5">
              {pr.stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className={cn("truncate", pr.bottleneck?.stage === s.stage && "font-medium")}>{stage(s.stage)}</span>
                  <span className="h-2 rounded-full bg-secondary"><span className={cn("block h-2 rounded-full", pr.bottleneck?.stage === s.stage ? "bg-warning" : "bg-chart-b")} style={{ width: `${(s.count / maxStage) * 100}%` }} /></span>
                  <span className="whitespace-nowrap text-right tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{s.count}</span>{s.count ? ` · ${days(s.medianDays)}` : ""}{s.overdue ? <span className="ml-1 text-destructive">· {s.overdue} late</span> : null}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Days in stage are measured from the last move into the stage, or from creation when no move is recorded.</p>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// D. Team workload
// ---------------------------------------------------------------------------
export function TeamSection({ data }: { data: AnalyticsData }) {
  if (!data.team) {
    const m = data.myWork;
    return (
      <Section id="team" title="My workload" description="Your own tasks. Team-wide workload is visible to people who assign work.">
        {m ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open tasks" value={m.open} />
            <Stat label="In review" value={m.inReview} />
            <Stat label="Overdue" value={m.overdue} />
            <Stat label="Completed in period" value={m.completed} />
          </div>
        ) : <p className="text-[13px] text-muted-foreground">You have no tasks on the content in this selection.</p>}
      </Section>
    );
  }
  return (
    <Section id="team" title="Team workload" description="Listed alphabetically, not ranked. Counts reflect assigned tasks only; they don't measure effort or quality, and people have different responsibilities.">
      {data.team.length ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Person</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">In review</TableHead>
                  <TableHead className="text-right">Changes asked</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead className="text-right">Due in 7 days</TableHead>
                  <TableHead className="text-right">Lead on</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="pr-5 text-right">Median time to complete</TableHead>
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
                    <TableCell className="text-right tabular-nums">{r.dueNext7}{r.overlappingDeadlines ? <Badge variant="warning" className="ml-1.5">same day</Badge> : null}</TableCell>
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
        <EmptyState compact icon={Users} title="No tasks assigned on this content" description="Assign collaborators from a content item's detail panel in the calendar." />
      )}
      <p className="text-xs text-muted-foreground">“Completed” counts tasks approved or completed in the period. Time to complete runs from task creation to its last update, so it is an approximation.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// E. Social performance
// ---------------------------------------------------------------------------
export function SocialSection({ data }: { data: AnalyticsData }) {
  const base = `/p/${data.project.id}`;
  if (!data.access.canSeeSocial) {
    return <Section id="social" title="Social performance"><Alert title="Not available with your role">Performance data comes from Content history, which your role can&apos;t view.</Alert></Section>;
  }
  const s = data.social!, sp = data.socialPrev, meta = data.meta;
  const status = !meta || meta.status === "disconnected"
    ? { tone: "info" as const, text: "No Meta account is connected. Metrics below come only from imported files, if any." }
    : meta.status === "error" || meta.status === "expired" || meta.last_sync_status === "failed"
      ? { tone: "destructive" as const, text: `The last Meta sync failed or access expired (${meta.status === "expired" ? "access expired" : meta.last_error || meta.status}). Figures may be out of date${meta.last_sync_at ? ` since ${new Date(meta.last_sync_at).toLocaleString("en-GB", { timeZone: data.tz })}` : ""}.` }
      : meta.last_sync_status === "partial"
        ? { tone: "warning" as const, text: `The last Meta sync was partial: ${meta.last_error || "some platforms did not sync"}.` }
      : meta.status === "pending_page"
        ? { tone: "warning" as const, text: "Meta is connected but no Page is selected yet, so nothing has synced." }
        : { tone: "success" as const, text: `Meta connected${meta.page_name ? ` (${meta.page_name}${meta.ig_username ? ` · @${meta.ig_username}` : ""})` : ""}. ${meta.last_sync_at ? `Last sync ${new Date(meta.last_sync_at).toLocaleString("en-GB", { timeZone: data.tz })}.` : meta.last_sync_status === "succeeded" ? "Last sync succeeded." : "No sync has run yet."}${meta.ig_user_id && s.posts && !s.byPlatform.some((r) => r.key === "instagram") ? " No Instagram posts with data in this period." : ""}` };
  const metric = (label: string, value: number | null, prev: number | null | undefined, key: keyof typeof s.available | null, digits = 0, suffix = "") => (
    <Stat label={label} info={<InfoTip expert info={data.ceo.explain[({ Reach: "reach", Engagements: "engagement", "Link clicks": "clicks" } as Record<string, string>)[label] ?? ""]} />} value={value == null ? <span className="text-base text-muted-foreground">Not available</span> : `${n(value, digits)}${suffix}`} delta={sp && value != null ? change(value, prev) : null}
      hint={value == null ? (key && s.posts ? "Not returned for these posts" : "No posts in the period") : key ? `${s.available[key]} of ${s.posts} posts report it` : undefined} />
  );
  return (
    <Section id="social" title="Social performance" description={`Published posts in the period from connected or imported sources (${s.posts} post${s.posts === 1 ? "" : "s"}). A dash or “Not available” means the source didn't return the metric; zero means it returned zero.`}
      actions={<Button asChild size="sm" variant="outline" className="print:hidden"><Link href={`${base}/history`}>Content history</Link></Button>}>
      <Alert variant={status.tone} title={status.tone === "success" ? undefined : "Data source"} action={status.tone !== "success" ? <Button asChild size="sm" variant="outline" className="print:hidden"><Link href={`${base}/history`}><PlugZap className="size-3.5" /> Manage connection</Link></Button> : undefined}>{status.text}</Alert>
      {data.socialIgnoredFilters.length ? <p className="text-xs text-muted-foreground">Funnel, content type, production stage and collaborator filters don&apos;t apply here: imported and synced posts don&apos;t carry those fields reliably.</p> : null}
      {s.posts === 0 ? (
        <EmptyState compact icon={TrendingUp} title="No published posts with data in this period" description="Sync Meta or import a performance file in Content history, or widen the period." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metric("Reach", s.reach, sp?.reach, "reach")}
            {metric("Impressions", s.impressions, sp?.impressions, "impressions")}
            {metric("Engagements", s.engagement, sp?.engagement, null)}
            <Stat label="Median engagement rate" info={<InfoTip expert info={data.ceo.explain.engagementRate} />} value={s.medianEngagementRate == null ? <span className="text-base text-muted-foreground">Not available</span> : `${s.medianEngagementRate.toFixed(2)}%`} delta={sp ? change(s.medianEngagementRate, sp.medianEngagementRate) : null} hint={s.rateSample ? `Engagements ÷ reach, ${s.rateSample} posts with consistent reach` : "Needs reach and interactions"} />
            {metric("Video views", s.videoViews ?? s.views, sp ? sp.videoViews ?? sp.views : null, s.videoViews != null ? "video_views" : "views")}
            {metric("Link clicks", s.clicks, sp?.clicks, "clicks")}
            <Stat label="Click-through rate" value={s.ctr == null ? <span className="text-base text-muted-foreground">Not available</span> : `${s.ctr.toFixed(2)}%`} hint="Clicks ÷ reach, posts reporting both" />
            {metric("Conversions", s.conversions ?? s.leads, sp ? sp.conversions ?? sp.leads : null, s.conversions != null ? "conversions" : "leads")}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {([["By platform", s.byPlatform, platformLabel], ["By content type", s.byFormat, (k: string) => k], ["By pillar", s.byPillar, (k: string) => (k === "none" ? "No pillar" : data.pillarNames[k] ?? "Unknown pillar")]] as const).map(([title, rows, label]) => (
              <Card key={title}>
                <CardHeader><CardTitle>{title}</CardTitle><CardDescription>Median engagements per post.</CardDescription></CardHeader>
                <CardContent><BarList rows={rows.filter((r) => r.medianEngagement != null).map((r) => ({ key: r.key, label: label(r.key), value: Math.round(r.medianEngagement!), note: `· ${r.posts} posts` }))} empty="No engagement data." /></CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle>Top posts in the period</CardTitle><CardDescription>By engagements (likes + comments + shares + saves, where reported).{s.bottom.length ? " The lowest five are listed below for comparison." : ""}</CardDescription></CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-5">Post</TableHead><TableHead>Platform</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Reach</TableHead><TableHead className="pr-5 text-right">Engagements</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...s.top.map((r) => ({ ...r, group: "top" })), ...s.bottom.map((r) => ({ ...r, group: "bottom" }))].map((r, i) => (
                    <TableRow key={`${r.group}-${r.id}`} className={cn(r.group === "bottom" && i === s.top.length && "border-t-2")}>
                      <TableCell className="max-w-[22rem] pl-5"><span className="line-clamp-1" dir="auto">{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" className="hover:underline">{r.title || "Untitled post"}</a> : r.title || "Untitled post"}</span>{r.group === "bottom" ? <span className="text-xs text-muted-foreground">Lowest</span> : null}</TableCell>
                      <TableCell>{r.platform ? platformLabel(r.platform) : "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.date ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.reach)}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{n(r.engagement)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <p className="text-xs text-muted-foreground">Followers and watch time are not stored by the current integrations, so they are not shown.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Definitions (shown on the page and in the printable report)
// ---------------------------------------------------------------------------
export const DEFINITIONS: [string, string][] = [
  ["Planned in period", "Content items whose planned publication date falls in the period."],
  ["Published in period", "Items marked published whose verified publication time (in the project's time zone) falls in the period."],
  ["Completion rate", "Of the items planned for dates in the period that have already passed, the share that is published."],
  ["Approved per week", "Items whose final approval falls in the period, divided by the number of weeks in the period."],
  ["In production / awaiting approval", "Current count of items in the Brief or In Production stages, and in Internal Review or Approval. A snapshot as of today, not tied to the period."],
  ["Overdue", "Items whose internal deadline is before today and that are not yet approved, scheduled or published. Overdue tasks: open tasks past their due date."],
  ["Moved to brief / Sent to review", "Items that entered the stage during the period, from the recorded stage history."],
  ["Production time", "Median time from an item's creation to its final approval, for items approved in the period."],
  ["Approval time", "Median time from an item's first entry into review to its final approval."],
  ["Where work waits", "Items currently in each stage and the median days since they entered it. The bottleneck is the stage with the largest items × median days, excluding ideas."],
  ["Strategy targets", "Pillar targets are the pillar's target share. Platform targets are the channel's posts per week × weeks in the period. Funnel targets are used only when the strategy's funnel notes contain a percentage. A share is flagged when it is more than 5 points under target."],
  ["Engagements", "Likes + comments + shares + saves, counting only the metrics a post reports."],
  ["Engagement rate", "Engagements ÷ reach × 100, only for posts whose reach is at least every single interaction count."],
  ["Comparison", "The previous period of the same length, ending the day before the selected period starts."],
];

export function DefinitionsSection() {
  return (
    <details id="definitions" className="rounded-xl border bg-card p-4 text-[13px] shadow-xs print:hidden">
      <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        {DEFINITIONS.map(([t, d]) => <div key={t}><dt className="font-medium">{t}</dt><dd className="text-muted-foreground">{d}</dd></div>)}
      </dl>
    </details>
  );
}

export function NoContentState({ projectId }: { projectId: string }) {
  return (
    <EmptyState icon={Lightbulb} title="No content to analyse yet" description="Analytics is calculated from the content you plan and produce. Add ideas in the calendar or Content Production, and connect Meta in Content history for performance data."
      action={<><Button asChild size="sm"><Link href={`/p/${projectId}/calendar`}>Open the calendar</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/history`}>Content history</Link></Button></>} />
  );
}
