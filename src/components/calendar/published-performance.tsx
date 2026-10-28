"use client";

import * as React from "react";
import { publishedPerformanceAction, type PublishedPerformance } from "@/server/actions/social";
import { formatDateTime } from "@/lib/format";

/** Actual results of a published item, read from the synced post it was verified against. */
export function PublishedPerformanceBlock({ projectId, itemId }: { projectId: string; itemId: string }) {
  const [data, setData] = React.useState<PublishedPerformance | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    publishedPerformanceAction(projectId, itemId).then((r) => alive && setData(r.ok ? r.data ?? null : null));
    return () => { alive = false; };
  }, [projectId, itemId]);
  if (data === undefined) return <div className="h-16 animate-pulse rounded-lg bg-muted" aria-label="Loading results" />;
  if (!data) return null;
  const shown = data.metrics.filter((m) => m.value != null);
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">Results on the platform</h3>
      {shown.length ? (
        <dl className="grid grid-cols-3 gap-2">
          {shown.map((m) => (
            <div key={m.label} className="rounded-lg border px-2.5 py-1.5">
              <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
              <dd className="text-[14px] font-semibold tabular-nums">{m.value!.toLocaleString("en")}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="text-[13px] text-muted-foreground">The platform hasn&apos;t returned metrics for this post yet.</p>}
      <p className="text-xs text-muted-foreground">
        {data.published_at ? `Published ${formatDateTime(data.published_at)}. ` : ""}
        {data.metrics_updated_at ? `Figures from the sync of ${formatDateTime(data.metrics_updated_at)}. ` : ""}
        Metrics not listed aren&apos;t provided for this post type.
        {data.permalink ? <> <a href={data.permalink} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">View post</a></> : null}
      </p>
    </section>
  );
}
