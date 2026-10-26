"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Check, CircleAlert, FileUp, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/app/form";
import type { TargetField } from "@/lib/history/fields";
import type { ImportJob, RowIssue } from "@/types/domain";
import {
  confirmImportAction,
  correctCellAction,
  deleteImportAction,
  replaceImportFileAction,
  saveMappingAction,
  selectSheetAction,
  setRowExcludedAction,
} from "@/server/actions/history";
import { DropZone } from "./import-uploader";

export type WizardProps = {
  projectId: string;
  job: Pick<ImportJob, "id" | "label" | "file_name" | "file_type" | "status" | "error" | "raw_columns" | "column_mapping" | "validation_errors" | "warnings" | "excluded_rows" | "sheet_name" | "sheet_names" | "reference_year" | "imported_count">;
  fields: TargetField[];
  samples: Record<string, string[]>;
  rawByRow: Record<number, Record<string, string>>;
  counts: { total: number; ready: number; empty: number; excluded: number };
  previewRows: { source_row: number; publication_date: string | null; platform: string | null; title: string | null; format: string | null; content_pillar: string | null; pillar_linked: boolean; publication_status: string | null }[];
  readOnly: boolean;
  fileUrl: string | null;
};

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "destructive" | "default" }> = {
  uploaded: { label: "Uploaded", variant: "secondary" },
  extracted: { label: "Extracted", variant: "secondary" },
  mapped: { label: "Needs fixes", variant: "warning" },
  validated: { label: "Ready to import", variant: "default" },
  imported: { label: "Imported", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

export function ImportStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.uploaded;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function ImportWizard(props: WizardProps) {
  const { projectId, job, fields, samples, readOnly } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mapping, setMapping] = React.useState<Record<string, string>>(job.column_mapping ?? {});
  const [dialog, setDialog] = React.useState<"replace" | "delete" | null>(null);
  // The page remounts this component (key) whenever the saved mapping changes, so local edits start from it.

  const dirty = JSON.stringify(mapping) !== JSON.stringify(job.column_mapping ?? {});
  const used = new Map(Object.entries(mapping).filter(([, c]) => c).map(([f, c]) => [c, f]));
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });

  if (job.status === "failed") {
    return (
      <div className="space-y-4">
        <Card className="border-destructive/40">
          <CardContent className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">This file could not be imported</p>
              <p className="text-[13px] text-muted-foreground">{job.error}</p>
            </div>
          </CardContent>
        </Card>
        {!readOnly ? <JobActions {...props} pending={pending} dialog={dialog} setDialog={setDialog} run={run} /> : null}
      </div>
    );
  }

  const groupedErrors = groupByRow(job.validation_errors);
  const fileWarnings = job.warnings.filter((w) => w.row === 0);
  const rowWarnings = job.warnings.filter((w) => w.row > 0);
  const essentialsMissing = !mapping.publication_date && !mapping.actual_publication_date;
  const contentMissing = !mapping.title && !mapping.topic && !mapping.caption && !mapping.description;

  return (
    <div className="space-y-6">
      {job.status !== "imported" && job.imported_count > 0 ? (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>This import currently has {job.imported_count} records from a previous version. Confirming will replace them with the rows below.</p>
        </div>
      ) : null}

      {fileWarnings.length ? (
        <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
          {fileWarnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />{w.message}</p>)}
        </div>
      ) : null}

      {/* 1. Mapping ------------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>1 · Map columns</CardTitle>
          <CardDescription>
            Columns were matched automatically by name. Check each match against the sample values. Unmapped columns are kept with each record, not lost.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {job.sheet_names.length > 1 ? (
            <Field label="Worksheet" htmlFor="sheet" className="max-w-xs">
              <NativeSelect id="sheet" value={job.sheet_name ?? ""} disabled={readOnly || pending} onChange={(e) => run(() => selectSheetAction(projectId, job.id, e.target.value))}>
                {job.sheet_names.map((s) => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {fields.map((f) => {
              const col = mapping[f.key] ?? "";
              return (
                <div key={f.key} className="grid gap-1">
                  <label htmlFor={`map-${f.key}`} className="flex items-center gap-1.5 text-[13px] font-medium">
                    {f.label}
                    {f.kind === "metric" ? <span className="text-[11px] font-normal text-muted-foreground">metric</span> : null}
                  </label>
                  <NativeSelect
                    id={`map-${f.key}`}
                    value={col}
                    disabled={readOnly}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  >
                    <option value="">— Not in this file —</option>
                    {job.raw_columns.map((c) => (
                      <option key={c} value={c} disabled={used.has(c) && used.get(c) !== f.key}>
                        {c}{used.has(c) && used.get(c) !== f.key ? " (used)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="truncate text-xs text-muted-foreground">
                    {col ? (samples[col]?.length ? `e.g. ${samples[col].join(" · ")}` : "Column is empty in the first rows") : f.hint ?? ""}
                  </p>
                </div>
              );
            })}
          </div>
          {essentialsMissing ? <p className="text-xs text-warning">No date column mapped: records can be imported but won’t appear in timelines, frequency or seasonality.</p> : null}
          {contentMissing ? <p className="text-xs text-destructive">Map at least one of Title, Topic, Caption or Description.</p> : null}
          {!readOnly ? (
            <div className="flex justify-end gap-2">
              {dirty ? <Button variant="ghost" size="sm" onClick={() => setMapping(job.column_mapping ?? {})}>Reset</Button> : null}
              <Button size="sm" disabled={!dirty || pending} onClick={() => run(() => saveMappingAction(projectId, job.id, Object.fromEntries(Object.entries(mapping).filter(([, c]) => c))))}>
                {pending ? <Loader2 className="animate-spin" /> : null} Apply mapping and re-check
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. Validation ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>2 · Check the data</CardTitle>
          <CardDescription>Nothing is discarded silently. Fix a value, or explicitly exclude a row you don’t want to import.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Rows in file" value={props.counts.total} />
            <Count label="Ready to import" value={props.counts.ready} tone="success" />
            <Count label="Rows with errors" value={Object.keys(groupedErrors).length} tone={Object.keys(groupedErrors).length ? "destructive" : undefined} />
            <Count label="Excluded / empty" value={`${props.counts.excluded} / ${props.counts.empty}`} />
          </div>

          {Object.keys(groupedErrors).length ? (
            <div className="space-y-2">
              <p className="text-[13px] font-medium">Errors to fix ({job.validation_errors.length})</p>
              <ul className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                {Object.entries(groupedErrors).slice(0, 100).map(([row, issues]) => (
                  <ErrorRow
                    key={row}
                    row={Number(row)}
                    issues={issues}
                    raw={props.rawByRow[Number(row)] ?? {}}
                    mapping={job.column_mapping}
                    readOnly={readOnly}
                    pending={pending}
                    onCorrect={(column, value) => run(() => correctCellAction(projectId, job.id, Number(row), column, value))}
                    onExclude={() => run(() => setRowExcludedAction(projectId, job.id, Number(row), true))}
                  />
                ))}
              </ul>
              {Object.keys(groupedErrors).length > 100 ? <p className="text-xs text-muted-foreground">Showing the first 100 rows with errors. Fixing the mapping often resolves many at once.</p> : null}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-success"><Check className="size-4" /> No blocking errors.</p>
          )}

          {job.excluded_rows.length ? (
            <div className="text-[13px]">
              <p className="font-medium">Excluded rows</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {job.excluded_rows.map((r) => (
                  <button key={r} disabled={readOnly || pending} onClick={() => run(() => setRowExcludedAction(projectId, job.id, r, false))} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent" title="Restore this row">
                    Row {r} <RotateCcw className="size-3" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {rowWarnings.length ? (
            <details className="rounded-lg border p-3 text-[13px]">
              <summary className="cursor-pointer font-medium">Warnings ({rowWarnings.length}) · imported as-is, flagged for review</summary>
              <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {rowWarnings.slice(0, 300).map((w, i) => <li key={i}>Row {w.row} · {fieldLabel(fields, w.field)}: {w.message}</li>)}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {/* 3. Preview --------------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>3 · Preview</CardTitle>
          <CardDescription>How the first rows will be saved. Status is stored exactly as written: a planned item is never counted as published.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Row</th><th className="pr-3 font-medium">Date</th><th className="pr-3 font-medium">Platform</th>
                  <th className="pr-3 font-medium">Title / topic</th><th className="pr-3 font-medium">Format</th><th className="pr-3 font-medium">Pillar</th><th className="font-medium">Status (as imported)</th>
                </tr>
              </thead>
              <tbody>
                {props.previewRows.map((r) => (
                  <tr key={r.source_row} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{r.source_row}</td>
                    <td className="pr-3 tabular-nums">{r.publication_date ?? <Muted />}</td>
                    <td className="pr-3">{r.platform ?? <Muted />}</td>
                    <td className="max-w-xs truncate pr-3">{r.title ?? <Muted />}</td>
                    <td className="pr-3">{r.format ?? <Muted />}</td>
                    <td className="pr-3">{r.content_pillar ? <span>{r.content_pillar}{r.pillar_linked ? <Badge variant="success" className="ml-1">linked</Badge> : null}</span> : <Muted />}</td>
                    <td>{r.publication_status ?? <Muted label="not recorded" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!props.previewRows.length ? <p className="py-4 text-center text-[13px] text-muted-foreground">No valid rows yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      {/* 4. Confirm --------------------------------------------------------------------- */}
      {!readOnly ? (
        <ConfirmCard
          key={`${job.label}-${job.reference_year}`}
          projectId={projectId}
          job={job}
          ready={props.counts.ready}
          blocked={job.validation_errors.length > 0 || dirty}
          dirty={dirty}
          pending={pending}
          run={run}
        />
      ) : null}
      {!readOnly ? <JobActions {...props} pending={pending} dialog={dialog} setDialog={setDialog} run={run} /> : null}
    </div>
  );
}

