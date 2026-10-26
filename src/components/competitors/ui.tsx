import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Settings2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; cls: string; help: string }> = {
  pending: { label: "Not collected yet", icon: CircleDashed, cls: "text-muted-foreground", help: "Waiting for the first collection." },
  never: { label: "Not collected yet", icon: CircleDashed, cls: "text-muted-foreground", help: "Waiting for the first collection." },
  synchronizing: { label: "Synchronizing", icon: Loader2, cls: "text-primary", help: "Collecting public posts now." },
  synchronized: { label: "Synchronized", icon: CheckCircle2, cls: "text-success", help: "All requested posts were collected." },
  partial: { label: "Partially synchronized", icon: AlertTriangle, cls: "text-warning", help: "Collected, with limits (max posts, hidden metrics or a profile that failed)." },
  failed: { label: "Failed", icon: XCircle, cls: "text-destructive", help: "The last collection failed." },
  needs_config: { label: "Requires configuration", icon: Settings2, cls: "text-warning", help: "A connection, key or permission is missing." },
  unsupported: { label: "Manual only", icon: Settings2, cls: "text-muted-foreground", help: "No official data source for this platform: add posts manually." },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", s.cls, className)} title={s.help}>
      <s.icon className={cn("size-3.5", status === "synchronizing" && "animate-spin")} /> {s.label}
    </span>
  );
}

export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 100) / 100);

export const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = (Date.now() - Date.parse(iso)) / 60000;
  return m < 2 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Horizontal bars; `value` drives the width, `right` is the printed value. */
export function Bars({ rows, max, tone = "bg-chart-b", empty = "Not enough data" }: { rows: { label: string; value: number; right?: string; hint?: string }[]; max?: number; tone?: string; empty?: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" title={r.hint}>
          <span className="truncate" dir="auto">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></span>
          <span className="tabular-nums text-muted-foreground">{r.right ?? fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Basis({ basis }: { basis: "fact" | "hypothesis" }) {
  return basis === "fact"
    ? <span className="rounded bg-success/12 px-1.5 py-0.5 text-[10px] font-medium text-success" title="Shown by the collected data">Observed</span>
    : <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="AI interpretation, not proven by the data">Hypothesis</span>;
}

export function MetricLegend() {
  return (
    <p className="text-[11px] text-muted-foreground">
      <b className="font-medium text-foreground">Public</b> = as published by the platform · <b className="font-medium text-foreground">Calculated</b> = engagement (likes + comments + shares + saves available), rate per follower, lift (÷ the account’s own median) · <b className="font-medium text-foreground">—</b> = not available from the source. Nothing is estimated.
    </p>
  );
}
