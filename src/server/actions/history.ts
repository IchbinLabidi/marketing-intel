"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { canEdit, METRICS } from "@/lib/domain/constants";
import { autoMapColumns, TARGET_FIELD_KEYS, type ColumnMapping } from "@/lib/history/fields";
import { buildRows, coveredPeriod, type RawRow, type StrategyRefs } from "@/lib/history/rows";
import { formToObject, zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { historicalItemSchema } from "@/lib/validation/history";
import type { ImportJob } from "@/types/domain";
import { describeAIError, isAIConfigured } from "@/server/ai/client";
import { PDF_PROMPT, PDF_SYSTEM_PROMPT, pdfExtractionSchema } from "@/server/ai/history";
import { runStructured } from "@/server/ai/run";
import { ExtractionError, extractCsv, extractSpreadsheet, fileKind, MAX_FILE_BYTES, matrixToRows, type Extracted, type ImportFileKind } from "@/server/imports/extract";
import {
  createImportJob,
  deleteHistoricalItem,
  deleteImportJob,
  downloadImportFile,
  findJobsByHash,
  getHistoricalItem,
  getImportJob,
  removeImportFile,
  replaceJobItems,
  updateHistoricalItem,
  updateImportJob,
  uploadImportFile,
} from "@/server/services/history";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { getStrategyBundle } from "@/server/services/strategy";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const fail = (e: unknown, fallback: string): ActionResult<never> => ({ ok: false, error: e instanceof Error ? e.message : fallback });

async function guard(projectId: string) {
  const user = await requireUser();
  const ctx = await getProjectContext(projectId);
  return { user, ...ctx, allowed: canEdit(ctx.role) };
}

const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function strategyRefs(projectId: string): Promise<StrategyRefs> {
  const b = await getStrategyBundle(projectId);
  return { pillars: b.pillars.map((p) => ({ id: p.id, name: p.name })), campaigns: b.campaigns.map((c) => ({ id: c.id, name: c.name })) };
}

const CONTENT_TYPES: Record<ImportFileKind, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

type UploadedFile = { buffer: Buffer; name: string; kind: ImportFileKind; ext: string; hash: string; size: number };

async function readUpload(formData: FormData): Promise<UploadedFile | ActionResult<never>> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { ok: false, error: "Choose a file to import." };
  if (file.size === 0) return { ok: false, error: `“${file.name}” is empty.` };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `“${file.name}” is larger than 10 MB. Split it or export only the calendar sheet.` };
  const kind = fileKind(file.name);
  if (!kind) return { ok: false, error: "Unsupported file type. Import an Excel (.xlsx, .xls), CSV or PDF file." };
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, name: file.name, ...kind, hash: createHash("sha256").update(buffer).digest("hex"), size: file.size };
}

const storagePath = (projectId: string, jobId: string, name: string) =>
  `${projectId}/${jobId}/${name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-120)}`;

async function extractPdf(buffer: Buffer, ctx: { workspaceId: string; projectId: string; userId: string }) {
  if (!isAIConfigured()) {
    throw new ExtractionError("PDF calendars are read with AI, which is not configured on this server. Export the calendar to Excel or CSV and import that file instead.");
  }
  const out = await runStructured({
    feature: "history.pdf_extraction",
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    userId: ctx.userId,
    system: PDF_SYSTEM_PROMPT,
    prompt: PDF_PROMPT,
    schema: pdfExtractionSchema,
    effort: "low",
    pdfs: [buffer.toString("base64")],
  });
  if (!out.rows.length) {
    throw new ExtractionError(`No calendar table could be extracted from this PDF.${out.notes.length ? ` ${out.notes.join(" ")}` : ""} Try an Excel or CSV export instead.`);
  }
  // PDF rows have no sheet row numbers; number them from 1 in reading order.
  const extracted = matrixToRows([out.columns, ...out.rows], 0);
  return { extracted: { sheets: [], sheet: null, ...extracted } as Extracted, reliability: out.reliability, notes: out.notes };
}