function ConfirmCard({ projectId, job, ready, blocked, dirty, pending, run }: {
  projectId: string; job: WizardProps["job"]; ready: number; blocked: boolean; dirty: boolean; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => void;
}) {
  const router = useRouter();
  const [label, setLabel] = React.useState(job.label ?? "");
  const [year, setYear] = React.useState(job.reference_year ? String(job.reference_year) : "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>4 · Confirm import</CardTitle>
        <CardDescription>{job.status === "imported" ? "Already imported. Re-confirming replaces the records of this import." : "Records are saved to this project's history. You can edit or delete them later."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Field label="Calendar name" htmlFor="confirm_label" className="flex-1">
          <Input id="confirm_label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Reference year (optional)" htmlFor="confirm_year" className="sm:w-44">
          <Input id="confirm_year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2024" />
        </Field>
        <Button
          disabled={blocked || pending || ready === 0}
          title={dirty ? "Apply the mapping first" : blocked ? "Fix or exclude the rows with errors first" : undefined}
          onClick={() => run(() => confirmImportAction(projectId, job.id, label, year ? Number(year) : null), () => router.push(`/p/${projectId}/history?tab=records&import=${job.id}`))}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Check />} Import {ready} record{ready === 1 ? "" : "s"}
        </Button>
      </CardContent>
    </Card>
  );
}

