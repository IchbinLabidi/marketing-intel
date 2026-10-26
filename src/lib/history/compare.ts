import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import type { AnalysisItem } from "./analysis";
import { effectiveDate } from "./analysis";
import { normalizeFormat } from "./parse";
import { schoolYearOf } from "./seasons";
import { normalizeText } from "./text";

export type PeriodSpec =
  | { kind: "school_year"; value: string }   // "2024-2025"
  | { kind: "year"; value: string }          // "2024"
  | { kind: "import"; value: string };       // import job id

export function parsePeriod(raw: string | undefined): PeriodSpec | null {
  if (!raw) return null;
  const [kind, value] = raw.split(":");
  if (kind === "school_year" && /^\d{4}-\d{4}$/.test(value)) return { kind, value };
  if (kind === "year" && /^\d{4}$/.test(value)) return { kind, value };
  if (kind === "import" && /^[0-9a-f-]{36}$/i.test(value)) return { kind, value };
  return null;
}

export const periodKey = (p: PeriodSpec) => `${p.kind}:${p.value}`;

export function itemsInPeriod(items: AnalysisItem[], p: PeriodSpec) {
  if (p.kind === "import") return items.filter((i) => i.import_job_id === p.value);
  return items.filter((i) => {
    const d = effectiveDate(i);
    if (!d) return false;
    return p.kind === "year" ? d.startsWith(p.value) : schoolYearOf(d) === p.value;
  });
}

/** Periods the user can pick, derived from the data actually imported. */
export function availablePeriods(items: AnalysisItem[], imports: { id: string; label: string | null; file_name: string }[]) {
  const dates = items.map(effectiveDate).filter((d): d is string => Boolean(d));
  const schoolYears = [...new Set(dates.map(schoolYearOf))].sort();
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))].sort();
  return [
    ...schoolYears.map((v) => ({ key: `school_year:${v}`, label: `School year ${v}` })),
    ...years.map((v) => ({ key: `year:${v}`, label: `Calendar year ${v}` })),
    ...imports.map((i) => ({ key: `import:${i.id}`, label: `Import: ${i.label || i.file_name}` })),
  ];
}

function shares(items: AnalysisItem[], keyOf: (i: AnalysisItem) => string | null) {
  const map = new Map<string, number>();
  for (const i of items) {
    const k = keyOf(i) ?? "Not specified";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function weeksSpanned(items: AnalysisItem[]) {
  const dates = items.map(effectiveDate).filter((d): d is string => Boolean(d)).sort();
  if (dates.length < 1) return null;
  return Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000 / 7 + 1 / 7);
}

/** Side-by-side comparison of two periods. Pure counts and shares; interpretation is left to the reader or the AI. */
export function comparePeriods(a: AnalysisItem[], b: AnalysisItem[], pillarName: (id: string) => string | undefined) {
  const dims: { key: string; label: string; keyOf: (i: AnalysisItem) => string | null }[] = [
    { key: "pillar", label: "Content pillars", keyOf: (i) => (i.pillar_id ? pillarName(i.pillar_id) ?? null : i.content_pillar) },
    { key: "format", label: "Formats", keyOf: (i) => normalizeFormat(i.format) },
    { key: "platform", label: "Platforms", keyOf: (i) => (i.platform ? PLATFORM_LABELS[i.platform as Platform] : null) },
  ];
  const table = dims.map((d) => {
    const ma = shares(a, d.keyOf);
    const mb = shares(b, d.keyOf);
    const keys = [...new Set([...ma.keys(), ...mb.keys()])];
    return {
      key: d.key,
      label: d.label,
      rows: keys
        .map((k) => {
          const ca = ma.get(k) ?? 0, cb = mb.get(k) ?? 0;
          const sa = a.length ? Math.round((ca / a.length) * 1000) / 10 : 0;
          const sb = b.length ? Math.round((cb / b.length) * 1000) / 10 : 0;
          return { name: k, a: ca, b: cb, shareA: sa, shareB: sb, deltaShare: Math.round((sb - sa) * 10) / 10 };
        })
        .sort((x, y) => y.a + y.b - (x.a + x.b)),
    };
  });
  const campaignsOf = (items: AnalysisItem[]) => new Map(items.filter((i) => i.campaign).map((i) => [normalizeText(i.campaign), i.campaign!]));
  const ca = campaignsOf(a), cb = campaignsOf(b);
  const wa = weeksSpanned(a), wb = weeksSpanned(b);
  return {
    volume: { a: a.length, b: b.length, delta: b.length - a.length, deltaPct: a.length ? Math.round(((b.length - a.length) / a.length) * 100) : null },
    perWeek: { a: wa ? Math.round((a.length / wa) * 10) / 10 : null, b: wb ? Math.round((b.length / wb) * 10) / 10 : null },
    dimensions: table,
    campaigns: {
      onlyA: [...ca.entries()].filter(([k]) => !cb.has(k)).map(([, v]) => v),
      onlyB: [...cb.entries()].filter(([k]) => !ca.has(k)).map(([, v]) => v),
      both: [...ca.entries()].filter(([k]) => cb.has(k)).map(([, v]) => v),
    },
  };
}