/**
 * Parses the stored file into the job's staging area, suggests a mapping (keeping the user's previous choices
 * where the columns still exist) and validates. Failures are stored on the job so the user sees what went wrong.
 */
async function extractIntoJob(
  job: Pick<ImportJob, "id" | "project_id" | "column_mapping" | "excluded_rows">,
  file: { buffer: Buffer; kind: ImportFileKind; sheet?: string | null },
  ctx: { workspaceId: string; userId: string },
) {
  try {
    let extracted: Extracted;
    const pdfWarnings: { row: number; field: string; message: string }[] = [];
    if (file.kind === "pdf") {
      const pdf = await extractPdf(file.buffer, { ...ctx, projectId: job.project_id });
      extracted = pdf.extracted;
      if (pdf.reliability !== "high") {
        pdfWarnings.push({ row: 0, field: "file", message: `PDF extraction reliability is ${pdf.reliability}. Check every row against the original before confirming, or import an Excel/CSV export.` });
      }
      for (const n of pdf.notes) pdfWarnings.push({ row: 0, field: "file", message: n });
    } else {
      extracted = file.kind === "csv" ? extractCsv(file.buffer) : extractSpreadsheet(file.buffer, file.sheet);
    }
    if (!extracted.rows.some((r) => Object.entries(r).some(([k, v]) => k !== "__row" && v))) {
      throw new ExtractionError(extracted.headers.length ? "The file has column headers but no data rows." : "No data was found in this file.");
    }
    const previous = Object.fromEntries(Object.entries(job.column_mapping ?? {}).filter(([, col]) => extracted.headers.includes(col)));
    const mapping = { ...autoMapColumns(extracted.headers), ...previous };
    const result = buildRows(extracted.rows, mapping, await strategyRefs(job.project_id), { excluded: job.excluded_rows ?? [] });
    await updateImportJob(job.project_id, job.id, {
      status: result.errors.length ? "mapped" : "validated",
      raw_columns: extracted.headers,
      raw_rows: extracted.rows,
      column_mapping: mapping,
      validation_errors: result.errors,
      warnings: [...pdfWarnings, ...result.warnings],
      sheet_name: extracted.sheet,
      sheet_names: extracted.sheets,
      error: null,
    });
  } catch (e) {
    const message = e instanceof ExtractionError ? e.message : describeAIError(e);
    await updateImportJob(job.project_id, job.id, { status: "failed", error: message, raw_rows: [], raw_columns: [], validation_errors: [], warnings: [] });
  }
}

async function revalidateJob(projectId: string, job: ImportJob, patch: Partial<ImportJob> = {}) {
  const merged = { ...job, ...patch };
  const result = buildRows(merged.raw_rows as RawRow[], merged.column_mapping, await strategyRefs(projectId), { excluded: merged.excluded_rows });
  const keepFileWarnings = (job.warnings ?? []).filter((w) => w.row === 0);
  await updateImportJob(projectId, job.id, {
    ...patch,
    status: job.status === "imported" && !patch.raw_rows && !patch.column_mapping && !patch.excluded_rows ? "imported" : result.errors.length ? "mapped" : "validated",
    validation_errors: result.errors,
    warnings: [...keepFileWarnings, ...result.warnings],
  });
  return result;
}

// ---------------------------------------------------------------------------
// Upload / replace / delete
// ---------------------------------------------------------------------------
export type UploadResult = { jobId?: string; duplicateOf?: { id: string; label: string | null; file_name: string; created_at: string }[] };