function JobActions({ projectId, job, fileUrl, pending, dialog, setDialog, run }: WizardProps & {
  pending: boolean; dialog: "replace" | "delete" | null; setDialog: (d: "replace" | "delete" | null) => void;
  run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => void;
}) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {fileUrl ? <Button asChild variant="ghost" size="sm"><a href={fileUrl} target="_blank" rel="noreferrer">Download original</a></Button> : null}
      <Button variant="outline" size="sm" onClick={() => setDialog("replace")}><FileUp /> Replace file</Button>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete import</Button>

      <Dialog open={dialog === "replace"} onOpenChange={(o) => !pending && setDialog(o ? "replace" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the file</DialogTitle>
            <DialogDescription>Your column mapping is kept where the columns still exist. Current records stay until you confirm the new version.</DialogDescription>
          </DialogHeader>
          <DropZone file={file} onFile={setFile} disabled={pending} />
          <DialogFooter>
            <Button
              disabled={!file || pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("file", file!);
                run(() => replaceImportFileAction(projectId, job.id, null, fd), () => { setDialog(null); setFile(null); });
              }}
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Upload new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !pending && setDialog(o ? "delete" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{job.label || job.file_name}”?</DialogTitle>
            <DialogDescription>
              This deletes the uploaded file and its {job.imported_count} imported record{job.imported_count === 1 ? "" : "s"}. Saved recommendations and calendars are kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteImportAction(projectId, job.id), () => router.push(`/p/${projectId}/history?tab=imports`))}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErrorRow({ row, issues, raw, mapping, readOnly, pending, onCorrect, onExclude }: {
  row: number; issues: RowIssue[]; raw: Record<string, string>; mapping: Record<string, string>; readOnly: boolean; pending: boolean;
  onCorrect: (column: string, value: string) => void; onExclude: () => void;
}) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium">Row {row}</p>
        {!readOnly ? <Button variant="ghost" size="sm" disabled={pending} onClick={onExclude}><Ban /> Exclude row</Button> : null}
      </div>
      <ul className="mt-1 grid gap-2">
        {issues.map((issue, i) => {
          const column = mapping[issue.field];
          return (
            <li key={i} className="grid gap-1 text-xs">
              <p className="text-destructive">{issue.message}</p>
              {column && !readOnly ? <CorrectInput column={column} initial={raw[column] ?? ""} pending={pending} onSave={(v) => onCorrect(column, v)} /> : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function CorrectInput({ column, initial, pending, onSave }: { column: string; initial: string; pending: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSave(value); }}>
      <span className="shrink-0 text-muted-foreground">{column}:</span>
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 text-xs" aria-label={`Correct ${column}`} />
      <Button type="submit" size="sm" variant="outline" className="h-7" disabled={pending || value === initial}>Save</Button>
    </form>
  );
}

function Count({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "destructive" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

const Muted = ({ label = "—" }: { label?: string }) => <span className="text-muted-foreground">{label}</span>;

function groupByRow(issues: RowIssue[]) {
  const out: Record<number, RowIssue[]> = {};
  for (const i of issues) (out[i.row] ??= []).push(i);
  return out;
}

const fieldLabel = (fields: TargetField[], key: string) => fields.find((f) => f.key === key)?.label ?? key;
