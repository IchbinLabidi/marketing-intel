import Link from "next/link";
import { AlertTriangle, CalendarClock, Copy, Info, Layers, RefreshCcw, Repeat, Shapes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOT_LINKED_SUFFIX, type CountRow, type HistoricalStats } from "@/lib/history/analysis";
import { formatLabel, platformLabel } from "@/lib/history/parse";
import { DELETED_PILLAR } from "@/lib/history/performance";
import type { TFor } from "@/i18n/messages";
import { getFormatter, getT } from "@/i18n/server";
import { BarList, MonthColumns, StatTile } from "./charts";

type ItemRef = { id: string; title: string; date: string | null };

const KIND: Record<string, { key: "nearDuplicate" | "refreshAngle" | "recurringTheme"; icon: typeof Copy; variant: "destructive" | "warning" | "secondary" }> = {
  near_duplicate: { key: "nearDuplicate", icon: Copy, variant: "destructive" },
  refresh_angle: { key: "refreshAngle", icon: RefreshCcw, variant: "warning" },
  recurring_theme: { key: "recurringTheme", icon: Repeat, variant: "secondary" },
};

/** Display label of an analysis row: the analysis keeps English fallbacks (they also feed the AI digest). */
function rowLabel(t: TFor<"history">, td: TFor<"domain">, kind: "platform" | "format" | "pillar", r: CountRow) {
  if (r.key === "__none") return t("common.notSpecified");
  if (kind === "platform") return platformLabel(td, r.key);
  if (kind === "format") return formatLabel(t, r.key);
  if (r.key.startsWith("raw:") && r.label.endsWith(NOT_LINKED_SUFFIX)) return t("overview.notLinked", { name: r.label.slice(0, -NOT_LINKED_SUFFIX.length) });
  return r.label === DELETED_PILLAR ? t("common.deletedPillar") : r.label;
}

