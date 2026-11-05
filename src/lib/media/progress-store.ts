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
  /** shown as a small card in the bottom-right corner instead of the centered window */
  minimized: boolean;
};

let job: MediaJob | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const mediaJob = {
  start(init: Pick<MediaJob, "name" | "fromBytes" | "fromDrive" | "stage">) {
    job = { ...init, percent: init.stage === "compress" ? 0 : null, compressStartedAt: init.stage === "compress" ? Date.now() : null, cancel: null, minimized: false };
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

/**
 * Dialogs underneath treat clicks on the progress window as "outside" and would close. Radix handles that after the
 * click, when the clicked button may already be gone (minimize swaps the window for the card), so the window marks
 * its own pointer presses and dialogs check the mark.
 */
let lastPress = 0;
export const markMediaPress = () => { lastPress = Date.now(); };
export const isMediaPress = (target: EventTarget | null) =>
  (target instanceof Element && Boolean(target.closest("[data-media-progress]"))) || Date.now() - lastPress < 1500;
