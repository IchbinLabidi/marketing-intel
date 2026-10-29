"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, ExternalLink, HardDrive, Laptop, Loader2, RefreshCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { validateLocalFile, type PublishTarget } from "@/lib/publishing/rules";
import { utcToZoned, zonedToUtc } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import { checkPublicationAction, publishContextAction, publishPostAction, type Publication, type PublishContext } from "@/server/actions/publishing";
import { finishMediaUploadAction, mediaUploadTicketAction } from "@/server/actions/production";
import type { ContentItem } from "@/types/domain";
import { DrivePicker } from "./drive-picker";
import { DeleteMediaDialog, Maximize2, MediaLightbox, MediaPreview, TileButton, Trash2, type TileAsset } from "./media-tile";

const STATUS: Record<string, { label: string; tone: "success" | "info" | "warning" | "destructive" | "outline" }> = {
  published: { label: "Published", tone: "success" }, scheduled: { label: "Scheduled on Facebook", tone: "info" }, processing: { label: "Processing", tone: "info" },
  uploading: { label: "Sending…", tone: "info" }, queued: { label: "Queued", tone: "outline" }, failed: { label: "Failed", tone: "destructive" }, cancelled: { label: "Cancelled", tone: "outline" },
};
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/**
 * Select media and publish an approved post to the connected Facebook Page / Instagram account.
 * A file from the computer is only previewed until the person explicitly keeps it for publishing (upload to the
 * project's private storage); nothing is uploaded just by selecting it.
 */
