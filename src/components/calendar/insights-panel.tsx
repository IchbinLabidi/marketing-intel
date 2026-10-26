import Link from "next/link";
import { Lightbulb, TrendingUp } from "lucide-react";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import type { PlatformTiming } from "@/lib/calendar/insights";
import type { PlatformPerformance } from "@/lib/history/performance";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./platform-icon";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" });

/** Historical timing and pillar performance next to the calendar. Every figure is calculated from synced metrics. */
export function InsightsPanel({ projectId, timing, performance, tz }: { projectId: string; timing: PlatformTiming[]; performance: PlatformPerformance[]; tz: string }) {
  if (!timing.length && !performance.length) {
    return (
      <aside className="rounded-xl border bg-card p-4 text-[13px] shadow-xs">
        <p className="flex items-center gap-2 font-medium"><Lightbulb className="size-4" /> Publishing insights</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect Meta in <Link className="text-primary hover:underline" href={`/p/${projectId}/history`}>Historical Intelligence</Link> to see your best days and times, based on your own posts.
        </p>
      </aside>
    );
  }
  const platforms = [...new Set([...timing.map((t) => t.platform), ...performance.map((p) => p.platform)])];
  return (
    <aside className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <div>
        <p className="flex items-center gap-2 text-[13px] font-semibold"><Lightbulb className="size-4" /> Publishing insights</p>
        <p className="text-[11px] text-muted-foreground">Calculated from your synced posts. Times in {tz}. Correlation, not a guarantee.</p>
      </div>
      {platforms.map((platform) => {
        const t = timing.find((x) => x.platform === platform);
        const perf = performance.find((p) => p.platform === platform);
        const unit = perf?.metric === "engagement_rate" ? "eng. rate" : "engagement";
        const topDays = t ? [...t.weekdays].filter((w) => w.lift != null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 3) : [];
        const trend = perf?.trend.filter((x) => x.median != null).slice(-6) ?? [];
        const trendMax = Math.max(1, ...trend.map((x) => x.median ?? 0));
        return (
          <section key={platform} className="space-y-2.5 border-t pt-3 first:border-t-0 first:pt-0">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <PlatformIcon platform={platform} /> {PLATFORM_LABELS[platform as Platform] ?? platform}
              {t ? <span className="text-xs font-normal text-muted-foreground">· {t.posts} posts with exact times</span> : null}
            </p>
            {!t ? (
              <p className="text-xs text-muted-foreground">
                Best days and times need exact publication times. Run “Refresh all metrics” in <Link className="text-primary hover:underline" href={`/p/${projectId}/history`}>Historical Intelligence</Link> to sync them.
              </p>
            ) : t.suggestions.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Suggested slots (interactions per post vs median)</p>
                <ul className="space-y-0.5 text-xs">
                  {t.suggestions.map((s) => <li key={s.label} className="flex justify-between gap-2"><span>{s.label}</span><span className="tabular-nums text-muted-foreground">×{s.lift} · n={s.n}</span></li>)}
                </ul>
              </div>
            ) : <p className="text-xs text-muted-foreground">No slot stands out yet (each needs 5+ posts and at least 1% of the history).</p>}
            {topDays.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Best days (interactions per post vs median)</p>
                <div className="flex flex-wrap gap-1">{topDays.map((d) => <span key={d.key} className="rounded border px-1.5 py-0.5 text-[11px]">{d.label.slice(0, 3)} ×{d.lift}</span>)}</div>
              </div>
            ) : null}
            {perf?.byPillar.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Pillars ({unit} vs median)</p>
                <ul className="space-y-0.5 text-xs">
                  {perf.byPillar.slice(0, 5).map((p) => (
                    <li key={p.key} className="flex justify-between gap-2">
                      <span className="truncate">{p.label}</span>
                      <span className={cn("tabular-nums", (p.lift ?? 1) >= 1.2 ? "text-success" : (p.lift ?? 1) <= 0.8 ? "text-warning" : "text-muted-foreground")}>×{p.lift ?? "?"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {trend.length >= 2 ? (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><TrendingUp className="size-3" /> Median {unit}, last {trend.length} months</p>
                <div className="flex h-10 items-end gap-1" role="img" aria-label={`Median ${unit} by month`}>
                  {trend.map((x) => (
                    <div key={x.month} className="flex flex-1 flex-col items-center gap-0.5" title={`${x.month}: ${x.median} (${x.n} posts)`}>
                      <div className="w-full rounded-t-[3px] bg-chart-b" style={{ height: `${((x.median ?? 0) / trendMax) * 32}px` }} />
                      <span className="text-[9px] text-muted-foreground">{monthLabel(x.month)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </aside>
  );
}
