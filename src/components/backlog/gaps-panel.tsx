"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pencil, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Gap } from "@/lib/backlog/planner";
import { SIDES, type AudienceMix, type Side } from "@/lib/backlog/audience";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { saveAudienceMixAction } from "@/server/actions/backlog";
import { PlannerDialog } from "./planner-dialog";

const KEY = "calendar.dismissedGaps";
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
type Pillar = { id: string; name: string; segment?: string; target_share?: number | null };
type Dist = { total: number; counts: Record<Side | "unset", number>; pct: Record<Side | "unset", number> };
const BAR: Record<Side, string> = { students_parents: "bg-primary", teachers: "bg-warning", both: "bg-success" };

/** Non-intrusive calendar hints, the audience distribution against the brand's mix, and the Planner. */
export function GapsPanel({ projectId, gaps, today, tz, pillars, canEdit, canAdmin, mix, dist }: {
  projectId: string; gaps: Gap[]; today: string; tz: string; pillars: Pillar[]; canEdit: boolean; canAdmin: boolean; mix: AudienceMix | null; dist: Dist;
}) {
  const t = useT("backlog");
  const td = useT("domain");
  const router = useRouter();
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [planning, setPlanning] = React.useState(false);
  const [editMix, setEditMix] = React.useState(false);
  // browser storage is read after mount (it isn't available while rendering on the server)
  React.useEffect(() => { const d = readDismissed(); if (d.length) queueMicrotask(() => setDismissed(d)); }, []);
  const visible = gaps.filter((g) => !dismissed.includes(g.key));
  const dismiss = (key: string) => { const next = [...dismissed, key].slice(-200); setDismissed(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  return (
    <aside className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      {mix ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[13px] font-semibold"><Users className="size-4" /> {t("gaps.distribution")}</p>
            {canAdmin ? <button type="button" onClick={() => setEditMix(true)} className="text-xs text-primary hover:underline"><Pencil className="mr-1 inline size-3" />{t("gaps.editMix")}</button> : null}
          </div>
          {dist.total ? (
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label={t("gaps.distributionLabel")}>
              {SIDES.map((s) => <div key={s} className={BAR[s]} style={{ width: `${dist.pct[s]}%` }} />)}
            </div>
          ) : null}
          <ul className="space-y-1 text-xs">
            {SIDES.map((s) => {
              const off = dist.total ? dist.pct[s] - mix[s] : 0;
              return (
                <li key={s} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR[s])} />{td(`side.${s}`)}</span>
                  <span className="tabular-nums">{dist.total ? t("gaps.pct", { value: dist.pct[s] }) : "—"} <span className="text-muted-foreground">{t("gaps.target", { value: mix[s] })}</span>{dist.total && Math.abs(off) >= 10 ? <span className={off > 0 ? " text-warning-foreground" : " text-destructive"}> {off > 0 ? "▲" : "▼"}</span> : null}</span>
                </li>
              );
            })}
            {dist.counts.unset ? <li className="text-muted-foreground">{t("gaps.unset", { count: dist.counts.unset })}</li> : null}
          </ul>
          <p className="text-[11px] text-muted-foreground">{t("gaps.period", { count: dist.total })}</p>
        </section>
      ) : null}
      <section className={cn("space-y-2.5", mix && "border-t pt-3")}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] font-semibold"><AlertTriangle className="size-4 text-warning" /> {t("gaps.check")}</p>
          {canEdit ? <Button size="sm" variant="outline" onClick={() => setPlanning(true)}><Sparkles /> {t("gaps.planner")}</Button> : null}
        </div>
        {visible.length ? (
          <ul className="space-y-2">{visible.map((g) => (
            <li key={g.key} className="flex items-start gap-2 text-xs"><span className="flex-1">{g.message}</span><button type="button" aria-label={t("gaps.dismiss")} onClick={() => dismiss(g.key)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button></li>
          ))}</ul>
        ) : <p className="text-xs text-muted-foreground">{t("gaps.nothing")}</p>}
      </section>
      {planning ? <PlannerDialog projectId={projectId} today={today} tz={tz} pillars={pillars} audienceMix={mix} onClose={() => setPlanning(false)} onSaved={() => { setPlanning(false); router.refresh(); }} /> : null}
      {editMix && mix ? <MixDialog projectId={projectId} initial={mix} onClose={() => setEditMix(false)} onSaved={() => { setEditMix(false); router.refresh(); }} /> : null}
    </aside>
  );
}

function MixDialog({ projectId, initial, onClose, onSaved }: { projectId: string; initial: AudienceMix; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = React.useState<Record<Side, string>>(() => Object.fromEntries(SIDES.map((s) => [s, String(initial[s])])) as Record<Side, string>);
  const [busy, setBusy] = React.useState(false);
  const total = SIDES.reduce((a, s) => a + (Number(m[s]) || 0), 0);
  const t = useT("backlog");
  const tc = useT("common");
  const td = useT("domain");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("gaps.mixTitle")}</DialogTitle><DialogDescription>{t("gaps.mixDescription")}</DialogDescription></DialogHeader>
        <div className="space-y-2 text-[13px]">
          {SIDES.map((s) => <label key={s} className="flex items-center justify-between gap-3"><span>{td(`side.${s}`)}</span><Input type="number" min={0} max={100} className="w-24" value={m[s]} onChange={(e) => setM({ ...m, [s]: e.target.value })} /></label>)}
          <p className="text-xs text-muted-foreground">{t("gaps.mixTotal", { total })}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button>
          <Button disabled={busy || !total} onClick={async () => { setBusy(true); const r = await saveAudienceMixAction(projectId, Object.fromEntries(SIDES.map((s) => [s, Number(m[s]) || 0]))); setBusy(false); if (r.ok) { toast.success(r.message ?? t("savedToast")); onSaved(); } else toast.error(r.error); }}>{busy ? <Loader2 className="animate-spin" /> : null} {t("gaps.saveMix")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
