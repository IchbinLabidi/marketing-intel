"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, CloudDownload, CloudUpload, Film, Loader2, Maximize2, Minimize2, PanelBottomClose, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { mediaJob, useMediaJob, type MediaJob } from "@/lib/media/progress-store";
import { MAX_FILE_BYTES } from "@/lib/publishing/rules";
import { useT } from "@/i18n/client";

const mb = (bytes: number) => Math.max(0.1, bytes / 1024 / 1024).toFixed(1);
const ORDER: MediaJob["stage"][] = ["download", "compress", "upload"];

/**
 * Centered window shown while a video is downloaded from Drive, compressed in the browser and uploaded.
 * Mounted once in the root layout; driven by the media progress store.
 */
export function MediaProgressOverlay() {
  const job = useMediaJob();
  const t = useT("publishing");
  const [now, setNow] = React.useState(0);
  React.useEffect(() => {
    if (!job) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job]);
  // warn before closing the tab mid-way: the work would be lost
  React.useEffect(() => {
    if (!job) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [job]);
  if (!job || typeof document === "undefined") return null;

  const steps = ORDER.filter((s) => s !== "download" || job.fromDrive);
  const current = steps.indexOf(job.stage);
  const percent = job.percent;
  let eta: string | null = null;
  if (job.stage === "compress" && job.compressStartedAt && percent && percent >= 3 && now > job.compressStartedAt) {
    const elapsed = (now - job.compressStartedAt) / 1000;
    const left = Math.max(0, Math.round((elapsed * (100 - percent)) / percent));
    eta = left >= 60 ? t("compress.etaMin", { count: Math.ceil(left / 60) }) : t("compress.etaSec", { count: Math.max(5, Math.ceil(left / 5) * 5) });
  }
  const label = (s: MediaJob["stage"]) => (s === "download" ? t("compress.stepDownload") : s === "compress" ? t("compress.stepCompress") : t("compress.stepUpload"));
  const Icon = job.stage === "download" ? CloudDownload : job.stage === "upload" ? CloudUpload : Minimize2;
  const bar = (className: string) =>
    percent === null ? (
      <div className={cn("w-full overflow-hidden rounded-full bg-secondary", className)}>
        <div className="h-full w-1/3 animate-[media-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
    ) : (
      <Progress className={className} value={percent} label={t(`compress.title.${job.stage}`)} />
    );
  const keyframes = <style>{`@keyframes media-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>;

  if (job.minimized) {
    return createPortal(
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-32px))] rounded-xl border bg-card p-3 text-card-foreground shadow-xl"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{t(`compress.title.${job.stage}`)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {percent === null ? job.name : `${percent}%${eta ? ` · ${eta}` : ""}`}
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={t("compress.expand")} title={t("compress.expand")} onClick={() => mediaJob.update({ minimized: false })}>
            <Maximize2 />
          </Button>
          {job.cancel ? (
            <Button size="icon-sm" variant="ghost" aria-label={t("compress.cancel")} title={t("compress.cancel")} onClick={() => job.cancel?.()}>
              <X />
            </Button>
          ) : null}
        </div>
        {bar("mt-2.5 h-1.5")}
        {keyframes}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="media-job-title">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="media-job-title" className="text-base font-semibold">{t(`compress.title.${job.stage}`)}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
              <Film className="size-3.5 shrink-0" />
              <span className="truncate">{job.name}</span>
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-end justify-between gap-3">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">
            {percent === null ? <Loader2 className="size-8 animate-spin text-primary" /> : `${percent}%`}
          </span>
          <span className="pb-1 text-right text-xs text-muted-foreground">
            {job.fromBytes ? t("compress.sizes", { from: mb(job.fromBytes), to: Math.round(MAX_FILE_BYTES / 1024 / 1024) }) : null}
            {eta ? <><br />{eta}</> : null}
          </span>
        </div>
        {bar("mt-3 h-2")}

        <ol className="mt-6 space-y-2.5">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} className={cn("flex items-center gap-2.5 text-[13px]", done || active ? "text-foreground" : "text-muted-foreground")}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border", done && "border-success bg-success text-white", active && "border-primary text-primary")}>
                  {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                </span>
                <span className={cn(active && "font-medium")}>{label(s)}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 space-y-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">{t("compress.keepOpen")}</p>
          <div className="flex items-center justify-end gap-2">
            {job.cancel ? (
              <Button size="sm" variant="ghost" onClick={() => job.cancel?.()}>
                {t("compress.cancel")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => mediaJob.update({ minimized: true })}>
              <PanelBottomClose /> {t("compress.background")}
            </Button>
          </div>
        </div>
      </div>
      {keyframes}
    </div>,
    document.body,
  );
}
