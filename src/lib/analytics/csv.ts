/**
 * RFC 4180 CSV. Cells that a spreadsheet would read as a formula (=, +, -, @, tab, CR) are prefixed with an
 * apostrophe so exported titles can't run as formulas when the file is opened.
 */
export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
