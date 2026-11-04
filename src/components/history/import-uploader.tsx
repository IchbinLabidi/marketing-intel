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
import { useFormatter, useT } from "@/i18n/client";

export const ACCEPT = ".xlsx,.xls,.xlsm,.csv,.txt,.pdf";

export function DropZone({ file, onFile, disabled }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const t = useT("history");
  const fmt = useFormatter();
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
        <p className="text-[13px] font-medium">{file.name} <span className="font-normal text-muted-foreground">· {t("upload.sizeKb", { size: fmt.number(Math.round(file.size / 1024)) })}</span></p>
      ) : (
        <p className="text-[13px] font-medium">{t("upload.drop")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("upload.limits", { rows: fmt.number(5000) })}</p>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function ImportUploader({ projectId, aiEnabled, variant = "default" }: { projectId: string; aiEnabled: boolean; variant?: "default" | "outline" }) {
  const router = useRouter();
  const t = useT("history");
  const fmt = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [label, setLabel] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState<UploadResult["duplicateOf"] | null>(null);

  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  const submit = async (allowDuplicate = false) => {
    if (!file) return toast.error(t("upload.chooseFirst"));
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
        <Upload /> {t("upload.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("upload.title")}</DialogTitle>
            <DialogDescription>
              {t("upload.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <DropZone file={file} onFile={(f) => { setFile(f); setDuplicate(null); }} disabled={pending} />
            {isPdf ? (
              <p className={cn("rounded-lg border p-3 text-xs", aiEnabled ? "bg-muted/40 text-muted-foreground" : "border-warning/40 bg-warning/10")}>
                {aiEnabled
                  ? t("upload.pdfAi")
                  : t("upload.pdfNoAi")}
              </p>
            ) : null}
            <Field label={t("upload.name")} htmlFor="import_label" hint={t("upload.nameHint")}>
              <Input id="import_label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} disabled={pending} />
            </Field>
            {duplicate?.length ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
                <p className="font-medium">{t("upload.duplicateTitle")}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {duplicate.map((d) => <li key={d.id}>{d.label || d.file_name} · {fmt.date(d.created_at)}</li>)}
                </ul>
                <p className="mt-2 text-xs">{t("upload.duplicateHint")}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {duplicate?.length ? (
              <Button variant="outline" disabled={pending} onClick={() => submit(true)}>{t("upload.importAnyway")}</Button>
            ) : null}
            <Button disabled={!file || pending || (isPdf && !aiEnabled)} onClick={() => submit(false)}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? (isPdf ? t("upload.readingPdf") : t("upload.reading")) : t("upload.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
