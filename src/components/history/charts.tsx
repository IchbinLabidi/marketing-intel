import { Stat } from "@/components/app/stat";
import { cn } from "@/lib/utils";

/**
 * Horizontal bar list: one series, every bar directly labelled with its value (doubles as the table view).
 * Thin bars, rounded data-end, recessive track.
 */
export function BarList({
  rows,
  max,
  empty = "No data",
  valueSuffix,
}: {
  rows: { key: string; label: React.ReactNode; value: number; note?: string }[];
  max?: number;
  empty?: string;
  valueSuffix?: (row: { value: number }) => string;
}) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate" title={typeof r.label === "string" ? r.label : undefined}>{r.label}</span>
          <span className="h-2 rounded-full bg-secondary">
            <span className="block h-2 rounded-full bg-chart-b" style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} />
          </span>
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {valueSuffix ? valueSuffix(r) : r.value}
            {r.note ? <span className="ml-1 text-xs">{r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Monthly volume as columns, with a hover tooltip per month and a table fallback below. */
export function MonthColumns({ months }: { months: { month: string; count: number; published: number }[] }) {
  if (!months.length) return <p className="text-[13px] text-muted-foreground">No dated items.</p>;
  const top = Math.max(...months.map((m) => m.count), 1);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
  const every = Math.ceil(months.length / 12);
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5 border-b border-border/70" role="img" aria-label="Posts per month">
        {months.map((m) => (
          <div key={m.month} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
            <div
              className={cn("w-full max-w-6 rounded-t-[4px] bg-chart-b transition-opacity group-hover:opacity-80", m.count === 0 && "bg-transparent")}
              style={{ height: `${(m.count / top) * 100}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md group-hover:block">
              <p className="font-medium">{label(m.month)}</p>
              <p className="tabular-nums text-muted-foreground">{m.count} items · {m.published} marked published</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {months.map((m, i) => (
          <span key={m.month} className="flex min-w-0 flex-1 justify-center whitespace-nowrap text-[10px] text-muted-foreground">
            {i % every === 0 ? label(m.month) : ""}
          </span>
        ))}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full max-w-sm tabular-nums">
          <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Month</th><th className="text-right font-medium">Items</th><th className="text-right font-medium">Marked published</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="text-right">{m.count}</td><td className="text-right">{m.published}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** Single-series value columns (e.g. monthly median engagement) with hover tooltip; null months are gaps. */
export function ValueColumns({ points, unit }: { points: { key: string; label: string; value: number | null; n: number }[]; unit: string }) {
  const values = points.map((p) => p.value ?? 0);
  const top = Math.max(...values, 0) || 1;
  const every = Math.ceil(points.length / 12);
  if (!points.length) return <p className="text-[13px] text-muted-foreground">Not enough dated posts with metrics.</p>;
  return (
    <div>
      <div className="flex h-32 items-end gap-0.5 border-b border-border/70" role="img" aria-label={`Median ${unit} per month`}>
        {points.map((p) => (
          <div key={p.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
            <div className={cn("w-full max-w-6 rounded-t-[4px] bg-chart-b group-hover:opacity-80", p.value == null && "bg-transparent")} style={{ height: `${((p.value ?? 0) / top) * 100}%` }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md group-hover:block">
              <p className="font-medium">{p.label}</p>
              <p className="tabular-nums text-muted-foreground">{p.value == null ? `only ${p.n} post` : `median ${p.value} ${unit} · ${p.n} posts`}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {points.map((p, i) => (
          <span key={p.key} className="flex min-w-0 flex-1 justify-center whitespace-nowrap text-[10px] text-muted-foreground">{i % every === 0 ? p.label : ""}</span>
        ))}
      </div>
    </div>
  );
}

/** Two-period comparison bars (A = earlier/first period, B = second), always shown with the numbers. */
export function PairedBar({ a, b, max }: { a: number; b: number; max: number }) {
  const w = (v: number) => `${max ? Math.max(v ? 2 : 0, (v / max) * 100) : 0}%`;
  return (
    <div className="grid gap-0.5">
      <span className="h-1.5 rounded-full bg-secondary"><span className="block h-1.5 rounded-full bg-chart-a" style={{ width: w(a) }} /></span>
      <span className="h-1.5 rounded-full bg-secondary"><span className="block h-1.5 rounded-full bg-chart-b" style={{ width: w(b) }} /></span>
    </div>
  );
}

export function Legend({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-a" /> A · {a}</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-b" /> B · {b}</span>
    </div>
  );
}

/** Kept for existing call sites; renders the shared Stat. */
export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <Stat label={label} value={value} hint={hint} />;
}
