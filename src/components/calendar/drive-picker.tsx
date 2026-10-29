"use client";

import * as React from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { attachDriveFileAction, drivePickerAction, type DrivePickerState } from "@/server/actions/drive";

// Minimal typing of the official Google Picker (https://developers.google.com/drive/picker).
type PickerDoc = { id: string; name: string; mimeType: string };
type PickerData = { action: string; docs?: PickerDoc[] };
type GoogleNS = {
  picker: {
    Action: { PICKED: string; CANCEL: string };
    ViewId: { DOCS_IMAGES_AND_VIDEOS: string };
    DocsView: new (viewId: string) => { setIncludeFolders(b: boolean): unknown; setMimeTypes(m: string): unknown };
    PickerBuilder: new () => PickerBuilderChain;
  };
};
type PickerBuilderChain = {
  addView(v: unknown): PickerBuilderChain; setOAuthToken(t: string): PickerBuilderChain; setDeveloperKey(k: string): PickerBuilderChain; setAppId(a: string): PickerBuilderChain;
  setCallback(cb: (d: PickerData) => void): PickerBuilderChain; setTitle(t: string): PickerBuilderChain; build(): { setVisible(v: boolean): void };
};
declare global { interface Window { gapi?: { load(lib: string, cb: () => void): void }; google?: GoogleNS } }

let pickerLib: Promise<void> | null = null;

/** True while Google's Picker is on screen: dialogs underneath must not close on clicks that land in it. */
export const isDrivePickerOpen = () => typeof document !== "undefined" && document.body.dataset.drivePicker === "open";
const setPickerOpen = (open: boolean) => { if (open) document.body.dataset.drivePicker = "open"; else delete document.body.dataset.drivePicker; };
function loadPicker() {
  pickerLib ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => window.gapi!.load("picker", () => resolve());
    s.onerror = () => { pickerLib = null; reject(new Error("Google Picker could not load. Check your connection or blockers.")); };
    document.head.appendChild(s);
  });
  return pickerLib;
}

/**
 * Google Drive tab: connect (once per project), then pick images/videos with Google's own Picker. Only the file id
 * and metadata are saved; the bytes are read through the Drive API when the post is published.
 */
export function DrivePicker({ projectId, itemId, onPicking, onAttached }: { projectId: string; itemId: string; onPicking: (open: boolean) => void; onAttached: () => void }) {
  const [state, setState] = React.useState<DrivePickerState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    drivePickerAction(projectId).then((r) => { if (!alive) return; if (r.ok) setState(r.data ?? null); else setError(r.error); });
    return () => { alive = false; };
  }, [projectId]);

  const open = async () => {
    if (!state?.picker) return;
    setBusy(true);
    try {
      await loadPicker();
      const g = window.google!.picker;
      const view = new g.DocsView(g.ViewId.DOCS_IMAGES_AND_VIDEOS);
      view.setIncludeFolders(true);
      view.setMimeTypes("image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime");
      onPicking(true);
      setPickerOpen(true);
      new g.PickerBuilder().addView(view).setOAuthToken(state.picker.accessToken).setDeveloperKey(state.picker.apiKey).setAppId(state.picker.appId).setTitle("Choose an image or a video")
        .setCallback(async (data: PickerData) => {
          if (data.action === g.Action.CANCEL) { setPickerOpen(false); onPicking(false); setBusy(false); return; }
          if (data.action !== g.Action.PICKED || !data.docs?.[0]) return;
          setPickerOpen(false);
          onPicking(false);
          const r = await attachDriveFileAction(projectId, itemId, data.docs[0].id);
          setBusy(false);
          if (!r.ok) return toast.error(r.error);
          toast.success(r.message ?? "Attached");
          onAttached();
        }).build().setVisible(true);
    } catch (e) {
      setPickerOpen(false);
      onPicking(false);
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Google Picker failed");
    }
  };

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!state) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;
  if (!state.configured) {
    return (
      <Alert title="Google Drive isn't set up on the server yet">
        It needs a Google Cloud OAuth client with the Drive and Picker APIs. Missing settings: {state.missing.join(", ")}. Until then, download the file and choose it from your computer.
      </Alert>
    );
  }
  if (!state.picker) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Connect this project to Google Drive once. Signal only gets access to the files you pick, never your whole Drive, and nothing is made public.</p>
        <Button asChild size="sm"><a href={`/api/drive/connect?project=${projectId}&back=calendar`}><HardDrive /> Connect Google Drive</a></Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">Connected as {state.email ?? "your Google account"}. The file stays in Drive: only its reference is saved, and it&apos;s read from Drive when the post is published.</p>
      <Button size="sm" onClick={open} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <HardDrive />} Choose from Google Drive</Button>
    </div>
  );
}
