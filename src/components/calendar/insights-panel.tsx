import type { ReactNode } from "react";
import Link from "next/link";
import { Lightbulb, TrendingUp } from "lucide-react";
import { windowLabel, type PlatformTiming } from "@/lib/calendar/insights";
import { weekdayLabel } from "@/lib/calendar/time";
import { getFormatter, getT } from "@/i18n/server";
import type { PlatformPerformance } from "@/lib/history/performance";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "./platform-icon";
import { domainLabel } from "./planning";


/** Historical timing and pillar performance next to the calendar. Every figure is calculated from synced metrics. */
export async function InsightsPanel({ projectId, timing, performance, tz }: { projectId: string; timing: PlatformTiming[]; performance: PlatformPerformance[]; tz: string }) {
  const [t, td, fmt] = await Promise.all([getT("calendar"), getT("domain"), getFormatter()]);
  const monthLabel = (m: string) => fmt.day(`${m}-01`, { month: "short" });
  const historyLink = (c: ReactNode) => <Link className="text-primary hover:underline" href={`/p/${projectId}/history`}>{c}</Link>;
  if (!timing.length && !performance.length) {
    return (
      <aside className="rounded-xl border bg-card p-4 text-[13px] shadow-xs">
        <p className="flex items-center gap-2 font-medium"><Lightbulb className="size-4" /> {t("insights.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.rich("insights.empty", { link: historyLink })}
        </p>
      </aside>
    );
  }
  const platforms = [...new Set([...timing.map((x) => x.platform), ...performance.map((p) => p.platform)])];
  return (
    <aside className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <div>
        <p className="flex items-center gap-2 text-[13px] font-semibold"><Lightbulb className="size-4" /> {t("insights.title")}</p>
        <p className="text-[11px] text-muted-foreground">{t("insights.intro", { tz })}</p>
      </div>
      {platforms.map((platform) => {
        const tm = timing.find((x) => x.platform === platform);
        const perf = performance.find((p) => p.platform === platform);
        const unit = perf?.metric === "engagement_rate" ? t("insights.unitRate") : t("insights.unitEngagement");
        const topDays = tm ? [...tm.weekdays].filter((w) => w.lift != null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 3) : [];
        const trend = perf?.trend.filter((x) => x.median != null).slice(-6) ?? [];
        const trendMax = Math.max(1, ...trend.map((x) => x.median ?? 0));
        return (
          <section key={platform} className="space-y-2.5 border-t pt-3 first:border-t-0 first:pt-0">
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <PlatformIcon platform={platform} /> {domainLabel(td, "platform", platform)}
              {tm ? <span className="text-xs font-normal text-muted-foreground">{t("insights.exactTimes", { count: tm.posts })}</span> : null}
            </p>
            {!tm ? (
              <p className="text-xs text-muted-foreground">
                {t.rich("insights.needTimes", { link: historyLink })}
              </p>
            ) : tm.suggestions.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("insights.suggested")}</p>
                <ul className="space-y-0.5 text-xs">
                  {tm.suggestions.map((s) => <li key={s.label} className="flex justify-between gap-2"><span>{t("insights.slot", { day: weekdayLabel(fmt, s.weekday), window: windowLabel(s.window) })}</span><span className="tabular-nums text-muted-foreground">×{s.lift != null ? fmt.number(s.lift) : s.lift} · n={s.n}</span></li>)}
                </ul>
              </div>
            ) : <p className="text-xs text-muted-foreground">{t("insights.noSlot")}</p>}
            {topDays.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("insights.bestDays")}</p>
                <div className="flex flex-wrap gap-1">{topDays.map((d) => <span key={d.key} className="rounded border px-1.5 py-0.5 text-[11px]">{weekdayLabel(fmt, Number(d.key), "short")} ×{d.lift != null ? fmt.number(d.lift) : d.lift}</span>)}</div>
              </div>
            ) : null}
            {perf?.byPillar.length ? (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("insights.pillars", { unit })}</p>
                <ul className="space-y-0.5 text-xs">
                  {perf.byPillar.slice(0, 5).map((p) => (
                    <li key={p.key} className="flex justify-between gap-2">
                      <span className="truncate">{p.label}</span>
                      <span className={cn("tabular-nums", (p.lift ?? 1) >= 1.2 ? "text-success" : (p.lift ?? 1) <= 0.8 ? "text-warning" : "text-muted-foreground")}>×{p.lift != null ? fmt.number(p.lift) : "?"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {trend.length >= 2 ? (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><TrendingUp className="size-3" /> {t("insights.trend", { unit, count: trend.length })}</p>
                <div className="flex h-10 items-end gap-1" role="img" aria-label={t("insights.trendAria", { unit })}>
                  {trend.map((x) => (
                    <div key={x.month} className="flex flex-1 flex-col items-center gap-0.5" title={t("insights.trendBar", { month: x.month, median: x.median, count: x.n })}>
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