export async function uploadImportAction(projectId: string, _: ActionResult<UploadResult> | null, formData: FormData): Promise<ActionResult<UploadResult>> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const file = await readUpload(formData);
  if ("ok" in file) return file;
  try {
    if (formData.get("allow_duplicate") !== "1") {
      const dupes = await findJobsByHash(projectId, file.hash);
      if (dupes.length) return { ok: true, data: { duplicateOf: dupes } };
    }
    const label = String(formData.get("label") ?? "").trim().slice(0, 160) || file.name.replace(/\.[^.]+$/, "");
    const jobId = await createImportJob({
      project_id: projectId,
      file_name: file.name,
      file_type: file.kind,
      status: "uploaded",
      label,
      file_hash: file.hash,
      file_size: file.size,
      created_by: user.id,
    });
    const path = storagePath(projectId, jobId, file.name);
    await uploadImportFile(path, file.buffer, CONTENT_TYPES[file.kind]);
    await updateImportJob(projectId, jobId, { storage_path: path });
    await extractIntoJob({ id: jobId, project_id: projectId, column_mapping: {}, excluded_rows: [] }, file, { workspaceId: project.workspace_id, userId: user.id });
    refresh(projectId);
    return { ok: true, data: { jobId }, message: "File uploaded" };
  } catch (e) {
    return fail(e, "Upload failed");
  }
}

export async function replaceImportFileAction(projectId: string, jobId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job) return { ok: false, error: "Import not found." };
  const file = await readUpload(formData);
  if ("ok" in file) return file;
  try {
    const path = storagePath(projectId, jobId, file.name);
    await uploadImportFile(path, file.buffer, CONTENT_TYPES[file.kind]);
    if (job.storage_path && job.storage_path !== path) await removeImportFile(job.storage_path);
    await updateImportJob(projectId, jobId, {
      file_name: file.name, file_type: file.kind, file_hash: file.hash, file_size: file.size, storage_path: path, excluded_rows: [], sheet_name: null,
    });
    await extractIntoJob({ ...job, excluded_rows: [] }, file, { workspaceId: project.workspace_id, userId: user.id });
    refresh(projectId);
    return { ok: true, message: "New file loaded. Review it and confirm to replace the imported records." };
  } catch (e) {
    return fail(e, "Could not replace the file");
  }
}

export async function selectSheetAction(projectId: string, jobId: string, sheet: string): Promise<ActionResult> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job?.storage_path) return { ok: false, error: "Import not found." };
  if (!job.sheet_names.includes(sheet)) return { ok: false, error: "Unknown sheet." };
  try {
    const buffer = await downloadImportFile(job.storage_path);
    await updateImportJob(projectId, jobId, { excluded_rows: [] });
    await extractIntoJob({ ...job, column_mapping: {}, excluded_rows: [] }, { buffer, kind: "xlsx", sheet }, { workspaceId: project.workspace_id, userId: user.id });
    refresh(projectId);
    return { ok: true, message: `Sheet “${sheet}” loaded` };
  } catch (e) {
    return fail(e, "Could not read that sheet");
  }
}

export async function deleteImportAction(projectId: string, jobId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    await deleteImportJob(projectId, jobId);
    refresh(projectId);
    return { ok: true, message: "Import and its records deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}

// ---------------------------------------------------------------------------
// Mapping, corrections, confirmation
// ---------------------------------------------------------------------------
export async function saveMappingAction(projectId: string, jobId: string, mapping: ColumnMapping): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job) return { ok: false, error: "Import not found." };
  const clean = Object.fromEntries(
    Object.entries(mapping ?? {}).filter(([field, col]) => TARGET_FIELD_KEYS.includes(field) && typeof col === "string" && job.raw_columns.includes(col)),
  );
  const used = Object.values(clean);
  if (new Set(used).size !== used.length) return { ok: false, error: "Each column can only be mapped to one field." };
  try {
    await revalidateJob(projectId, job, { column_mapping: clean });
    refresh(projectId);
    return { ok: true, message: "Mapping saved" };
  } catch (e) {
    return fail(e, "Could not save the mapping");
  }
}

export async function correctCellAction(projectId: string, jobId: string, row: number, column: string, value: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job) return { ok: false, error: "Import not found." };
  if (!job.raw_columns.includes(column)) return { ok: false, error: "Unknown column." };
  const rows = (job.raw_rows as RawRow[]).map((r) => (Number(r.__row) === row ? { ...r, [column]: String(value).slice(0, 5000) } : r));
  try {
    await revalidateJob(projectId, job, { raw_rows: rows });
    refresh(projectId);
    return { ok: true, message: `Row ${row} corrected` };
  } catch (e) {
    return fail(e, "Could not save the correction");
  }
}

