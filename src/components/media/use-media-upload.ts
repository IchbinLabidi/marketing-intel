"use client";

import * as React from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { CompressionCanceledError, compressVideo, needsCompression, VideoTooLongError } from "@/lib/media/compress-video";
import { mediaJob } from "@/lib/media/progress-store";
import { finishMediaUploadAction, mediaUploadTicketAction } from "@/server/actions/production";
import { useT } from "@/i18n/client";

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Stores a file on a content item (production-media bucket). Videos over the 50 MB storage limit are compressed in
 * the browser first; progress shows in the centered MediaProgressOverlay. Returns the new asset id; throws with a
 * readable message on failure.
 */
export function useMediaUpload(projectId: string) {
  const t = useT("publishing");

  const store = React.useCallback(
    async (itemId: string, file: File): Promise<string> => {
      const ticket = await mediaUploadTicketAction(projectId, itemId, file.name, file.type, file.size);
      if (!ticket.ok || !ticket.data) throw new Error(ticket.ok ? t("compress.uploadFailed", { name: file.name }) : ticket.error);
      const { error } = await createClient().storage.from("production-media").uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
      if (error) throw error;
      const done = await finishMediaUploadAction(projectId, itemId, ticket.data.path, file.name, file.type);
      if (!done.ok || !done.data) throw new Error(done.ok ? t("compress.uploadFailed", { name: file.name }) : done.error);
      return done.data.id;
    },
    [projectId, t],
  );

  /** Compresses (with the progress window open) then stores. `fromDrive` keeps the download step in the window. */
  const compressAndStore = React.useCallback(
    async (itemId: string, file: File, fromDrive: boolean): Promise<string> => {
      if (fromDrive) mediaJob.update({ stage: "compress", percent: 0, fromBytes: file.size });
      else mediaJob.start({ name: file.name, fromBytes: file.size, fromDrive: false, stage: "compress" });
      try {
        let small: File;
        try {
          let last = -1;
          small = await compressVideo(
            file,
            file.name,
            (share) => {
              const percent = Math.floor(share * 100);
              if (percent !== last) { last = percent; mediaJob.update({ percent }); }
            },
            (cancel) => mediaJob.update({ cancel }),
          );
        } catch (e) {
          if (e instanceof CompressionCanceledError) throw new Error(t("compress.canceled", { name: file.name }));
          if (e instanceof VideoTooLongError) throw new Error(t("compress.tooLong", { name: file.name }));
          throw new Error(t("compress.failed", { name: file.name, error: e instanceof Error ? e.message : String(e) }));
        }
        mediaJob.update({ stage: "upload", percent: null, cancel: null });
        const id = await store(itemId, small);
        toast.success(t("compress.done", { name: file.name, from: mb(file.size), to: mb(small.size) }));
        return id;
      } finally {
        mediaJob.end();
      }
    },
    [store, t],
  );

  const upload = React.useCallback(
    (itemId: string, file: File): Promise<string> => (needsCompression(file) ? compressAndStore(itemId, file, false) : store(itemId, file)),
    [compressAndStore, store],
  );

  /** A Google Drive video too large to publish: download it with the picker's token, then compress and store it. */
  const uploadFromDrive = React.useCallback(
    async (itemId: string, doc: { id: string; name: string; mimeType: string; sizeBytes?: number | string }, accessToken: string): Promise<string> => {
      const total = Number(doc.sizeBytes ?? 0);
      mediaJob.start({ name: doc.name, fromBytes: total, fromDrive: true, stage: "download" });
      let blob: Blob;
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        // read the stream ourselves so the window can show download progress
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          received += value.byteLength;
          if (total) mediaJob.update({ percent: Math.min(99, Math.floor((received / total) * 100)) });
        }
        blob = new Blob(parts as BlobPart[], { type: doc.mimeType || "video/mp4" });
      } catch {
        mediaJob.end();
        throw new Error(t("compress.downloadFailed", { name: doc.name }));
      }
      return compressAndStore(itemId, new File([blob], doc.name, { type: doc.mimeType || blob.type || "video/mp4" }), true);
    },
    [compressAndStore, t],
  );

  return { upload, uploadFromDrive };
}