export function PublishDialog({ projectId, post, tz, onClose, onPublished }: { projectId: string; post: ContentItem; tz: string; onClose: () => void; onPublished: () => void }) {
  const [ctx, setCtx] = React.useState<PublishContext | null>(null);
  const [tab, setTab] = React.useState<"post" | "computer" | "drive">("post");
  const [assetIds, setAssetIds] = React.useState<string[] | null>(null); // selection order = carousel order
  const [local, setLocal] = React.useState<{ file: File; url: string; error: string | null } | null>(null);
  const [targets, setTargets] = React.useState<PublishTarget[]>(post.platform === "instagram" ? ["instagram"] : ["facebook"]);
  const [when, setWhen] = React.useState<"now" | "schedule">("now");
  const initial = post.scheduled_at ? utcToZoned(post.scheduled_at, tz) : null;
  const [date, setDate] = React.useState(initial?.date ?? post.scheduled_date ?? "");
  const [time, setTime] = React.useState(initial?.time ?? "09:00");
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [zoom, setZoom] = React.useState<{ list: TileAsset[]; index: number } | null>(null);
  const [toDelete, setToDelete] = React.useState<TileAsset | null>(null); // Google's Picker opens over the page: the dialog stops trapping focus meanwhile

  const load = React.useCallback(async () => {
    const r = await publishContextAction(projectId, post.id);
    if (r.ok && r.data) {
      setCtx(r.data);
      setAssetIds((cur) => cur ?? (r.data!.assets[0] ? [r.data!.assets[0].id] : []));
    }
  }, [projectId, post.id]);
  React.useEffect(() => {
    let alive = true;
    publishContextAction(projectId, post.id).then((r) => {
      if (!alive || !r.ok || !r.data) return;
      setCtx(r.data);
      setAssetIds((cur) => cur ?? (r.data!.assets[0] ? [r.data!.assets[0].id] : []));
    });
    return () => { alive = false; };
  }, [projectId, post.id]);
  React.useEffect(() => () => { if (local) URL.revokeObjectURL(local.url); }, [local]);

  const selected = (assetIds ?? []).map((id) => ctx?.assets.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const toggleAsset = (id: string) => setAssetIds((cur) => ((cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id]));
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (local) URL.revokeObjectURL(local.url);
    setLocal({ file, url: URL.createObjectURL(file), error: validateLocalFile(file) });
  };
  const keep = async () => {
    if (!local || local.error) return;
    setBusy("keep");
    try {
      const ticket = await mediaUploadTicketAction(projectId, post.id, local.file.name, local.file.type, local.file.size);
      if (!ticket.ok || !ticket.data) throw new Error(ticket.ok ? "Could not prepare the upload." : ticket.error);
      const { error } = await createClient().storage.from("production-media").uploadToSignedUrl(ticket.data.path, ticket.data.token, local.file, { contentType: local.file.type });
      if (error) throw error;
      const done = await finishMediaUploadAction(projectId, post.id, ticket.data.path, local.file.name, local.file.type);
      if (!done.ok) throw new Error(done.error);
      toast.success("File kept for publishing");
      URL.revokeObjectURL(local.url);
      setLocal(null);
      setAssetIds(null);
      await load();
      setTab("post");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    setBusy("publish");
    const scheduleAt = when === "schedule" && date && time ? new Date(zonedToUtc(date, time, tz)).toISOString() : null;
    const r = await publishPostAction(projectId, post.id, { targets, mediaAssetIds: selected.map((a) => a.id), scheduleAt, allowTemporaryLink: consent });
    setBusy(null);
    if (!r.ok) { toast.error(r.error); await load(); return; }
    toast.success(r.message ?? "Done");
    await load();
    onPublished();
  };
  const check = async (p: Publication) => {
    setBusy(p.id);
    const r = await checkPublicationAction(projectId, p.id);
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "Updated"); else toast.error(r.error);
    await load();
    onPublished();
  };

  const needsConsent = targets.includes("instagram") && selected.some((a) => a.source === "stored" || a.source === "google_drive");
  const approved = ["approved", "scheduled"].includes(post.status);
  const toggle = (t: PublishTarget) => setTargets((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const done = (t: PublishTarget) => ctx?.publications.find((p) => p.provider === t && ["published", "scheduled", "processing", "uploading"].includes(p.status));

  return (
    <Dialog open modal={!picking} onOpenChange={(o) => !o && !busy && !picking && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="size-4" /> Publish “{post.title}”</DialogTitle>
          <DialogDescription>Choose the media, the accounts and when. The caption, CTA and hashtags of the post are used as written.</DialogDescription>
        </DialogHeader>
        {!ctx ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : (
          <div className="space-y-4 text-[13px]">
            {!approved ? <Alert variant="warning">Only approved posts can be published. Approve it in Content Production first.</Alert> : null}
            {!ctx.facebook ? <Alert variant="warning">Connect Meta on the Integrations page to publish.</Alert> : null}
            {ctx.facebook && ctx.missingScopes.length ? (
              <Alert variant="warning" title="Publishing permission needed">
                Meta access is read-only for now. <a className="font-medium text-primary hover:underline" href={`/api/meta/connect?project=${projectId}&publish=1`}>Enable publishing</a> (you&apos;ll confirm {ctx.missingScopes.join(" and ")} on Facebook). As an admin of the Meta app you can publish right away; other team members need Meta App Review first.
              </Alert>
            ) : null}

            {/* Media */}
            <section className="space-y-2">
              <p className="font-medium">Media</p>
              <div role="tablist" className="inline-flex gap-0.5 rounded-md bg-secondary p-0.5">
                {([["post", "On this post", CheckCircle2], ["computer", "From your computer", Laptop], ["drive", "Google Drive", HardDrive]] as const).map(([k, label, Icon]) => (
                  <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium", tab === k ? "bg-card shadow-xs" : "text-muted-foreground")}>
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
              {tab === "post" ? (
                ctx.assets.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button type="button" onClick={() => setAssetIds([])} className={cn("flex h-32 items-center justify-center rounded-lg border text-xs text-muted-foreground", !selected.length && "ring-2 ring-primary")}>No media</button>
                    {ctx.assets.map((a) => (
                      <div key={a.id} className={cn("group relative h-32 overflow-hidden rounded-lg border bg-muted", selected.includes(a) && "ring-2 ring-primary")}>
                        <button type="button" aria-pressed={selected.includes(a)} onClick={() => toggleAsset(a.id)} title={`Select ${a.name}`} className="absolute inset-0">
                          <MediaPreview asset={a} className="size-full" />
                        </button>
                        {selected.includes(a) ? <span className="pointer-events-none absolute left-1 top-1 z-10 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{selected.indexOf(a) + 1}</span> : null}
                        <div className="absolute right-1 top-1 z-10 flex gap-1">
                          <TileButton label={`View ${a.name} larger`} onClick={() => setZoom({ list: ctx.assets, index: ctx.assets.indexOf(a) })}><Maximize2 className="size-3.5" /></TileButton>
                          <TileButton label={`Delete ${a.name}`} danger onClick={() => setToDelete(a)}><Trash2 className="size-3.5" /></TileButton>
                        </div>
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-background/80 px-1 text-[10px]">{a.source === "stored" ? "Stored" : a.source === "link" ? "Link" : "Drive"} · {a.name}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-muted-foreground">No media attached yet. Choose a file from your computer, or publish text only on Facebook.</p>
              ) : null}
              {tab === "post" && ctx.assets.length > 1 ? <p className="text-xs text-muted-foreground">Click several photos to publish them together (Instagram carousel or Facebook multi-photo post, up to 10). The numbers show the order.</p> : null}
              {tab === "post" && selected.length > 1 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Carousel order</p>
                  <ol className="flex gap-2 overflow-x-auto pb-1">
                    {selected.map((a, i) => (
                      <li key={a.id} className="relative shrink-0">
                        <button type="button" onClick={() => setZoom({ list: selected, index: i })} className="block size-16 overflow-hidden rounded-md border bg-muted" aria-label={`View photo ${i + 1}, ${a.name}`}>
                          <MediaPreview asset={a} className="size-full" />
                        </button>
                        <span className="absolute left-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{i + 1}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {tab === "post" ? null : tab === "computer" ? (
                <div className="space-y-2">
                  <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose a file from your computer" />
                  {local ? (
                    <div className="flex gap-3 rounded-lg border p-2">
                      {local.file.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview (blob:)
                        <img src={local.url} alt="" className="size-24 rounded object-cover" />
                      ) : <video src={local.url} controls className="h-24 rounded" />}
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium">{local.file.name}</p>
                        <p className="text-xs text-muted-foreground">{local.file.type || "unknown type"} · {fmtSize(local.file.size)}</p>
                        {local.error ? <p className="text-xs text-destructive">{local.error}</p> : (
                          <>
                            <p className="text-xs text-muted-foreground">Only on this computer for now: nothing has been uploaded. It disappears when you close this window, so it can&apos;t be used for a later publication until you keep it.</p>
                            <Button size="sm" disabled={busy !== null} onClick={keep}>{busy === "keep" ? <Loader2 className="animate-spin" /> : null} Keep for publishing (upload to the project&apos;s private storage)</Button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <DrivePicker projectId={projectId} itemId={post.id} onPicking={setPicking} onAttached={async (ids) => { setAssetIds(ids); await load(); setTab("post"); }} />
              )}
            </section>

            {/* Accounts */}
            <section className="space-y-2">
              <p className="font-medium">Publish to</p>
              {([["facebook", ctx.facebook], ["instagram", ctx.instagram]] as const).map(([t, acc]) => (
                <label key={t} className={cn("flex items-center gap-2", !acc && "opacity-50")}>
                  <input type="checkbox" checked={targets.includes(t)} disabled={!acc || Boolean(done(t))} onChange={() => toggle(t)} />
                  {t === "facebook" ? "Facebook" : "Instagram"} {acc ? <span className="text-muted-foreground">· {acc.name}</span> : <span className="text-muted-foreground">· not connected</span>}
                  {done(t) ? <Badge variant="outline">already {done(t)!.status}</Badge> : null}
                </label>
              ))}
              {needsConsent ? (
                <label className="flex items-start gap-2 rounded-lg border border-warning/40 p-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>Instagram only accepts media by link. Allow a private link to this file that only works for 1 hour, for Instagram to download it. The file stays private otherwise.</span>
                </label>
              ) : null}
            </section>

            {/* When */}
            <section className="space-y-2">
              <p className="font-medium">When</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5"><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Now</label>
                <label className={cn("flex items-center gap-1.5", targets.includes("instagram") && "opacity-50")}>
                  <input type="radio" checked={when === "schedule"} disabled={targets.includes("instagram")} onChange={() => setWhen("schedule")} /> Schedule on Facebook
                </label>
                {when === "schedule" ? <><Input type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} /><Input type="time" className="h-8 w-28" value={time} onChange={(e) => setTime(e.target.value)} /><span className="text-xs text-muted-foreground">{tz}</span></> : null}
              </div>
              <p className="text-xs text-muted-foreground">Facebook keeps the scheduled post and publishes it itself (10 minutes to 30 days ahead). Instagram can&apos;t be scheduled through its API: publish it at the right time.</p>
            </section>

            {/* Status */}
            {ctx.publications.length ? (
              <section className="space-y-1.5">
                <p className="font-medium">Status</p>
                <ul className="divide-y rounded-lg border">
                  {ctx.publications.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="font-medium">{p.provider === "facebook" ? "Facebook" : "Instagram"}</span>
                      <Badge variant={STATUS[p.status]?.tone ?? "outline"} dot>{STATUS[p.status]?.label ?? p.status}</Badge>
                      {p.scheduled_for ? <span className="text-xs text-muted-foreground">{new Date(p.scheduled_for).toLocaleString("en-GB", { timeZone: tz })}</span> : null}
                      {p.platform_url ? <a href={p.platform_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">View post <ExternalLink className="size-3" /></a> : null}
                      {p.status === "processing" ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => check(p)}><RefreshCcw /> Check again</Button> : null}
                      {p.error ? <p className="basis-full text-xs text-destructive"><CircleAlert className="mr-1 inline size-3" />{p.error}{p.error_kind === "transient" ? " You can try again." : ""}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>Close</Button>
          <Button disabled={!ctx || busy !== null || !approved || !targets.length || !ctx.facebook || (needsConsent && !consent) || targets.every((t) => done(t))} onClick={publish}>
            {busy === "publish" ? <Loader2 className="animate-spin" /> : <Send />} {when === "schedule" ? "Schedule" : "Publish now"}
          </Button>
        </DialogFooter>
      </DialogContent>
      {zoom ? <MediaLightbox assets={zoom.list} index={zoom.index} onIndex={(index) => setZoom({ ...zoom, index })} onClose={() => setZoom(null)} /> : null}
      {toDelete ? (
        <DeleteMediaDialog projectId={projectId} itemId={post.id} asset={toDelete} onClose={() => setToDelete(null)}
          onDeleted={async (id) => { setToDelete(null); setAssetIds((cur) => (cur ?? []).filter((x) => x !== id)); setCtx((c) => (c ? { ...c, assets: c.assets.filter((x) => x.id !== id) } : c)); await load(); }} />
      ) : null}
    </Dialog>
  );
}