export async function setRowExcludedAction(projectId: string, jobId: string, row: number, excluded: boolean): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job) return { ok: false, error: "Import not found." };
  const set = new Set(job.excluded_rows);
  if (excluded) set.add(row);
  else set.delete(row);
  try {
    await revalidateJob(projectId, job, { excluded_rows: [...set].sort((a, b) => a - b) });
    refresh(projectId);
    return { ok: true, message: excluded ? `Row ${row} will not be imported` : `Row ${row} restored` };
  } catch (e) {
    return fail(e, "Could not update the row");
  }
}

export async function confirmImportAction(projectId: string, jobId: string, label: string, referenceYear: number | null): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const job = await getImportJob(projectId, jobId);
  if (!job) return { ok: false, error: "Import not found." };
  try {
    const result = buildRows(job.raw_rows as RawRow[], job.column_mapping, await strategyRefs(projectId), { excluded: job.excluded_rows });
    if (result.errors.length) return { ok: false, error: `${result.errors.length} problem(s) must be fixed or the rows excluded before importing.` };
    if (!result.rows.length) return { ok: false, error: "There is nothing to import: every row is empty or excluded." };
    await replaceJobItems(
      projectId,
      jobId,
      result.rows.map((r) => ({ ...r, source: job.file_type, pillar_assigned_by: r.pillar_id ? "import" : null })),
    );
    const period = coveredPeriod(result.rows);
    await updateImportJob(projectId, jobId, {
      status: "imported",
      label: label.trim().slice(0, 160) || job.label,
      reference_year: referenceYear && referenceYear > 1990 && referenceYear < 2100 ? referenceYear : null,
      imported_count: result.rows.length,
      imported_at: new Date().toISOString(),
      period_start: period.start,
      period_end: period.end,
      validation_errors: [],
    });
    refresh(projectId);
    return { ok: true, message: `${result.rows.length} records imported` };
  } catch (e) {
    return fail(e, "Import failed");
  }
}

// ---------------------------------------------------------------------------
// Imported records
// ---------------------------------------------------------------------------
export async function updateHistoricalItemAction(projectId: string, itemId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = historicalItemSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const refs = await strategyRefs(projectId);
  const values = { ...parsed.data };
  if (values.pillar_id && !refs.pillars.some((p) => p.id === values.pillar_id)) return { ok: false, error: "Unknown pillar." };
  if (values.campaign_id && !refs.campaigns.some((c) => c.id === values.campaign_id)) return { ok: false, error: "Unknown campaign." };
  if (!values.title && !values.topic && !values.caption && !values.description) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { title: "A record needs a title, topic, caption or description" } };
  }
  try {
    // Keep the text columns in sync with the linked strategy record, so analysis and exports agree.
    const pillar = refs.pillars.find((p) => p.id === values.pillar_id);
    const campaign = refs.campaigns.find((c) => c.id === values.campaign_id);
    const current = await getHistoricalItem(projectId, itemId);
    if (!current) return { ok: false, error: "Record not found." };
    // Metrics of synced posts belong to the source and are refreshed by each sync; they can't be edited by hand.
    const editable = current.source === "meta_api" ? Object.fromEntries(Object.entries(values).filter(([k]) => !(METRICS as readonly string[]).includes(k))) : values;
    await updateHistoricalItem(projectId, itemId, {
      ...editable,
      ...(pillar ? { content_pillar: pillar.name } : {}),
      ...(campaign ? { campaign: campaign.name } : {}),
      ...(values.pillar_id !== current.pillar_id ? { pillar_assigned_by: values.pillar_id ? "user" : null } : {}),
    } as never);
    refresh(projectId);
    return { ok: true, message: "Record saved" };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function deleteHistoricalItemAction(projectId: string, itemId: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    await deleteHistoricalItem(projectId, itemId);
    refresh(projectId);
    return { ok: true, message: "Record deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}
