import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Settings2, XCircle } from "lucide-react";
import { useFormatter, useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

type StatusKey = "pending" | "never" | "synchronizing" | "synchronized" | "partial" | "failed" | "needs_config" | "unsupported";
export const STATUS: Record<StatusKey, { icon: typeof CheckCircle2; cls: string }> = {
  pending: { icon: CircleDashed, cls: "text-muted-foreground" },
  never: { icon: CircleDashed, cls: "text-muted-foreground" },
  synchronizing: { icon: Loader2, cls: "text-primary" },
  synchronized: { icon: CheckCircle2, cls: "text-success" },
  partial: { icon: AlertTriangle, cls: "text-warning" },
  failed: { icon: XCircle, cls: "text-destructive" },
  needs_config: { icon: Settings2, cls: "text-warning" },
  unsupported: { icon: Settings2, cls: "text-muted-foreground" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useT("competitors");
  const key: StatusKey = status in STATUS ? (status as StatusKey) : "pending";
  const s = STATUS[key];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", s.cls, className)} title={t(`status.${key}.help`)}>
      <s.icon className={cn("size-3.5", status === "synchronizing" && "animate-spin")} /> {t(`status.${key}.label`)}
    </span>
  );
}

/** Short number in the viewer's language: "1.2k", "35k", "2.4M" ("1,2k" in French). */
export function compactNumber(n: number | null | undefined, intl = "en") {
  if (n == null) return "—";
  const f = (v: number, digits: number) => new Intl.NumberFormat(intl, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(v);
  if (n >= 1_000_000) return `${f(n / 1_000_000, n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${f(n / 1000, 1)}k`;
  return new Intl.NumberFormat(intl, { maximumFractionDigits: 2, useGrouping: false }).format(Math.round(n * 100) / 100);
}

/** Locale-aware helpers shared by the competitor screens: short numbers and "5 min ago" style times. */
export function useStatsFormat() {
  const t = useT("competitors");
  const fmt = useFormatter();
  const num = (n: number | null | undefined) => compactNumber(n, fmt.intl);
  const ago = (iso: string | null) => {
    if (!iso) return t("ago.never");
    const m = (Date.now() - Date.parse(iso)) / 60000;
    return m < 2 ? t("ago.justNow") : m < 60 ? t("ago.minutes", { count: Math.round(m) }) : m < 48 * 60 ? t("ago.hours", { count: Math.round(m / 60) }) : t("ago.days", { count: Math.round(m / 1440) });
  };
  return { num, ago, t, fmt };
}

const LABEL_KEYS = {
  format: { "Short video": "shortVideo", Carousel: "carousel", Story: "story", Live: "live", Video: "video", Infographic: "infographic", "Poll / quiz": "poll", Article: "article", Newsletter: "newsletter", "Image post": "imagePost", "Text post": "textPost" },
  hook: { Question: "question", "Number / list": "number", "Starts with an emoji": "emoji", "How / why": "howWhy", "Direct address (tu / vous / you)": "direct" },
  cta: { "Link / bio": "link", "Sign up / book": "signUp", Comment: "comment", "Message / DM": "message", "Share / tag": "share", Save: "save", "No CTA detected": "none" },
} as const;

/** Labels computed in English by the shared analytics (formats, hook and CTA patterns), shown in the viewer's language. */
export function useGroupLabel() {
  const t = useT("competitors");
  return (kind: keyof typeof LABEL_KEYS, label: string) => {
    const key = (LABEL_KEYS[kind] as Record<string, string>)[label];
    return key ? t(`labels.${kind}.${key}` as Parameters<typeof t>[0]) : label;
  };
}

/** Weekday name from its number (0 = Sunday), in the viewer's language. */
export function useWeekday() {
  const fmt = useFormatter();
  return (day: number | string) => fmt.date(Date.UTC(2023, 0, 1 + Number(day)), { weekday: "long", timeZone: "UTC" });
}

/** Horizontal bars; `value` drives the width, `right` is the printed value. */
export function Bars({ rows, max, tone = "bg-chart-b", empty }: { rows: { label: string; value: number; right?: string; hint?: string }[]; max?: number; tone?: string; empty?: string }) {
  const { num, t } = useStatsFormat();
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty ?? t("bars.empty")}</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" title={r.hint}>
          <span className="truncate" dir="auto">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></span>
          <span className="tabular-nums text-muted-foreground">{r.right ?? num(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Basis({ basis }: { basis: "fact" | "hypothesis" }) {
  const t = useT("competitors");
  return basis === "fact"
    ? <span className="rounded bg-success/12 px-1.5 py-0.5 text-[10px] font-medium text-success" title={t("basis.factHelp")}>{t("basis.fact")}</span>
    : <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title={t("basis.hypothesisHelp")}>{t("basis.hypothesis")}</span>;
}

export function MetricLegend() {
  const t = useT("competitors");
  const b = (c: React.ReactNode) => <b className="font-medium text-foreground">{c}</b>;
  return (
    <p className="text-[11px] text-muted-foreground">
      {t.rich("legend", { b })}
    </p>
  );
}
