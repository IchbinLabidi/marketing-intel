import Link from "next/link";
import { ExternalLink, Info, Sparkles, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/app/empty-state";
import { CTA_KEYS, DELETED_PILLAR, HOOK_KEYS, type PlatformPerformance } from "@/lib/history/performance";
import { formatLabel, platformLabel } from "@/lib/history/parse";
import { getFormatter, getT } from "@/i18n/server";
import { ValueColumns } from "./charts";
import { ClassifyPillarsButton } from "./classify-pillars-button";

export async function PerformanceView({
  projectId,
  performance,
  unassignedPillars,
  aiPillars,
  hasPillars,
  readOnly,
  aiEnabled,
}: {
  projectId: string;
  performance: PlatformPerformance[];
  unassignedPillars: number;
  aiPillars: number;
  hasPillars: boolean;
  readOnly: boolean;
  aiEnabled: boolean;
}) {
  const [t, td, fmt] = await Promise.all([getT("history"), getT("domain"), getFormatter()]);
  const monthLabel = (m: string) => fmt.date(`${m}-01T00:00:00Z`, { month: "short", year: "2-digit", timeZone: "UTC" });
  const n = (v: number | null | undefined) => (v == null ? "—" : fmt.number(v));
  const ctaLabel = (label: string) => (CTA_KEYS[label] ? t(`performance.ctas.${CTA_KEYS[label]}`) : label);
  const hookLabel = (label: string) => (HOOK_KEYS[label] ? t(`performance.hooks.${HOOK_KEYS[label]}`) : label);
  if (!performance.length) {
    return (
      <EmptyState
        icon={Trophy}
        title={t("performance.emptyTitle")}
        description={t("performance.emptyDescription")}
      />
    );
  }
  return (
    <div className="space-y-8">
      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p>
            {t.rich("performance.legend", { raw: (c) => <Badge variant="secondary">{c}</Badge>, calc: (c) => <Badge variant="default">{c}</Badge> })}
          </p>
          <p>{t("performance.legendPatterns")}</p>
        </div>
      </div>

      {hasPillars && unassignedPillars > 0 && !readOnly ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <p>{t("performance.unassigned", { count: unassignedPillars })} {aiPillars ? t("performance.aiAssigned", { count: aiPillars }) : ""}</p>
          <ClassifyPillarsButton projectId={projectId} aiEnabled={aiEnabled} />
        </div>
      ) : null}

      {performance.map((p) => {
        const unit = p.metric === "engagement_rate" ? t("performance.unitRate") : t("performance.unitEngagements");
        return (
          <section key={p.platform} className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{platformLabel(td, p.platform)}</h2>
                <p className="text-xs text-muted-foreground">
                  {p.metric === "engagement_rate" ? t("performance.summaryRate", { count: p.posts, median: p.baseline ?? "" }) : t("performance.summaryEngagement", { count: p.posts, median: p.baseline ?? "" })}
                </p>
                {p.inconsistentReach ? (
                  <p className="text-xs text-warning">
                    {t("performance.inconsistentReach", { count: p.inconsistentReach })}{" "}
                    {p.metric === "engagement_rate" ? t("performance.leftOutRanked", { ranked: p.ranked, posts: p.posts }) : t("performance.leftOut")}
                  </p>
                ) : null}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Trophy className="size-4" /> {t("performance.topPosts")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">{t("performance.columns.post")}</th><th className="pr-3 font-medium">{t("performance.columns.format")}</th>
                      <th className="pr-2 text-right font-medium">{t("performance.columns.likes")}</th><th className="pr-2 text-right font-medium">{t("performance.columns.comments")}</th><th className="pr-2 text-right font-medium">{t("performance.columns.shares")}</th>
                      <th className="pr-2 text-right font-medium">{t("performance.columns.saves")}</th><th className="pr-2 text-right font-medium">{t("performance.columns.reach")}</th><th className="pr-3 text-right font-medium">{t("performance.columns.views")}</th>
                      <th className="pr-2 text-right font-medium">{t("performance.columns.engagement")}</th><th className="text-right font-medium">{t("performance.columns.rate")}</th>
                    </tr>
                    <tr className="border-b text-[10px] uppercase tracking-wide">
                      <th colSpan={2} /><th colSpan={6} className="pb-1 text-center font-normal">{t("performance.raw")}</th><th colSpan={2} className="pb-1 text-center font-normal">{t("performance.calculated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.top.map((row) => (
                      <tr key={row.id} className="border-b align-top last:border-0">
                        <td className="max-w-xs py-2 pr-3">
                          <p className="line-clamp-2">{row.title === "(untitled)" ? t("common.untitled") : row.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.date ?? t("common.noDate")}
                            {row.permalink ? <a className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline" href={row.permalink} target="_blank" rel="noreferrer">{t("performance.openPost")} <ExternalLink className="size-3" /></a> : null}
                          </p>
                        </td>
                        <td className="pr-3">{formatLabel(t, row.format) ?? "—"}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.raw.likes)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.raw.comments)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.raw.shares)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.raw.saves)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.raw.reach)}</td>
                        <td className="pr-3 text-right tabular-nums">{n(row.raw.views)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(row.engagement)}</td>
                        <td className="text-right tabular-nums">{row.rate != null ? `${row.rate}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("performance.trend")}</CardTitle>
                <CardDescription>{t("performance.trendHint", { unit })}</CardDescription>
              </CardHeader>
              <CardContent>
                <ValueColumns unit={unit} points={p.trend.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.median, n: m.n }))} />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <GroupCard title={t("performance.byFormat")} rows={p.byFormat.map((g) => ({ ...g, label: formatLabel(t, g.label) }))} unit={unit} empty={t("performance.byFormatEmpty")} hint={t("performance.groupHint", { unit })} />
              <GroupCard
                title={t("performance.byPillar")}
                rows={p.byPillar.map((g) => ({ ...g, label: g.label === DELETED_PILLAR ? t("common.deletedPillar") : g.label }))}
                unit={unit}
                empty={hasPillars ? t("performance.byPillarEmpty") : t("performance.byPillarNoPillars")}
                footer={hasPillars && aiPillars ? t("performance.byPillarAi") : undefined}
                hint={t("performance.groupHint", { unit })}
              />
              <Card>
                <CardHeader><CardTitle>{t("performance.topics")}</CardTitle><CardDescription>{t("performance.topicsHint")}</CardDescription></CardHeader>
                <CardContent>
                  {p.topics.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.topics.map((tp) => (
                        <Badge key={tp.topic} variant={(tp.lift ?? 0) >= 1.2 ? "success" : (tp.lift ?? 1) <= 0.8 ? "warning" : "secondary"}>{tp.topic} ×{tp.lift} <span className="font-normal opacity-70">n={tp.n}</span></Badge>
                      ))}
                    </div>
                  ) : <p className="text-[13px] text-muted-foreground">{t("performance.topicsEmpty")}</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t("performance.hooksTitle")}</CardTitle><CardDescription>{t("performance.hooksHint")}</CardDescription></CardHeader>
                <CardContent className="space-y-3 text-[13px]">
                  <ul className="space-y-1">
                    {p.hooks.top.slice(0, 5).map((h) => <li key={h.id} className="line-clamp-1">“{h.hook}” <span className="text-xs text-muted-foreground">· {h.score}</span></li>)}
                  </ul>
                  {p.hooks.patterns.length ? (
                    <div className="flex flex-wrap gap-1.5 border-t pt-2">
                      {p.hooks.patterns.map((h) => <Badge key={h.label} variant="outline">{hookLabel(h.label)} ×{h.lift ?? "?"} <span className="font-normal opacity-70">n={h.n}</span></Badge>)}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <GroupCard title={t("performance.ctasTitle")} rows={p.ctas.map((c) => ({ key: c.label, label: ctaLabel(c.label), n: c.n, medianScore: c.medianScore, lift: c.lift }))} unit={unit} empty={t("performance.ctasEmpty")} footer={t("performance.ctasFooter")} hint={t("performance.groupHint", { unit })} />
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4" /> {t("performance.refresh")}</CardTitle><CardDescription>{t("performance.refreshHint")}</CardDescription></CardHeader>
                <CardContent>
                  {p.refreshCandidates.length ? (
                    <ul className="space-y-1 text-[13px]">
                      {p.refreshCandidates.map((r) => <li key={r.id} className="line-clamp-1"><span className="tabular-nums text-muted-foreground">{r.date}</span> · {r.title === "(untitled)" ? t("common.untitled") : r.title} <span className="text-xs text-muted-foreground">({formatLabel(t, r.format) ?? "?"}, {r.score})</span></li>)}
                    </ul>
                  ) : <p className="text-[13px] text-muted-foreground">{t("performance.refreshEmpty")}</p>}
                  <p className="mt-3 text-xs text-muted-foreground">{t.rich("performance.refreshUse", { link: (c) => <Link className="text-primary hover:underline" href={`/p/${projectId}/history?tab=recommendations`}>{c}</Link> })}</p>
                </CardContent>
              </Card>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GroupCard({ title, rows, empty, footer, hint }: { title: string; rows: { key: string; label: string; n: number; medianScore: number | null; lift: number | null }[]; unit: string; empty: string; footer?: string; hint: string }) {
  const top = Math.max(...rows.map((r) => r.medianScore ?? 0), 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{hint}</CardDescription></CardHeader>
      <CardContent>
        {rows.length ? (
          <ul className="grid gap-2">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
                <span className="truncate">{r.label}</span>
                <span className="h-2 rounded-full bg-secondary"><span className="block h-2 rounded-full bg-chart-b" style={{ width: `${Math.max(2, ((r.medianScore ?? 0) / top) * 100)}%` }} /></span>
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">{r.medianScore} · ×{r.lift ?? "?"} <span className="text-xs">n={r.n}</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted-foreground">{empty}</p>}
        {footer ? <p className="mt-3 text-xs text-muted-foreground">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}
