import Link from "next/link";
import { ExternalLink, Info, Sparkles, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/app/empty-state";
import { ENGAGEMENT_FORMULA, type PlatformPerformance } from "@/lib/history/performance";
import { ValueColumns } from "./charts";
import { ClassifyPillarsButton } from "./classify-pillars-button";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en"));

export function PerformanceView({
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
  if (!performance.length) {
    return (
      <EmptyState
        icon={Trophy}
        title="No performance data yet"
        description="Performance needs at least 3 posts per platform with interaction counts. Connect Meta and run a synchronization, or import a file that includes metric columns."
      />
    );
  }
  return (
    <div className="space-y-8">
      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p>
            <Badge variant="secondary">Raw</Badge> numbers are exactly what Meta (or your file) returned. <Badge variant="default">Calculated</Badge> values are formulas on raw
            numbers: engagement = {ENGAGEMENT_FORMULA}; engagement rate = engagement ÷ reach. Platforms are ranked separately because their metrics aren’t comparable.
            Interpretations appear only in Recommendations, labelled as AI.
          </p>
          <p>Patterns in past posts show correlation, not cause. Groups need at least 3 posts; “×1.4” means 40% above that platform’s median.</p>
        </div>
      </div>

      {hasPillars && unassignedPillars > 0 && !readOnly ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <p>{unassignedPillars} posts have no content pillar, so they are missing from “by pillar”. {aiPillars ? `${aiPillars} were already assigned by AI.` : ""}</p>
          <ClassifyPillarsButton projectId={projectId} aiEnabled={aiEnabled} />
        </div>
      ) : null}

      {performance.map((p) => {
        const unit = p.metric === "engagement_rate" ? "% eng. rate" : "engagements";
        return (
          <section key={p.platform} className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{p.label}</h2>
                <p className="text-xs text-muted-foreground">
                  {p.posts} posts with metrics · ranked by {p.metric === "engagement_rate" ? "engagement rate (calculated, % of reach)" : "engagement (calculated; reach not available for most posts)"} · median {p.baseline}
                  {p.metric === "engagement_rate" ? "%" : ""}
                </p>
                {p.inconsistentReach ? (
                  <p className="text-xs text-warning">
                    {p.inconsistentReach} posts have a reach lower than their likes or saves (Meta returns incomplete reach for some older posts).
                    They are left out of rate-based rankings{p.metric === "engagement_rate" ? `, so ${p.ranked} of ${p.posts} posts are ranked` : ""}.
                  </p>
                ) : null}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Trophy className="size-4" /> Top-performing posts</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Post</th><th className="pr-3 font-medium">Format</th>
                      <th className="pr-2 text-right font-medium">Likes</th><th className="pr-2 text-right font-medium">Comments</th><th className="pr-2 text-right font-medium">Shares</th>
                      <th className="pr-2 text-right font-medium">Saves</th><th className="pr-2 text-right font-medium">Reach</th><th className="pr-3 text-right font-medium">Views</th>
                      <th className="pr-2 text-right font-medium">Engagement</th><th className="text-right font-medium">Rate</th>
                    </tr>
                    <tr className="border-b text-[10px] uppercase tracking-wide">
                      <th colSpan={2} /><th colSpan={6} className="pb-1 text-center font-normal">raw</th><th colSpan={2} className="pb-1 text-center font-normal">calculated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.top.map((t) => (
                      <tr key={t.id} className="border-b align-top last:border-0">
                        <td className="max-w-xs py-2 pr-3">
                          <p className="line-clamp-2">{t.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.date ?? "no date"}
                            {t.permalink ? <a className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline" href={t.permalink} target="_blank" rel="noreferrer">open <ExternalLink className="size-3" /></a> : null}
                          </p>
                        </td>
                        <td className="pr-3">{t.format ?? "—"}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.raw.likes)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.raw.comments)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.raw.shares)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.raw.saves)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.raw.reach)}</td>
                        <td className="pr-3 text-right tabular-nums">{n(t.raw.views)}</td>
                        <td className="pr-2 text-right tabular-nums">{n(t.engagement)}</td>
                        <td className="text-right tabular-nums">{t.rate != null ? `${t.rate}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Engagement trend</CardTitle>
                <CardDescription>Median {unit} per month (calculated). Months with a single post are left empty.</CardDescription>
              </CardHeader>
              <CardContent>
                <ValueColumns unit={unit} points={p.trend.map((t) => ({ key: t.month, label: monthLabel(t.month), value: t.median, n: t.n }))} />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <GroupCard title="By format" rows={p.byFormat} unit={unit} empty="Fewer than 3 posts per format." />
              <GroupCard
                title="By content pillar"
                rows={p.byPillar}
                unit={unit}
                empty={hasPillars ? "Too few posts linked to pillars. Assign pillars (Records, or with AI above)." : "Add content pillars in the strategy."}
                footer={hasPillars && aiPillars ? "Includes pillars assigned by AI (marked in Records)." : undefined}
              />
              <Card>
                <CardHeader><CardTitle>Topics</CardTitle><CardDescription>Words in titles and hooks used in ≥3 posts, by median score vs platform median (calculated).</CardDescription></CardHeader>
                <CardContent>
                  {p.topics.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.topics.map((t) => (
                        <Badge key={t.topic} variant={(t.lift ?? 0) >= 1.2 ? "success" : (t.lift ?? 1) <= 0.8 ? "warning" : "secondary"}>{t.topic} ×{t.lift} <span className="font-normal opacity-70">n={t.n}</span></Badge>
                      ))}
                    </div>
                  ) : <p className="text-[13px] text-muted-foreground">Not enough repeated words.</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Hooks</CardTitle><CardDescription>First line of the caption. Patterns are detected automatically (calculated).</CardDescription></CardHeader>
                <CardContent className="space-y-3 text-[13px]">
                  <ul className="space-y-1">
                    {p.hooks.top.slice(0, 5).map((h) => <li key={h.id} className="line-clamp-1">“{h.hook}” <span className="text-xs text-muted-foreground">· {h.score}</span></li>)}
                  </ul>
                  {p.hooks.patterns.length ? (
                    <div className="flex flex-wrap gap-1.5 border-t pt-2">
                      {p.hooks.patterns.map((h) => <Badge key={h.label} variant="outline">{h.label} ×{h.lift ?? "?"} <span className="font-normal opacity-70">n={h.n}</span></Badge>)}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <GroupCard title="Calls to action" rows={p.ctas.map((c) => ({ key: c.label, label: c.label, n: c.n, medianScore: c.medianScore, lift: c.lift }))} unit={unit} empty="No CTA type appears in 3+ posts." footer="CTA type is detected from caption wording (calculated)." />
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4" /> Refresh or repurpose</CardTitle><CardDescription>Posts older than 6 months in the top quarter of this platform (calculated).</CardDescription></CardHeader>
                <CardContent>
                  {p.refreshCandidates.length ? (
                    <ul className="space-y-1 text-[13px]">
                      {p.refreshCandidates.map((r) => <li key={r.id} className="line-clamp-1"><span className="tabular-nums text-muted-foreground">{r.date}</span> · {r.title} <span className="text-xs text-muted-foreground">({r.format ?? "?"}, {r.score})</span></li>)}
                    </ul>
                  ) : <p className="text-[13px] text-muted-foreground">None yet (needs 8+ posts and posts older than 6 months).</p>}
                  <p className="mt-3 text-xs text-muted-foreground">Use them in <Link className="text-primary hover:underline" href={`/p/${projectId}/history?tab=recommendations`}>Recommendations</Link> and the calendar generator.</p>
                </CardContent>
              </Card>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GroupCard({ title, rows, unit, empty, footer }: { title: string; rows: { key: string; label: string; n: number; medianScore: number | null; lift: number | null }[]; unit: string; empty: string; footer?: string }) {
  const top = Math.max(...rows.map((r) => r.medianScore ?? 0), 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>Median {unit} per group (calculated)</CardDescription></CardHeader>
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
