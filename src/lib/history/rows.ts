import { METRICS, type Metric, type Platform } from "@/lib/domain/constants";
import type { RowIssue } from "@/types/domain";
import type { ColumnMapping } from "./fields";
import { normalizeText } from "./text";
import { parseCount, parseDate, parsePlatforms } from "./parse";

/** A staged row as extracted from the file. `__row` is the 1-based row number in the source sheet. */
export type RawRow = Record<string, string> & { __row: string };

export type NormalizedRow = Partial<Record<Metric, number | null>> & {
  source_row: number;
  publication_date: string | null;
  actual_publication_date: string | null;
  platform: Platform | null;
  platform_raw: string | null;
  title: string | null;
  topic: string | null;
  description: string | null;
  format: string | null;
  content_pillar: string | null;
  pillar_id: string | null;
  campaign: string | null;
  campaign_id: string | null;
  caption: string | null;
  cta: string | null;
  publication_status: string | null;
  marketing_objective: string | null;
  product: string | null;
  extra: Record<string, unknown>;
};

export type StrategyRefs = { pillars: { id: string; name: string }[]; campaigns: { id: string; name: string }[] };

export type BuildResult = {
  rows: NormalizedRow[];
  errors: RowIssue[];
  warnings: RowIssue[];
  emptyRows: number;
  excludedRows: number;
};

const MIN_YEAR = 2000;

/** Finds the strategy record whose name matches the imported text (exact, then whole-word containment). */
export function matchRef(text: string | null, refs: { id: string; name: string }[]): string | null {
  const n = normalizeText(text);
  if (!n) return null;
  const exact = refs.find((r) => normalizeText(r.name) === n);
  if (exact) return exact.id;
  const partial = refs.filter((r) => {
    const rn = normalizeText(r.name);
    return rn.length >= 4 && n.length >= 4 && (` ${n} `.includes(` ${rn} `) || ` ${rn} `.includes(` ${n} `));
  });
  return partial.length === 1 ? partial[0].id : null; // ambiguous partial matches stay unlinked
}

/**
 * Applies a column mapping to staged rows and validates them.
 * Nothing is discarded silently: empty rows and user-excluded rows are counted, every unreadable value
 * becomes an error (blocks import) or a warning (imported, flagged). Missing data stays null.
 */
export function buildRows(
  raw: RawRow[],
  mapping: ColumnMapping,
  refs: StrategyRefs,
  { excluded = [], today = new Date() }: { excluded?: number[]; today?: Date } = {},
): BuildResult {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const rows: NormalizedRow[] = [];
  const excludedSet = new Set(excluded);
  const maxDate = `${today.getUTCFullYear() + 2}-12-31`;
  const mappedColumns = new Set(Object.values(mapping).filter(Boolean));
  const seen = new Map<string, number>();
  let emptyRows = 0;
  let excludedRows = 0;

  const cell = (r: RawRow, key: string) => {
    const col = mapping[key];
    const v = col ? r[col] : undefined;
    return v === undefined || v === null ? null : String(v).trim() || null;
  };

  for (const r of raw) {
    const rowNo = Number(r.__row);
    const values = Object.entries(r).filter(([k]) => k !== "__row");
    if (values.every(([, v]) => !String(v ?? "").trim())) {
      emptyRows++;
      continue;
    }
    if (excludedSet.has(rowNo)) {
      excludedRows++;
      continue;
    }
    const rowErrors: RowIssue[] = [];
    const err = (field: string, message: string) => rowErrors.push({ row: rowNo, field, message });
    const warn = (field: string, message: string) => warnings.push({ row: rowNo, field, message });

    const dateField = (key: string) => {
      const v = cell(r, key);
      if (!v) return null;
      const d = parseDate(v);
      if (!d) err(key, `“${v}” is not a date we can read (use e.g. 2024-09-15 or 15/09/2024)`);
      else if (d < `${MIN_YEAR}-01-01` || d > maxDate) err(key, `${d} is outside the plausible range`);
      return d;
    };
    const publication_date = dateField("publication_date");
    const actual_publication_date = dateField("actual_publication_date");

    const platformRaw = cell(r, "platform");
    const platforms = parsePlatforms(platformRaw);
    let platform: Platform | null = platforms[0] ?? null;
    if (platformRaw && !platforms.length) {
      platform = "other";
      warn("platform", `“${platformRaw}” is not a known platform; saved as Other`);
    } else if (platforms.length > 1) {
      warn("platform", `Several platforms (${platforms.join(", ")}); the first one is used, all are kept in the record`);
    }

    const metrics: Partial<Record<Metric, number | null>> = {};
    for (const m of METRICS) {
      const v = cell(r, m);
      if (!v) continue;
      const parsed = parseCount(v);
      if (parsed.error) err(m, `“${v}” ${parsed.error}`);
      metrics[m] = parsed.value;
    }

    const title = cell(r, "title");
    const topic = cell(r, "topic");
    const caption = cell(r, "caption");
    const description = cell(r, "description");
    if (!publication_date && !actual_publication_date && !rowErrors.some((e) => e.field.endsWith("date"))) {
      warn("publication_date", "No date: the row is imported but left out of timeline and seasonality analysis");
    }
    if (!title && !topic && !caption && !description) err("title", "Row has no title, topic, caption or description");

    const content_pillar = cell(r, "content_pillar");
    const pillar_id = matchRef(content_pillar, refs.pillars);
    if (content_pillar && !pillar_id) warn("content_pillar", `“${content_pillar}” doesn't match a strategy pillar; kept as text`);
    const campaign = cell(r, "campaign");
    const campaign_id = matchRef(campaign, refs.campaigns);

    // Duplicate rows in the same file (same date, platform and title) are flagged, not merged.
    const key = [publication_date, platform, normalizeText(title ?? topic ?? caption)].join("|");
    if (seen.has(key)) warn("title", `Looks like a duplicate of row ${seen.get(key)}`);
    else seen.set(key, rowNo);

    // Unmapped columns are preserved so no source information is lost.
    const extra: Record<string, unknown> = {};
    for (const [k, v] of values) if (!mappedColumns.has(k) && String(v ?? "").trim()) extra[k] = v;
    if (platforms.length > 1) extra.platforms = platforms;

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }
    rows.push({
      source_row: rowNo,
      publication_date,
      actual_publication_date,
      platform,
      platform_raw: platformRaw,
      title,
      topic,
      description,
      format: cell(r, "format"),
      content_pillar,
      pillar_id,
      campaign,
      campaign_id,
      caption,
      cta: cell(r, "cta"),
      publication_status: cell(r, "publication_status"),
      marketing_objective: cell(r, "marketing_objective"),
      product: cell(r, "product"),
      extra,
      ...metrics,
    });
  }
  return { rows, errors, warnings, emptyRows, excludedRows };
}

/** Covered period of a set of rows (earliest/latest of planned or actual dates). */
export function coveredPeriod(rows: { publication_date: string | null; actual_publication_date: string | null }[]) {
  const dates = rows.flatMap((r) => [r.publication_date, r.actual_publication_date]).filter((d): d is string => Boolean(d)).sort();
  return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null };
}
