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
import { useT } from "@/i18n/client";

const todayLocal = () => new Date().toLocaleDateString("en-CA");

/**
 * Paid ads saved from Meta's public Ad Library. Kept apart from organic posts: Meta publishes no reach or spend
 * for these ads, so only what the Ad Library shows is recorded (dates, platforms, text).
 */
export function CompetitorAds({ projectId, competitorId, ads, readOnly, adLibraryHref }: {
  projectId: string; competitorId: string; ads: CompetitorAd[]; readOnly: boolean; adLibraryHref: string | null;
}) {
  const router = useRouter();
  const t = useT("competitors");
  const tc = useT("common");
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [today] = React.useState(todayLocal);
  const active = ads.filter((a) => !a.ended_on);
  const longest = [...ads].sort((a, b) => runningDays(b, today) - runningDays(a, today))[0];
  const act = async (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(r.message ?? tc("actions.done")); else toast.error(r.error ?? t("ads.failed"));
    router.refresh();
  };
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold"><Megaphone className="size-4 text-muted-foreground" /> {t("ads.title")}</p>
          <p className="text-xs text-muted-foreground">
            {ads.length ? `${t("ads.recorded", { count: ads.length })} · ${t("ads.running", { count: active.length })}${longest ? ` · ${t("ads.longest", { count: runningDays(longest, today) })}` : ""}` : t("ads.none")} {t("ads.paidNote")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {adLibraryHref ? <Button asChild size="sm" variant="outline"><a href={adLibraryHref} target="_blank" rel="noreferrer"><ExternalLink /> {t("ads.openLibrary")}</a></Button> : null}
          {readOnly ? null : <Button size="sm" onClick={() => setAdding(true)}><Plus /> {t("ads.add")}</Button>}
        </div>
      </div>
      {ads.length ? (
        <ul className="divide-y rounded-lg border">
          {ads.map((a) => (
            <li key={a.id} className="grid gap-1.5 px-3 py-2.5 text-[13px] md:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant={a.ended_on ? "outline" : "success"} dot>{a.ended_on ? t("ads.ended") : t("ads.runningBadge")}</Badge>
                  <span className="tabular-nums text-muted-foreground">{a.started_on} → {a.ended_on ?? t("ads.today")} · {tc("units.days", { count: runningDays(a, today) })}</span>
                  {a.platforms.length ? <span className="text-xs text-muted-foreground">{a.platforms.map((p) => AD_PLATFORM_LABELS[p as AdPlatform] ?? p).join(", ")}</span> : null}
                  <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{t("ads.id", { id: a.library_id })} <ExternalLink className="size-3" /></a>
                </p>
                {a.body ? <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground" dir="auto">{a.body}</p> : <p className="text-xs text-muted-foreground">{t("ads.noText")}</p>}
              </div>
              {readOnly ? null : (
                <div className="flex items-start gap-1 md:justify-end">
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(a.id, () => setCompetitorAdEndedAction(projectId, a.id, !a.ended_on))}>{a.ended_on ? t("ads.markRunning") : t("ads.markEnded")}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" aria-label={t("ads.remove")} disabled={busy !== null} onClick={() => act(a.id, () => deleteCompetitorAdAction(projectId, a.id))}><Trash2 /></Button>
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
  const t = useT("competitors");
  const tc = useT("common");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const rows = React.useMemo(() => parseAdLines(text, todayLocal(), t), [text, t]);
  const valid = rows.filter((r) => !r.error);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ads.addTitle")}</DialogTitle>
          <DialogDescription>
            {adLibraryHref ? <>{t.rich("ads.addWithLink", { link: (c) => <a href={adLibraryHref} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{c}</a> })} </> : `${t("ads.addWithoutLink")} `}
            {t("ads.addUpdateNote")}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-xs font-medium">
          {t("ads.lineFormat")}
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} dir="auto" className="font-mono text-xs"
            placeholder={"1234567890123456, 20/10/2026, active, facebook instagram, Inscriptions ouvertes pour le Bac 2027…\n9876543210987654, 2026-09-01, 2026-09-30, fb, Promo rentrée -20%"} />
        </label>
        {rows.length ? (
          <div className="max-h-56 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead><tr><th className="text-left">{t("bulk.line")}</th><th className="text-left">{t("ads.libraryId")}</th><th className="text-left">{t("ads.dates")}</th><th className="text-left">{t("ads.platforms")}</th><th className="text-left">{t("bulk.status")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular-nums">{r.line}</td>
                    <td className="tabular-nums">{r.library_id ?? "—"}</td>
                    <td className="tabular-nums">{r.started_on ?? "—"} → {r.ended_on ?? t("ads.active")}</td>
                    <td>{r.platforms.map((p) => AD_PLATFORM_LABELS[p]).join(", ") || "—"}</td>
                    <td className={r.error ? "text-destructive" : "text-success"}>{r.error ?? t("bulk.ready")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button>
          <Button disabled={busy || !valid.length} onClick={async () => {
            setBusy(true);
            const r = await saveCompetitorAdsAction(projectId, competitorId, valid.map((v) => ({ line: v.line, library_id: v.library_id, started_on: v.started_on, ended_on: v.ended_on, platforms: v.platforms, body: v.body })));
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            if (r.data?.errors.length) toast.warning(t("bulk.skipped", { message: r.message ?? "", lines: r.data.errors.map((e) => t("bulk.lineError", { line: e.line, error: e.error })).join(", ") }));
            else toast.success(r.message);
            onClose();
            router.refresh();
          }}>{busy ? <Loader2 className="animate-spin" /> : null} {valid.length ? t("ads.saveN", { count: valid.length }) : t("ads.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