export async function HistoryOverview({ stats, items, projectId }: { stats: HistoricalStats; items: Record<string, ItemRef>; projectId: string }) {
  const [t, td, fmt] = await Promise.all([getT("history"), getT("domain"), getFormatter()]);
  const fmtDate = (d: string | null) => (d ? fmt.day(d) : "?");
  const s = stats;
  const statusKnown = s.totals.items - s.totals.status.unknown;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("overview.importedItems")} value={s.totals.items} hint={t("overview.calendars", { count: s.totals.imports })} />
        <StatTile label={t("overview.periodCovered")} value={s.totals.start ? `${s.totals.start.slice(0, 7)} → ${s.totals.end?.slice(0, 7)}` : "—"} hint={s.totals.weeks ? t("overview.weeks", { count: s.totals.weeks }) : t("overview.noDatedItems")} />
        <StatTile label={t("overview.averageFrequency")} value={s.frequency.perWeek != null ? t("overview.perWeekValue", { value: s.frequency.perWeek }) : "—"} hint={t("overview.averageFrequencyHint")} />
        <StatTile
          label={t("overview.markedPublished")}
          value={statusKnown ? s.totals.status.published : "—"}
          hint={statusKnown ? t("overview.statusHint", { planned: s.totals.status.planned, unknown: s.totals.status.unknown }) : t("overview.noStatus")}
        />
      </div>

      <FactNote t={t} metrics={s.metrics.coverage.map((m) => td(`metric.${m.metric}`))} />

      <Card>
        <CardHeader>
          <CardTitle>{t("overview.postsPerMonth")}</CardTitle>
          <CardDescription>{t("overview.postsPerMonthHint")}</CardDescription>
        </CardHeader>
        <CardContent><MonthColumns months={s.byMonth} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("overview.platforms")}</CardTitle></CardHeader>
          <CardContent>
            <BarList rows={s.byPlatform.map((r) => ({ key: r.key, label: rowLabel(t, td, "platform", r), value: r.count, note: `${r.share}%` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("overview.formats")}</CardTitle><CardDescription>{t("overview.formatsHint")}</CardDescription></CardHeader>
          <CardContent>
            <BarList rows={s.byFormat.slice(0, 10).map((r) => ({ key: r.key, label: rowLabel(t, td, "format", r), value: r.count, note: `${r.share}%` }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Layers className="size-4" /> {t("overview.pillarsTitle")}</CardTitle>
          <CardDescription>
            {t("overview.pillarsHint")}{" "}
            {s.unlinkedPillarText ? t("overview.unlinkedPillars", { count: s.unlinkedPillarText }) : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {s.pillarBalance.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b"><th className="py-2 font-medium">{t("overview.columns.pillar")}</th><th className="text-right font-medium">{t("overview.columns.items")}</th><th className="text-right font-medium">{t("overview.columns.actual")}</th><th className="text-right font-medium">{t("overview.columns.target")}</th><th className="pl-4 font-medium">{t("overview.columns.status")}</th></tr>
                </thead>
                <tbody>
                  {s.pillarBalance.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2">{p.name}</td>
                      <td className="text-right tabular-nums">{p.count}</td>
                      <td className="text-right tabular-nums">{p.actual}%</td>
                      <td className="text-right tabular-nums text-muted-foreground">{p.target != null ? `${p.target}%` : "—"}</td>
                      <td className="pl-4"><PillarStatus t={t} status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {t.rich("overview.noPillars", { link: (c) => <Link className="text-primary underline-offset-4 hover:underline" href={`/p/${projectId}/strategy`}>{c}</Link> })}
            </p>
          )}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("overview.allPillarValues")}</p>
            <BarList rows={s.byPillar.slice(0, 12).map((r) => ({ key: r.key, label: rowLabel(t, td, "pillar", r), value: r.count, note: `${r.share}%` }))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> {t("overview.frequency")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px]">
            {s.frequency.platforms.length ? (
              <table className="w-full">
                <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="py-1.5 font-medium">{t("overview.columns.platform")}</th><th className="text-right font-medium">{t("overview.columns.actualPerWeek")}</th><th className="text-right font-medium">{t("overview.columns.targetPerWeek")}</th></tr></thead>
                <tbody>
                  {s.frequency.platforms.map((p) => (
                    <tr key={p.platform} className="border-b last:border-0">
                      <td className="py-1.5">{platformLabel(td, p.platform)}</td>
                      <td className="text-right tabular-nums">{p.perWeek ?? "—"}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{p.target ?? t("overview.notSet")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-muted-foreground">{t("overview.noPlatformInfo")}</p>}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("overview.lowMonths", { median: s.frequency.lowMonths[0]?.median ?? "—" })}</p>
              {s.frequency.lowMonths.length ? (
                <div className="flex flex-wrap gap-1">{s.frequency.lowMonths.map((m) => <Badge key={m.month} variant="warning">{t("overview.monthCount", { month: m.month, count: m.count })}</Badge>)}</div>
              ) : <p className="text-muted-foreground">{t("overview.none")}</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("overview.silences")}</p>
              {s.frequency.silentGaps.length ? (
                <ul className="space-y-0.5">{s.frequency.silentGaps.slice(0, 5).map((g) => <li key={g.from}>{fmtDate(g.from)} → {fmtDate(g.to)} <span className="text-muted-foreground">· {t("overview.days", { count: g.days })}</span></li>)}</ul>
              ) : <p className="text-muted-foreground">{t("overview.none")}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shapes className="size-4" /> {t("overview.formatGaps")}</CardTitle>
            <CardDescription>{t("overview.formatGapsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            {s.formatGaps.length ? s.formatGaps.map((g) => (
              <div key={g.platform}>
                <p className="font-medium">{platformLabel(td, g.platform)}</p>
                <div className="mt-1 flex flex-wrap gap-1">{g.missing.map((f) => <Badge key={f} variant="outline">{formatLabel(t, f)}</Badge>)}</div>
              </div>
            )) : <p className="text-muted-foreground">{t("overview.noFormatGaps")}</p>}
            <div className="border-t pt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("overview.missingInfo")}</p>
              <p className="text-xs text-muted-foreground">
                {t("overview.missingInfoDetail", { date: s.dataQuality.missingDate, platform: s.dataQuality.missingPlatform, format: s.dataQuality.missingFormat, pillar: s.dataQuality.missingPillar, status: s.dataQuality.missingStatus })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("overview.seasonality")}</CardTitle>
          <CardDescription>
            {t("overview.seasonalityHint")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b"><th className="py-2 font-medium">{t("overview.columns.period")}</th><th className="font-medium">{t("overview.columns.observedIn")}</th><th className="font-medium">{t("overview.columns.campaignsSeen")}</th><th className="font-medium">{t("overview.columns.pattern")}</th></tr>
              </thead>
              <tbody>
                {s.seasons.map((x) => (
                  <tr key={x.key} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">{t(`seasons.${x.key}`)}</td>
                    <td className="pr-3 text-xs">
                      {x.years.length ? x.years.map((y) => <div key={y.schoolYear} className="tabular-nums">{t("overview.seasonYear", { year: y.schoolYear, count: y.count, index: y.index })}</div>) : <span className="text-muted-foreground">{t("overview.notCovered")}</span>}
                    </td>
                    <td className="pr-3 text-xs text-muted-foreground">{[...new Set(x.years.flatMap((y) => y.campaigns))].join(", ") || "—"}</td>
                    <td><SeasonPattern t={t} pattern={x.pattern} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Repeat className="size-4" /> {t("overview.repetition")}</CardTitle>
          <CardDescription>{t("overview.repetitionHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {s.repetitions.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {s.repetitions.slice(0, 12).map((c, i) => {
                const k = KIND[c.kind];
                return (
                  <li key={i} className="rounded-lg border p-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={k.variant}><k.icon /> {t(`overview.kinds.${k.key}.label`)}</Badge>
                      <span className="text-xs text-muted-foreground">{t("overview.clusterItems", { count: c.ids.length })} · {c.spanDays != null ? t("overview.overDays", { count: c.spanDays }) : t("overview.undated")}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{t(`overview.kinds.${k.key}.text`)}</p>
                    <ul className="mt-2 space-y-0.5">
                      {c.ids.slice(0, 5).map((id) => (
                        <li key={id} className="truncate"><span className="tabular-nums text-muted-foreground">{items[id]?.date ?? t("common.noDate")}</span> · {items[id]?.title ?? t("overview.deleted")}</li>
                      ))}
                      {c.ids.length > 5 ? <li className="text-xs text-muted-foreground">{t("overview.more", { count: c.ids.length - 5 })}</li> : null}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-[13px] text-muted-foreground">{t("overview.noRepetition")}</p>}
          {s.campaignThemes.some((c) => c.recurring) ? (
            <div className="mt-4 border-t pt-3 text-[13px]">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("overview.campaignThemes")}</p>
              <div className="flex flex-wrap gap-1">{s.campaignThemes.filter((c) => c.recurring).map((c) => <Badge key={c.name} variant="secondary">{c.name} · {c.schoolYears.join(", ")}</Badge>)}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {s.metrics.byFormat.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.metricsByFormat")}</CardTitle>
            <CardDescription>{t("overview.metricsByFormatHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            {s.metrics.byFormat.map((m) => (
              <div key={m.metric}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t("overview.averagePerItem", { metric: td(`metric.${m.metric}`) })}</p>
                <BarList rows={m.rows.map((r) => ({ key: r.format, label: formatLabel(t, r.format), value: r.average, note: `n=${r.n}` }))} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FactNote({ t, metrics }: { t: TFor<"history">; metrics: string[] }) {
  return (
    <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>
        {t("overview.factNote")}{" "}
        {metrics.length
          ? t("overview.metricsFound", { metrics: metrics.join(", ") })
          : t("overview.noMetrics")}
      </p>
    </div>
  );
}

function PillarStatus({ t, status }: { t: TFor<"history">; status: string }) {
  const map: Record<string, [string, "destructive" | "warning" | "success" | "secondary" | "default"]> = {
    missing: [t("overview.pillarStatus.missing"), "destructive"], under: [t("overview.pillarStatus.under"), "warning"], over: [t("overview.pillarStatus.over"), "default"], balanced: [t("overview.pillarStatus.balanced"), "success"], no_target: [t("overview.pillarStatus.noTarget"), "secondary"],
  };
  const [label, variant] = map[status] ?? ["—", "secondary"];
  return <Badge variant={variant}>{status === "missing" || status === "under" ? <AlertTriangle /> : null}{label}</Badge>;
}

function SeasonPattern({ t, pattern }: { t: TFor<"history">; pattern: string }) {
  if (pattern === "peak") return <Badge variant="default">{t("overview.pattern.peak")}</Badge>;
  if (pattern === "quiet") return <Badge variant="warning">{t("overview.pattern.quiet")}</Badge>;
  if (pattern === "normal") return <Badge variant="secondary">{t("overview.pattern.normal")}</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}
