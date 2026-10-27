"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form";
import { uploadImportAction, type UploadResult } from "@/server/actions/history";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

export const ACCEPT = ".xlsx,.xls,.xlsm,.csv,.txt,.pdf";

export function DropZone({ file, onFile, disabled }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
        over ? "border-primary bg-primary/5" : "hover:bg-accent/50",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <FileUp className="size-6 text-muted-foreground" />
      {file ? (
        <p className="text-[13px] font-medium">{file.name} <span className="font-normal text-muted-foreground">· {(file.size / 1024).toFixed(0)} KB</span></p>
      ) : (
        <p className="text-[13px] font-medium">Drop a calendar file here or click to choose</p>
      )}
      <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls), CSV or PDF · up to 10 MB · 5,000 rows</p>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function ImportUploader({ projectId, aiEnabled, variant = "default" }: { projectId: string; aiEnabled: boolean; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState<UploadResult["duplicateOf"] | null>(null);

  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  const submit = async (allowDuplicate = false) => {
    if (!file) return toast.error("Choose a file first");
    setPending(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("label", label);
    if (allowDuplicate) fd.set("allow_duplicate", "1");
    const r = await uploadImportAction(projectId, null, fd);
    setPending(false);
    if (!r.ok) return toast.error(r.error);
    if (r.data?.duplicateOf) return setDuplicate(r.data.duplicateOf);
    setOpen(false);
    setFile(null);
    setLabel("");
    setDuplicate(null);
    router.push(`/p/${projectId}/history/imports/${r.data?.jobId}`);
  };

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Upload /> Import calendar
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a historical calendar</DialogTitle>
            <DialogDescription>
              The file is stored privately. You will preview the content, map columns and fix problems before anything is imported.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <DropZone file={file} onFile={(f) => { setFile(f); setDuplicate(null); }} disabled={pending} />
            {isPdf ? (
              <p className={cn("rounded-lg border p-3 text-xs", aiEnabled ? "bg-muted/40 text-muted-foreground" : "border-warning/40 bg-warning/10")}>
                {aiEnabled
                  ? "PDF tables are read with AI. Extraction can be imperfect: you will check every row before importing. Excel or CSV gives the most reliable result."
                  : "PDF import needs AI, which is not configured on this server. Export the calendar to Excel or CSV instead."}
              </p>
            ) : null}
            <Field label="Name for this calendar" htmlFor="import_label" hint="e.g. “Calendar 2024-2025”. Defaults to the file name.">
              <Input id="import_label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} disabled={pending} />
            </Field>
            {duplicate?.length ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
                <p className="font-medium">This exact file was already uploaded</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {duplicate.map((d) => <li key={d.id}>{d.label || d.file_name} · {formatDate(d.created_at)}</li>)}
                </ul>
                <p className="mt-2 text-xs">Importing it again would double-count its content. To update an existing import, open it and use “Replace file”.</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {duplicate?.length ? (
              <Button variant="outline" disabled={pending} onClick={() => submit(true)}>Import anyway</Button>
            ) : null}
            <Button disabled={!file || pending || (isPdf && !aiEnabled)} onClick={() => submit(false)}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? (isPdf ? "Reading the PDF… up to a minute" : "Reading the file…") : "Upload and preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
