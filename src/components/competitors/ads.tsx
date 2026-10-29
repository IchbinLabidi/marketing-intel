"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AD_PLATFORM_LABELS, parseAdLines, runningDays, type AdPlatform } from "@/lib/competitors/ads";
import { deleteCompetitorAdAction, saveCompetitorAdsAction, setCompetitorAdEndedAction } from "@/server/actions/competitors";
import type { CompetitorAd } from "@/server/services/competitors";

const todayLocal = () => new Date().toLocaleDateString("en-CA");

/**
 * Paid ads saved from Meta's public Ad Library. Kept apart from organic posts: Meta publishes no reach or spend
 * for these ads, so only what the Ad Library shows is recorded (dates, platforms, text).
 */
export function CompetitorAds({ projectId, competitorId, ads, readOnly, adLibraryHref }: {
  projectId: string; competitorId: string; ads: CompetitorAd[]; readOnly: boolean; adLibraryHref: string | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [today] = React.useState(todayLocal);
  const active = ads.filter((a) => !a.ended_on);
  const longest = [...ads].sort((a, b) => runningDays(b, today) - runningDays(a, today))[0];
  const act = async (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error ?? "Failed");
    router.refresh();
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold"><Megaphone className="size-4 text-muted-foreground" /> Ads (from Meta Ad Library)</p>
          <p className="text-xs text-muted-foreground">
            {ads.length ? `${ads.length} recorded · ${active.length} running${longest ? ` · longest: ${runningDays(longest, today)} days` : ""}` : "No ad recorded yet."} Paid ads, kept apart from organic posts. Meta publishes no reach or spend for them.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {adLibraryHref ? <Button asChild size="sm" variant="outline"><a href={adLibraryHref} target="_blank" rel="noreferrer"><ExternalLink /> Open Ad Library</a></Button> : null}
          {readOnly ? null : <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add ads</Button>}
        </div>
      </div>
      {ads.length ? (
        <ul className="divide-y rounded-lg border">
          {ads.map((a) => (
            <li key={a.id} className="grid gap-1.5 px-3 py-2.5 text-[13px] md:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant={a.ended_on ? "outline" : "success"} dot>{a.ended_on ? "Ended" : "Running"}</Badge>
                  <span className="tabular-nums text-muted-foreground">{a.started_on} → {a.ended_on ?? "today"} · {runningDays(a, today)} days</span>
                  {a.platforms.length ? <span className="text-xs text-muted-foreground">{a.platforms.map((p) => AD_PLATFORM_LABELS[p as AdPlatform] ?? p).join(", ")}</span> : null}
                  <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">ID {a.library_id} <ExternalLink className="size-3" /></a>
                </p>
                {a.body ? <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground" dir="auto">{a.body}</p> : <p className="text-xs text-muted-foreground">Text not recorded.</p>}
              </div>
              {readOnly ? null : (
                <div className="flex items-start gap-1 md:justify-end">
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(a.id, () => setCompetitorAdEndedAction(projectId, a.id, !a.ended_on))}>{a.ended_on ? "Mark running" : "Mark ended"}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" aria-label="Remove ad" disabled={busy !== null} onClick={() => act(a.id, () => deleteCompetitorAdAction(projectId, a.id))}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? <AddAds projectId={projectId} competitorId={competitorId} adLibraryHref={adLibraryHref} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

function AddAds({ projectId, competitorId, adLibraryHref, onClose }: { projectId: string; competitorId: string; adLibraryHref: string | null; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const rows = React.useMemo(() => parseAdLines(text, todayLocal()), [text]);
  const valid = rows.filter((r) => !r.error);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add ads from Meta&apos;s Ad Library</DialogTitle>
          <DialogDescription>
            {adLibraryHref ? <><a href={adLibraryHref} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">Open their Ad Library page</a>, then for each ad copy its Library ID (or the ad&apos;s link), start date and text. </> : "In Meta's Ad Library, open each ad and copy its Library ID (or link), start date and text. "}
            Saving an ad again updates it, for example to record that it ended.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-xs font-medium">
          One ad per line: Library ID or link, start date, end date or “active”, platforms, ad text
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} dir="auto" className="font-mono text-xs"
            placeholder={"1234567890123456, 20/10/2026, active, facebook instagram, Inscriptions ouvertes pour le Bac 2027…\n9876543210987654, 2026-09-01, 2026-09-30, fb, Promo rentrée -20%"} />
        </label>
        {rows.length ? (
          <div className="max-h-56 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left">Line</th><th className="text-left">Library ID</th><th className="text-left">Dates</th><th className="text-left">Platforms</th><th className="text-left">Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular-nums">{r.line}</td>
                    <td className="tabular-nums">{r.library_id ?? "—"}</td>
                    <td className="tabular-nums">{r.started_on ?? "—"} → {r.ended_on ?? "active"}</td>
                    <td>{r.platforms.map((p) => AD_PLATFORM_LABELS[p]).join(", ") || "—"}</td>
                    <td className={r.error ? "text-destructive" : "text-success"}>{r.error ?? "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !valid.length} onClick={async () => {
            setBusy(true);
            const r = await saveCompetitorAdsAction(projectId, competitorId, valid.map((v) => ({ line: v.line, library_id: v.library_id, started_on: v.started_on, ended_on: v.ended_on, platforms: v.platforms, body: v.body })));
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            if (r.data?.errors.length) toast.warning(`${r.message}: ${r.data.errors.map((e) => `line ${e.line} (${e.error})`).join(", ")}`);
            else toast.success(r.message);
            onClose();
            router.refresh();
          }}>{busy ? <Loader2 className="animate-spin" /> : null} Save {valid.length || ""} ad{valid.length === 1 ? "" : "s"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
