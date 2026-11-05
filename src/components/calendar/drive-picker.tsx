"use client";

import * as React from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { attachDriveFileAction, drivePickerAction, type DrivePickerState } from "@/server/actions/drive";
import { useT } from "@/i18n/client";
import { useMediaUpload } from "@/components/media/use-media-upload";
import { needsCompression } from "@/lib/media/compress-video";

// Minimal typing of the official Google Picker (https://developers.google.com/drive/picker).
type PickerDoc = { id: string; name: string; mimeType: string; sizeBytes?: number | string };
type PickerData = { action: string; docs?: PickerDoc[] };
type GoogleNS = {
  picker: {
    Action: { PICKED: string; CANCEL: string };
    Feature: { MULTISELECT_ENABLED: string };
    ViewId: { DOCS_IMAGES_AND_VIDEOS: string };
    DocsView: new (viewId: string) => { setIncludeFolders(b: boolean): unknown; setMimeTypes(m: string): unknown };
    PickerBuilder: new () => PickerBuilderChain;
  };
};
type PickerBuilderChain = {
  addView(v: unknown): PickerBuilderChain; enableFeature(f: string): PickerBuilderChain; setOAuthToken(t: string): PickerBuilderChain; setDeveloperKey(k: string): PickerBuilderChain; setAppId(a: string): PickerBuilderChain;
  setCallback(cb: (d: PickerData) => void): PickerBuilderChain; setTitle(t: string): PickerBuilderChain; build(): { setVisible(v: boolean): void };
};
declare global { interface Window { gapi?: { load(lib: string, cb: () => void): void }; google?: GoogleNS } }

let pickerLib: Promise<void> | null = null;

/** True while Google's Picker is on screen: dialogs underneath must not close on clicks that land in it. */
export const isDrivePickerOpen = () => typeof document !== "undefined" && document.body.dataset.drivePicker === "open";
const setPickerOpen = (open: boolean) => { if (open) document.body.dataset.drivePicker = "open"; else delete document.body.dataset.drivePicker; };
function loadPicker(loadError: string) {
  pickerLib ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => window.gapi!.load("picker", () => resolve());
    s.onerror = () => { pickerLib = null; reject(new Error(loadError)); };
    document.head.appendChild(s);
  });
  return pickerLib;
}

/**
 * Google Drive tab: connect (once per project), then pick images/videos with Google's own Picker. Only the file id
 * and metadata are saved; the bytes are read through the Drive API when the post is published.
 */
export function DrivePicker({ projectId, itemId, onPicking, onAttached, back = "calendar" }: { projectId: string; itemId: string; onPicking: (open: boolean) => void; onAttached: (assetIds: string[]) => void; back?: "calendar" | "production" }) {
  const t = useT("calendar");
  const [state, setState] = React.useState<DrivePickerState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { uploadFromDrive } = useMediaUpload(projectId);
  React.useEffect(() => {
    let alive = true;
    drivePickerAction(projectId).then((r) => { if (!alive) return; if (r.ok) setState(r.data ?? null); else setError(r.error); });
    return () => { alive = false; };
  }, [projectId]);

  const connectHref = `/api/drive/connect?project=${projectId}&back=${back}${back === "production" ? `&item=${itemId}` : ""}`;
  const open = async () => {
    if (!state?.picker) return;
    setBusy(true);
    try {
      await loadPicker(t("drive.loadError"));
      const g = window.google!.picker;
      const view = new g.DocsView(g.ViewId.DOCS_IMAGES_AND_VIDEOS);
      view.setIncludeFolders(true);
      view.setMimeTypes("image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime");
      onPicking(true);
      setPickerOpen(true);
      new g.PickerBuilder().addView(view).enableFeature(g.Feature.MULTISELECT_ENABLED).setOAuthToken(state.picker.accessToken).setDeveloperKey(state.picker.apiKey).setAppId(state.picker.appId).setTitle(t("drive.pickerTitle"))
        .setCallback(async (data: PickerData) => {
          if (data.action === g.Action.CANCEL) { setPickerOpen(false); onPicking(false); setBusy(false); return; }
          if (data.action !== g.Action.PICKED || !data.docs?.[0]) return;
          setPickerOpen(false);
          onPicking(false);
          const ids: string[] = [];
          for (const doc of data.docs.slice(0, 10)) {
            // a video over the 50 MB publishing limit is downloaded, compressed in the browser and stored instead
            if (needsCompression({ type: doc.mimeType, size: Number(doc.sizeBytes ?? 0) })) {
              try { ids.push(await uploadFromDrive(itemId, doc, state.picker!.accessToken)); }
              catch (e) { toast.error(t("drive.fileError", { name: doc.name, error: e instanceof Error ? e.message : String(e) })); }
              continue;
            }
            const r = await attachDriveFileAction(projectId, itemId, doc.id);
            if (!r.ok) toast.error(t("drive.fileError", { name: doc.name, error: r.error }));
            else if (r.data) ids.push(r.data.id);
          }
          setBusy(false);
          if (data.docs.length > 10) toast.info(t("drive.onlyFirst"));
          if (!ids.length) return;
          toast.success(t("drive.attached", { count: ids.length }));
          onAttached(ids);
        }).build().setVisible(true);
    } catch (e) {
      setPickerOpen(false);
      onPicking(false);
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("drive.failed"));
    }
  };

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!state) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;
  if (!state.configured) {
    return (
      <Alert title={t("drive.notConfiguredTitle")}>
        {t("drive.notConfiguredBody", { missing: state.missing.join(", ") })}
      </Alert>
    );
  }
  if (!state.picker) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">{t("drive.connectIntro")}</p>
        <Button asChild size="sm"><a href={connectHref}><HardDrive /> {t("drive.connect")}</a></Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">{t("drive.connectedAs", { email: state.email ?? t("drive.yourAccount") })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={open} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <HardDrive />} {t("drive.choose")}</Button>
        <Button asChild size="sm" variant="ghost"><a href={connectHref} title={t("drive.otherAccountHint")}>{t("drive.otherAccount")}</a></Button>
      </div>
    </div>
  );
}
