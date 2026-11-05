"use client";

import * as React from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { compressVideo, needsCompression, VideoTooLongError } from "@/lib/media/compress-video";
import { finishMediaUploadAction, mediaUploadTicketAction } from "@/server/actions/production";
import { useT } from "@/i18n/client";

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Stores a file on a content item (production-media bucket). Videos over the 50 MB storage limit are compressed in
 * the browser first, with a progress toast. Returns the new asset id; throws with a readable message on failure.
 */
export function useMediaUpload(projectId: string) {
  const t = useT("publishing");
  const shrink = React.useCallback(
    async (file: File): Promise<File> => {
      if (!needsCompression(file)) return file;
      const toastId = toast.loading(t("compress.working", { name: file.name, percent: 0 }));
      try {
        let last = -1;
        const small = await compressVideo(file, file.name, (share) => {
          const percent = Math.floor(share * 100);
          if (percent !== last) { last = percent; toast.loading(t("compress.working", { name: file.name, percent }), { id: toastId }); }
        });
        toast.success(t("compress.done", { name: file.name, from: mb(file.size), to: mb(small.size) }), { id: toastId });
        return small;
      } catch (e) {
        toast.dismiss(toastId);
        if (e instanceof VideoTooLongError) throw new Error(t("compress.tooLong", { name: file.name }));
        throw new Error(t("compress.failed", { name: file.name, error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [t],
  );

  const upload = React.useCallback(
    async (itemId: string, original: File): Promise<string> => {
      const file = await shrink(original);
      const ticket = await mediaUploadTicketAction(projectId, itemId, file.name, file.type, file.size);
      if (!ticket.ok || !ticket.data) throw new Error(ticket.ok ? t("compress.uploading", { name: file.name }) : ticket.error);
      const { error } = await createClient().storage.from("production-media").uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
      if (error) throw error;
      const done = await finishMediaUploadAction(projectId, itemId, ticket.data.path, file.name, file.type);
      if (!done.ok || !done.data) throw new Error(done.ok ? t("compress.uploading", { name: file.name }) : done.error);
      return done.data.id;
    },
    [projectId, shrink, t],
  );

  /** A Google Drive video too large to publish: download it with the picker's token, then compress and store it. */
  const uploadFromDrive = React.useCallback(
    async (itemId: string, doc: { id: string; name: string; mimeType: string }, accessToken: string): Promise<string> => {
      const toastId = toast.loading(t("compress.downloading", { name: doc.name }));
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
      if (!res?.ok) { toast.dismiss(toastId); throw new Error(t("compress.downloadFailed", { name: doc.name })); }
      const blob = await res.blob();
      toast.dismiss(toastId);
      return upload(itemId, new File([blob], doc.name, { type: doc.mimeType || blob.type || "video/mp4" }));
    },
    [t, upload],
  );

  return { upload, uploadFromDrive };
}
