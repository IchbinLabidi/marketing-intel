import Link from "next/link";
import { AlertTriangle, CalendarClock, Copy, Info, Layers, RefreshCcw, Repeat, Shapes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { METRIC_LABELS } from "@/lib/domain/constants";
import type { HistoricalStats } from "@/lib/history/analysis";
import { BarList, MonthColumns, StatTile } from "./charts";

type ItemRef = { id: string; title: string; date: string | null };

const KIND: Record<string, { label: string; icon: typeof Copy; variant: "destructive" | "warning" | "secondary"; text: string }> = {
  near_duplicate: { label: "Near-duplicate", icon: Copy, variant: "destructive", text: "Almost the same content published close together." },
  refresh_angle: { label: "Needs a fresh angle", icon: RefreshCcw, variant: "warning", text: "Same subject and format keeps coming back." },
  recurring_theme: { label: "Recurring theme", icon: Repeat, variant: "secondary", text: "Evergreen subject spread over time. Usually fine; listed for context." },
};

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "?");

export function HistoryOverview({ stats, items, projectId }: { stats: HistoricalStats; items: Record<string, ItemRef>; projectId: string }) {
  const s = stats;
  const statusKnown = s.totals.items - s.totals.status.unknown;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Imported items" value={s.totals.items} hint={`${s.totals.imports} calendar${s.totals.imports === 1 ? "" : "s"}`} />
        <StatTile label="Period covered" value={s.totals.start ? `${s.totals.start.slice(0, 7)} → ${s.totals.end?.slice(0, 7)}` : "—"} hint={s.totals.weeks ? `${s.totals.weeks} weeks` : "no dated items"} />
        <StatTile label="Average frequency" value={s.frequency.perWeek != null ? `${s.frequency.perWeek}/week` : "—"} hint="dated items, all platforms" />
        <StatTile
          label="Marked published in the files"
          value={statusKnown ? s.totals.status.published : "—"}
          hint={statusKnown ? `${s.totals.status.planned} planned · ${s.totals.status.unknown} without status` : "the files record no status"}
        />
      </div>

      <FactNote metrics={s.metrics.coverage.map((m) => METRIC_LABELS[m.metric])} />

      <Card>
        <CardHeader>
          <CardTitle>Posts per month</CardTitle>
          <CardDescription>Uses the actual publication date when the file has one, otherwise the planned date.</CardDescription>
        </CardHeader>
        <CardContent><MonthColumns months={s.byMonth} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Platforms</CardTitle></CardHeader>
          <CardContent>
            <BarList rows={s.byPlatform.map((r) => ({ key: r.key, label: r.label, value: r.count, note: `${r.share}%` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Formats</CardTitle><CardDescription>Format names are grouped (e.g. “Reel”, “Short” → Short video).</CardDescription></CardHeader>
          <CardContent>
            <BarList rows={s.byFormat.slice(0, 10).map((r) => ({ key: r.key, label: r.label, value: r.count, note: `${r.share}%` }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Layers className="size-4" /> Content pillars vs strategy</CardTitle>
          <CardDescription>
            Shares are computed on items linked to a strategy pillar.{" "}
            {s.unlinkedPillarText ? `${s.unlinkedPillarText} item(s) have pillar text that doesn't match the strategy: edit them in Records to link them.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {s.pillarBalance.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b"><th className="py-2 font-medium">Pillar</th><th className="text-right font-medium">Items</th><th className="text-right font-medium">Actual</th><th className="text-right font-medium">Target</th><th className="pl-4 font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {s.pillarBalance.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2">{p.name}</td>
                      <td className="text-right tabular-nums">{p.count}</td>
                      <td className="text-right tabular-nums">{p.actual}%</td>
                      <td className="text-right tabular-nums text-muted-foreground">{p.target != null ? `${p.target}%` : "—"}</td>
                      <td className="pl-4"><PillarStatus status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No content pillars in the strategy yet. <Link className="text-primary underline-offset-4 hover:underline" href={`/p/${projectId}/strategy`}>Add pillars</Link> to compare history against your targets.
            </p>
          )}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">All pillar values found in the files</p>
            <BarList rows={s.byPillar.slice(0, 12).map((r) => ({ key: r.key, label: r.label, value: r.count, note: `${r.share}%` }))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> Publication frequency</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px]">
            {s.frequency.platforms.length ? (
              <table className="w-full">
                <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="py-1.5 font-medium">Platform</th><th className="text-right font-medium">Actual / week</th><th className="text-right font-medium">Target / week</th></tr></thead>
                <tbody>
                  {s.frequency.platforms.map((p) => (
                    <tr key={p.platform} className="border-b last:border-0">
                      <td className="py-1.5">{p.label}</td>
                      <td className="text-right tabular-nums">{p.perWeek ?? "—"}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{p.target ?? "not set"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-muted-foreground">No platform information.</p>}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Low-activity months (≤ half the median of {s.frequency.lowMonths[0]?.median ?? "—"})</p>
              {s.frequency.lowMonths.length ? (
                <div className="flex flex-wrap gap-1">{s.frequency.lowMonths.map((m) => <Badge key={m.month} variant="warning">{m.month}: {m.count}</Badge>)}</div>
              ) : <p className="text-muted-foreground">None.</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Longest silences (21+ days without a dated item)</p>
              {s.frequency.silentGaps.length ? (
                <ul className="space-y-0.5">{s.frequency.silentGaps.slice(0, 5).map((g) => <li key={g.from}>{fmtDate(g.from)} → {fmtDate(g.to)} <span className="text-muted-foreground">· {g.days} days</span></li>)}</ul>
              ) : <p className="text-muted-foreground">None.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shapes className="size-4" /> Formats not used yet</CardTitle>
            <CardDescription>Formats each active platform supports that never appear in the history. A prompt to test, not a judgement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            {s.formatGaps.length ? s.formatGaps.map((g) => (
              <div key={g.platform}>
                <p className="font-medium">{g.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">{g.missing.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}</div>
              </div>
            )) : <p className="text-muted-foreground">Every expected format appears at least once.</p>}
            <div className="border-t pt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Missing information in the files</p>
              <p className="text-xs text-muted-foreground">
                {s.dataQuality.missingDate} without date · {s.dataQuality.missingPlatform} without platform · {s.dataQuality.missingFormat} without format · {s.dataQuality.missingPillar} without pillar · {s.dataQuality.missingStatus} without status
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seasonality</CardTitle>
          <CardDescription>
            Posting rate inside each recurring period compared to the average (×1.0). Only periods fully covered by the imported dates are measured.
            School dates follow the Tunisian school year and are approximate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b"><th className="py-2 font-medium">Period</th><th className="font-medium">Observed in</th><th className="font-medium">Campaigns seen</th><th className="font-medium">Pattern</th></tr>
              </thead>
              <tbody>
                {s.seasons.map((x) => (
                  <tr key={x.key} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">{x.label}</td>
                    <td className="pr-3 text-xs">
                      {x.years.length ? x.years.map((y) => <div key={y.schoolYear} className="tabular-nums">{y.schoolYear}: {y.count} items · ×{y.index}</div>) : <span className="text-muted-foreground">not covered by the data</span>}
                    </td>
                    <td className="pr-3 text-xs text-muted-foreground">{[...new Set(x.years.flatMap((y) => y.campaigns))].join(", ") || "—"}</td>
                    <td><SeasonPattern pattern={x.pattern} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Repeat className="size-4" /> Repetition</CardTitle>
          <CardDescription>Items whose titles or topics share most of their key words. Recurring educational topics are expected; the flags point at repeated angles.</CardDescription>
        </CardHeader>
        <CardContent>
          {s.repetitions.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {s.repetitions.slice(0, 12).map((c, i) => {
                const k = KIND[c.kind];
                return (
                  <li key={i} className="rounded-lg border p-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={k.variant}><k.icon /> {k.label}</Badge>
                      <span className="text-xs text-muted-foreground">{c.ids.length} items · {c.spanDays != null ? `over ${c.spanDays} days` : "undated"}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{k.text}</p>
                    <ul className="mt-2 space-y-0.5">
                      {c.ids.slice(0, 5).map((id) => (
                        <li key={id} className="truncate"><span className="tabular-nums text-muted-foreground">{items[id]?.date ?? "no date"}</span> · {items[id]?.title ?? "(deleted)"}</li>
                      ))}
                      {c.ids.length > 5 ? <li className="text-xs text-muted-foreground">+{c.ids.length - 5} more</li> : null}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-[13px] text-muted-foreground">No repeated titles or topics detected.</p>}
          {s.campaignThemes.some((c) => c.recurring) ? (
            <div className="mt-4 border-t pt-3 text-[13px]">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Campaign themes repeated across school years</p>
              <div className="flex flex-wrap gap-1">{s.campaignThemes.filter((c) => c.recurring).map((c) => <Badge key={c.name} variant="secondary">{c.name} · {c.schoolYears.join(", ")}</Badge>)}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {s.metrics.byFormat.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Imported performance by format</CardTitle>
            <CardDescription>Averages of the metrics present in your files (formats with at least 3 values). Not available metrics are not estimated.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            {s.metrics.byFormat.map((m) => (
              <div key={m.metric}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{METRIC_LABELS[m.metric]} · average per item</p>
                <BarList rows={m.rows.map((r) => ({ key: r.format, label: r.format, value: r.average, note: `n=${r.n}` }))} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function FactNote({ metrics }: { metrics: string[] }) {
  return (
    <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>
        Everything on this page is computed from the imported rows; nothing is estimated. Status is shown as written in the files: planned items are not counted as published.{" "}
        {metrics.length
          ? `Performance metrics found: ${metrics.join(", ")}.`
          : "No performance metrics (reach, engagement, clicks, leads…) were imported, so no statement about what performed well can be made. Add metric columns to your files to unlock it."}
      </p>
    </div>
  );
}

function PillarStatus({ status }: { status: string }) {
  const map: Record<string, [string, "destructive" | "warning" | "success" | "secondary" | "default"]> = {
    missing: ["Not covered", "destructive"], under: ["Under target", "warning"], over: ["Over target", "default"], balanced: ["On target", "success"], no_target: ["No target set", "secondary"],
  };
  const [label, variant] = map[status] ?? ["—", "secondary"];
  return <Badge variant={variant}>{status === "missing" || status === "under" ? <AlertTriangle /> : null}{label}</Badge>;
}

function SeasonPattern({ pattern }: { pattern: string }) {
  if (pattern === "peak") return <Badge variant="default">Activity peak</Badge>;
  if (pattern === "quiet") return <Badge variant="warning">Quiet period</Badge>;
  if (pattern === "normal") return <Badge variant="secondary">Normal</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}
