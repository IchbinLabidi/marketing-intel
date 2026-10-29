"use client";

import * as React from "react";
import { ImageOff, Loader2, Maximize2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mediaKindOf } from "@/lib/publishing/rules";
import { cn } from "@/lib/utils";
import { deleteMediaAction } from "@/server/actions/media";

export type TileAsset = { id: string; name: string; mime: string | null; source: "stored" | "link" | "google_drive"; previewUrl: string | null; fullUrl: string | null };

/** A media preview that shows its loading and error states instead of a blank box. */
export function MediaPreview({ asset, full, className }: { asset: TileAsset; full?: boolean; className?: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const src = full ? asset.fullUrl ?? asset.previewUrl : asset.previewUrl;
  const kind = mediaKindOf(asset.mime);
  if (!src || !kind) return <div className={cn("flex items-center justify-center p-2 text-center text-xs text-muted-foreground", className)}>{asset.name}</div>;
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {state === "loading" ? <Loader2 className="absolute size-5 animate-spin text-muted-foreground" aria-label="Loading preview" /> : null}
      {state === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
          <ImageOff className="size-4" /> Preview unavailable{asset.source === "google_drive" ? ": the Drive file may have been deleted, or Drive needs reconnecting" : ""}
        </div>
      ) : null}
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, authenticated media route (not optimizable)
        <img src={src} alt={asset.name} loading="lazy" onLoad={() => setState("ready")} onError={() => setState("error")}
          className={cn("size-full", full ? "object-contain" : "object-cover", state !== "ready" && "opacity-0")} />
      ) : (
        <video src={src} muted={!full} controls={full} preload="metadata" onLoadedData={() => setState("ready")} onError={() => setState("error")}
          className={cn("size-full", full ? "object-contain" : "object-cover", state !== "ready" && "opacity-0")} />
      )}
    </div>
  );
}

/** Full-size view of one media item (original quality and aspect ratio), with arrows when several are shown. */
export function MediaLightbox({ assets, index, onIndex, onClose }: { assets: TileAsset[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = assets[index];
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && index < assets.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, assets.length, onIndex]);
  if (!a) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-2rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate">{a.name}</DialogTitle>
          <DialogDescription>{assets.length > 1 ? `${index + 1} of ${assets.length} · use the arrow keys to move` : "Original quality"}</DialogDescription>
        </DialogHeader>
        <MediaPreview key={a.id} asset={a} full className="h-[70dvh] w-full rounded-lg bg-muted/40" />
        {assets.length > 1 ? (
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" disabled={index === 0} onClick={() => onIndex(index - 1)}>Previous</Button>
            <Button variant="outline" disabled={index === assets.length - 1} onClick={() => onIndex(index + 1)}>Next</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Confirms, then permanently deletes one attachment (file in storage and its record). */
export function DeleteMediaDialog({ projectId, itemId, asset, onClose, onDeleted }: { projectId: string; itemId: string; asset: TileAsset; onClose: () => void; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const drive = asset.source === "google_drive";
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{asset.name}”?</DialogTitle>
          <DialogDescription>
            {drive
              ? "It's removed from this post. Signal never stored a copy, and the original stays in your Google Drive."
              : asset.source === "stored"
                ? "The file is deleted permanently from Signal's storage, freeing its space. This can't be undone."
                : "The link is removed from this post."}
          </DialogDescription>
        </DialogHeader>
        <MediaPreview asset={asset} className="h-40 w-full overflow-hidden rounded-lg bg-muted" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await deleteMediaAction(projectId, itemId, asset.id);
            setBusy(false);
            if (!r.ok) { toast.error(r.error); return; }
            toast.success(r.message ?? "Deleted");
            onDeleted(asset.id);
          }}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 />} {drive ? "Remove from post" : "Delete permanently"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const TileButton = ({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
  <button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={cn("flex size-7 items-center justify-center rounded-md bg-background/85 shadow-xs backdrop-blur hover:bg-background", danger && "text-destructive")}>
    {children}
  </button>
);
export { Maximize2, Trash2 };
