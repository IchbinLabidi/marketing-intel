import "server-only";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { RawRow } from "@/lib/history/rows";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_CELL = 5000;

export type ImportFileKind = "csv" | "xlsx" | "pdf";

/** Maps an uploaded file name to the import kind (.xls is read by the same spreadsheet parser as .xlsx). */
export function fileKind(name: string): { kind: ImportFileKind; ext: string } | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") return { kind: "csv", ext };
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return { kind: "xlsx", ext };
  if (ext === "pdf") return { kind: "pdf", ext };
  return null;
}

export type Extracted = { sheets: string[]; sheet: string | null; headers: string[]; rows: RawRow[]; headerRow: number };

export class ExtractionError extends Error {}

/** Picks the header row: the row (among the first 15) with the most text-like cells. Title rows above it are skipped. */
function detectHeader(matrix: string[][]) {
  let best = 0, bestScore = -1;
  matrix.slice(0, 15).forEach((row, i) => {
    const score = row.filter((c) => c && !/^[\d\s.,/:-]+$/.test(c)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return bestScore >= 2 ? best : 0;
}

function uniqueHeaders(raw: string[]) {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? "").toString().trim().replace(/\s+/g, " ") || `Column ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

/** Converts a cell matrix into header + staged rows. `firstRowNumber` is the 1-based sheet row of matrix[0]. */
export function matrixToRows(matrix: string[][], firstRowNumber = 1): Omit<Extracted, "sheets" | "sheet"> {
  const cleaned = matrix.map((r) => r.map((c) => String(c ?? "").trim().slice(0, MAX_CELL)));
  const headerIdx = detectHeader(cleaned);
  const width = Math.max(0, ...cleaned.map((r) => r.length));
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => cleaned[headerIdx]?.[i] ?? ""));
  const body = cleaned.slice(headerIdx + 1);
  // trailing blank rows are padding, not data
  while (body.length && body[body.length - 1].every((c) => !c)) body.pop();
  if (body.length > MAX_ROWS) {
    throw new ExtractionError(`The file has ${body.length} rows; the limit is ${MAX_ROWS} per import. Split it by year or quarter and import each part.`);
  }
  const rows = body.map((r, i) => {
    const row = { __row: String(firstRowNumber + headerIdx + 1 + i) } as RawRow;
    headers.forEach((h, c) => (row[h] = r[c] ?? ""));
    return row;
  });
  // Drop columns that are empty in every row and have no header (Excel formatting leftovers).
  const keep = headers.filter((h, i) => cleaned[headerIdx]?.[i] || rows.some((r) => r[h]));
  for (const r of rows) for (const h of headers) if (!keep.includes(h)) delete r[h];
  return { headers: keep, rows, headerRow: firstRowNumber + headerIdx };
}

function decodeText(buffer: Buffer) {
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer); // Excel "CSV (Windows)" exports
  return text.replace(/^﻿/, "");
}

export function extractCsv(buffer: Buffer): Extracted {
  const parsed = Papa.parse<string[]>(decodeText(buffer), { skipEmptyLines: false, delimitersToGuess: [",", ";", "\t", "|"] });
  const fatal = parsed.errors.find((e) => e.type === "Delimiter" && parsed.data.length === 0);
  if (fatal) throw new ExtractionError(`Could not read the CSV: ${fatal.message}`);
  return { sheets: [], sheet: null, ...matrixToRows(parsed.data) };
}

export function extractSpreadsheet(buffer: Buffer, sheetName?: string | null): Extracted {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  } catch {
    throw new ExtractionError("This file could not be opened as an Excel workbook. It may be corrupted or password-protected.");
  }
  const nonEmpty = wb.SheetNames.filter((n) => wb.Sheets[n]?.["!ref"]);
  if (!nonEmpty.length) throw new ExtractionError("The workbook has no sheet with data.");
  const sheet = sheetName && nonEmpty.includes(sheetName) ? sheetName : nonEmpty[0];
  const ws = wb.Sheets[sheet];
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "", blankrows: true });
  return { sheets: nonEmpty, sheet, ...matrixToRows(matrix, range.s.r + 1) };
}
