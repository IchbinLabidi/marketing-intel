import "server-only";
import { METRICS } from "@/lib/domain/constants";
import { createClient } from "@/lib/supabase/server";
import type { NormalizedRow } from "@/lib/history/rows";
import type { AnalysisReport, HistoricalItem, ImportJob, Opportunity } from "@/types/domain";

const BUCKET = "imports";
const PAGE = 1000; // PostgREST returns at most 1000 rows per request on Supabase

const JOB_LIST_COLUMNS =
  "id, project_id, file_name, file_type, storage_path, status, label, reference_year, imported_count, error, file_hash, file_size, sheet_name, period_start, period_end, imported_at, created_at, updated_at";

export type ImportJobSummary = Omit<ImportJob, "raw_rows" | "raw_columns" | "column_mapping" | "validation_errors" | "warnings" | "excluded_rows">;

export async function listImportJobs(projectId: string): Promise<ImportJobSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_jobs").select(JOB_LIST_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ImportJobSummary[];
}

export async function getImportJob(projectId: string, jobId: string): Promise<ImportJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_jobs").select("*").eq("id", jobId).eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as ImportJob | null;
}

export async function findJobsByHash(projectId: string, hash: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_jobs").select("id, label, file_name, status, created_at").eq("project_id", projectId).eq("file_hash", hash);
  if (error) throw error;
  return data ?? [];
}

export async function createImportJob(values: Partial<ImportJob> & { project_id: string; file_name: string; file_type: ImportJob["file_type"]; created_by: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("import_jobs").insert(values).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateImportJob(projectId: string, jobId: string, values: Partial<ImportJob>) {
  const supabase = await createClient();
  const { error } = await supabase.from("import_jobs").update(values).eq("id", jobId).eq("project_id", projectId);
  if (error) throw error;
}

export async function deleteImportJob(projectId: string, jobId: string) {
  const supabase = await createClient();
  const job = await getImportJob(projectId, jobId);
  if (!job) throw new Error("Import not found.");
  const { error, count } = await supabase.from("import_jobs").delete({ count: "exact" }).eq("id", jobId).eq("project_id", projectId);
  if (error) throw error;
  if (!count) throw new Error("You don't have permission to delete this import.");
  if (job.storage_path) await supabase.storage.from(BUCKET).remove([job.storage_path]);
}

// --- Storage (private bucket; path = <project_id>/<job_id>/<file>, enforced by storage RLS) -----------------
export async function uploadImportFile(path: string, body: Buffer, contentType: string) {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Could not store the file: ${error.message}`);
}

export async function downloadImportFile(path: string): Promise<Buffer> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("The original file could not be read from storage.");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeImportFile(path: string) {
  const supabase = await createClient();
  await supabase.storage.from(BUCKET).remove([path]);
}

export async function signedImportFileUrl(path: string) {
  const supabase = await createClient();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

// --- Historical items ------------------------------------------------------------------------------------
/** Replaces the items of one import (re-import is idempotent). */
export async function replaceJobItems(projectId: string, jobId: string, rows: (NormalizedRow & { source: string; pillar_assigned_by: string | null })[]) {
  const supabase = await createClient();
  const del = await supabase.from("historical_content_items").delete().eq("import_job_id", jobId).eq("project_id", projectId);
  if (del.error) throw del.error;
  for (let k = 0; k < rows.length; k += 500) {
    const chunk = rows.slice(k, k + 500).map((r) => ({ ...r, project_id: projectId, import_job_id: jobId }));
    const { error } = await supabase.from("historical_content_items").insert(chunk);
    if (error) throw error;
  }
}

/**
 * Columns for aggregate performance and timing (calendar insights). Skips captions and raw payloads, which make up
 * most of the transfer; post-level lists built from these rows have no labels.
 */
export const PERFORMANCE_COLUMNS = [
  "id", "project_id", "platform", "publication_date", "actual_publication_date", "published_at",
  "format", "pillar_id", "funnel_stage", "publication_status", "source", ...METRICS,
].join(",");

export async function listHistoricalItems(projectId: string, columns = "*"): Promise<HistoricalItem[]> {
  const supabase = await createClient();
  const out: HistoricalItem[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("historical_content_items")
      .select(columns)
      .eq("project_id", projectId)
      .order("publication_date", { ascending: true, nullsFirst: false })
      .order("source_row")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as HistoricalItem[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function getHistoricalItem(projectId: string, itemId: string): Promise<HistoricalItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("historical_content_items").select("*").eq("id", itemId).eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as HistoricalItem | null;
}

export async function updateHistoricalItem(projectId: string, itemId: string, values: Partial<HistoricalItem>) {
  const supabase = await createClient();
  const { error, count } = await supabase.from("historical_content_items").update(values, { count: "exact" }).eq("id", itemId).eq("project_id", projectId);
  if (error) throw error;
  if (!count) throw new Error("Record not found or read-only.");
}

export async function deleteHistoricalItem(projectId: string, itemId: string) {
  const supabase = await createClient();
  const item = await supabase.from("historical_content_items").select("import_job_id").eq("id", itemId).eq("project_id", projectId).maybeSingle();
  const { error } = await supabase.from("historical_content_items").delete().eq("id", itemId).eq("project_id", projectId);
  if (error) throw error;
  const jobId = item.data?.import_job_id as string | undefined;
  if (jobId) {
    const { count } = await supabase.from("historical_content_items").select("id", { count: "exact", head: true }).eq("import_job_id", jobId);
    await supabase.from("import_jobs").update({ imported_count: count ?? 0 }).eq("id", jobId).eq("project_id", projectId);
  }
}

// --- Analysis reports and recommendations ------------------------------------------------------------------
export async function saveAnalysisReport(values: { project_id: string; kind: AnalysisReport["kind"]; title: string; scope: object; result: object; model: string; created_by: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("analysis_reports").insert(values).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function getLatestReport(projectId: string, kind: AnalysisReport["kind"]): Promise<AnalysisReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_reports")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as AnalysisReport | null;
}

/** Previous untouched history recommendations are superseded by a new analysis; saved/scheduled ones are kept. */
export async function replaceHistoryOpportunities(projectId: string, rows: Record<string, unknown>[]) {
  const supabase = await createClient();
  const del = await supabase.from("opportunities").delete().eq("project_id", projectId).eq("source", "historical_analysis").eq("state", "new");
  if (del.error) throw del.error;
  if (!rows.length) return;
  const { error } = await supabase.from("opportunities").insert(rows.map((r) => ({ ...r, project_id: projectId })));
  if (error) throw error;
}

export async function listHistoryOpportunities(projectId: string): Promise<Opportunity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("project_id", projectId)
    .eq("source", "historical_analysis")
    .neq("state", "dismissed")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Opportunity[];
}

export async function setOpportunityState(projectId: string, ids: string[], state: Opportunity["state"]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("opportunities").update({ state }).eq("project_id", projectId).in("id", ids);
  if (error) throw error;
}
