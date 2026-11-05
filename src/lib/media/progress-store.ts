"use client";

import * as React from "react";

/** What the centered media-progress window shows. One job at a time (uploads run one after another). */
export type MediaJob = {
  name: string;
  /** bytes of the original file, once known */
  fromBytes: number;
  fromDrive: boolean;
  stage: "download" | "compress" | "upload";
  /** 0-100 for the current stage; null = indeterminate */
  percent: number | null;
  /** when the compression stage started (ms), for the time-left estimate */
  compressStartedAt: number | null;
  cancel: (() => void) | null;
};

let job: MediaJob | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const mediaJob = {
  start(init: Pick<MediaJob, "name" | "fromBytes" | "fromDrive" | "stage">) {
    job = { ...init, percent: init.stage === "compress" ? 0 : null, compressStartedAt: init.stage === "compress" ? Date.now() : null, cancel: null };
    emit();
  },
  update(patch: Partial<MediaJob>) {
    if (!job) return;
    const next = { ...job, ...patch };
    if (patch.stage === "compress" && job.stage !== "compress") next.compressStartedAt = Date.now();
    job = next;
    emit();
  },
  end() {
    job = null;
    emit();
  },
};

export function useMediaJob() {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => job,
    () => null,
  );
}
