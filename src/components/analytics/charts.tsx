import { cn } from "@/lib/utils";

/** Share of total vs. target: a bar for the actual share and a tick for the target, with the numbers written out. */
export function ShareBars({
  rows, empty = "No data in this period.",
}: {
  rows: { key: string; label: string; count: number; share: number; target: number | null; status: "under" | "over" | "on" | "no-target" }[];
  empty?: string;
}) {
  if (!rows.some((r) => r.count) && !rows.some((r) => r.target != null)) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="relative h-2 rounded-full bg-secondary">
            <span className={cn("block h-2 rounded-full", r.status === "under" ? "bg-warning" : "bg-chart-b")} style={{ width: `${Math.min(100, r.share)}%` }} />
            {r.target != null ? <span className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/70" style={{ left: `calc(${Math.min(100, r.target)}% - 1px)` }} aria-hidden /> : null}
          </span>
          <span className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{r.share.toFixed(0)}%</span> · {r.count}
            {r.target != null ? <span className="ml-1 text-xs">(target {r.target}%)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Grouped weekly columns (one colour per series) with a hover tooltip and a table fallback. */
export function WeeklyColumns({
  weeks, series,
}: {
  weeks: ({ week: string } & Record<string, number | string>)[];
  series: { key: string; label: string; className: string }[];
}) {
  if (!weeks.length) return <p className="text-[13px] text-muted-foreground">No weeks in this period.</p>;
  const top = Math.max(1, ...weeks.flatMap((w) => series.map((s) => Number(w[s.key]) || 0)));
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const every = Math.ceil(weeks.length / 10);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", s.className)} /> {s.label}</span>)}
      </div>
      <div className="flex h-36 items-end gap-1.5 border-b border-border/70" role="img" aria-label={`Per week: ${series.map((s) => s.label).join(", ")}`}>
        {weeks.map((w) => (
          <div key={w.week} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-px">
            {series.map((s) => (
              <div key={s.key} className={cn("w-full max-w-3 rounded-t-[3px]", s.className)} style={{ height: `${((Number(w[s.key]) || 0) / top) * 100}%` }} />
            ))}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md group-hover:block">
              <p className="font-medium">Week of {label(w.week)}</p>
              {series.map((s) => <p key={s.key} className="tabular-nums text-muted-foreground">{s.label}: {w[s.key]}</p>)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {weeks.map((w, i) => <span key={w.week} className="flex min-w-0 flex-1 justify-center whitespace-nowrap text-[10px] text-muted-foreground">{i % every === 0 ? label(w.week) : ""}</span>)}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full max-w-md tabular-nums">
          <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Week of</th>{series.map((s) => <th key={s.key} className="text-right font-medium">{s.label}</th>)}</tr></thead>
          <tbody>{weeks.map((w) => <tr key={w.week}><td>{w.week}</td>{series.map((s) => <td key={s.key} className="text-right">{w[s.key]}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
