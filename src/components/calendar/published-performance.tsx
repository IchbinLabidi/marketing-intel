"use client";

import * as React from "react";
import { publishedPerformanceAction, type PublishedPerformance } from "@/server/actions/social";
import { useFormatter, useT } from "@/i18n/client";

/** Actual results of a published item, read from the synced post it was verified against. */
export function PublishedPerformanceBlock({ projectId, itemId }: { projectId: string; itemId: string }) {
  const t = useT("calendar");
  const fmt = useFormatter();
  const [data, setData] = React.useState<PublishedPerformance | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    publishedPerformanceAction(projectId, itemId).then((r) => alive && setData(r.ok ? r.data ?? null : null));
    return () => { alive = false; };
  }, [projectId, itemId]);
  if (data === undefined) return <div className="h-16 animate-pulse rounded-lg bg-muted" aria-label={t("performance.loading")} />;
  if (!data) return null;
  const shown = data.metrics.filter((m) => m.value != null);
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">{t("performance.title")}</h3>
      {shown.length ? (
        <dl className="grid grid-cols-3 gap-2">
          {shown.map((m) => (
            <div key={m.label} className="rounded-lg border px-2.5 py-1.5">
              <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
              <dd className="text-[14px] font-semibold tabular-nums">{fmt.number(m.value!)}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="text-[13px] text-muted-foreground">{t("performance.noMetrics")}</p>}
      <p className="text-xs text-muted-foreground">
        {data.published_at ? t("performance.publishedAt", { date: fmt.dateTime(data.published_at) }) : ""}
        {data.metrics_updated_at ? t("performance.figuresFrom", { date: fmt.dateTime(data.metrics_updated_at) }) : ""}
        {t("performance.notListed")}
        {data.permalink ? <> <a href={data.permalink} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{t("performance.viewPost")}</a></> : null}
      </p>
    </section>
  );
}
