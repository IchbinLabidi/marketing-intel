"use client";

import * as React from "react";
import { CalendarRange, Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import type { PlanIdea, Placement } from "@/lib/backlog/planner";
import { FORMATS } from "@/lib/production/model";
import { previewPlanAction, savePlanAction } from "@/server/actions/backlog";
import { SEGMENTS, SIDES, type AudienceMix, type Side } from "@/lib/backlog/audience";
import { useFormatter, useT } from "@/i18n/client";

const CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Row = Placement & { approved: boolean };

/**
 * Calendar Planner: proposes a balanced plan from the Backlog (best scores, pillar mix, best time slots). The preview
 * can be edited line by line; only approved lines are saved, as calendar placements. Nothing is ever published.
 */
export function PlannerDialog({ projectId, today, tz, pillars, audienceMix, onClose, onSaved }: { projectId: string; today: string; tz: string; pillars: { id: string; name: string; segment?: string; target_share?: number | null }[]; audienceMix?: AudienceMix | null; onClose: () => void; onSaved: () => void }) {
  const t = useT("backlog");
  const tc = useT("common");
  const td = useT("domain");
  const fmt = useFormatter();
  const [req, setReq] = React.useState({ from: addDays(today, 1), to: addDays(today, 14), postsPerWeek: 4, platforms: ["facebook"] as string[], format: "", audience: "" });
  const [mix, setMix] = React.useState<Record<string, string>>({});
  const [sides, setSides] = React.useState<Record<Side, string>>(() => Object.fromEntries(SIDES.map((s) => [s, audienceMix ? String(audienceMix[s]) : ""])) as Record<Side, string>);
  const [segment, setSegment] = React.useState("");
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [options, setOptions] = React.useState<PlanIdea[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const pillar = (id: string | null) => pillars.find((p) => p.id === id)?.name ?? t("planner.noPillar");
  const mixTotal = Object.values(mix).reduce((a, v) => a + (Number(v) || 0), 0);

  const preview = async () => {
    setBusy("preview");
    const pillarMix = Object.fromEntries(Object.entries(mix).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const audienceMix = Object.fromEntries(SIDES.map((s) => [s, Number(sides[s]) || 0]));
    const r = await previewPlanAction(projectId, { from: req.from, to: req.to, postsPerWeek: req.postsPerWeek, platforms: req.platforms, pillarMix, formats: req.format ? [req.format] : undefined, audience: req.audience || undefined, audienceMix: segment ? undefined : audienceMix, segments: segment ? [segment] : undefined });
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    setRows(r.data!.placements.map((p) => ({ ...p, approved: true })));
    setNotes(r.data!.notes);
    setOptions(r.data!.options);
  };
  const save = async () => {
    const chosen = (rows ?? []).filter((r) => r.approved);
    setBusy("save");
    const r = await savePlanAction(projectId, chosen.map(({ ideaId, date, time, platform }) => ({ ideaId, date, time, platform })));
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? t("savedToast"));
    onSaved();
  };
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const used = new Set((rows ?? []).map((r) => r.ideaId));

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {t("planner.title")}</DialogTitle>
          <DialogDescription>{t("planner.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("planner.from")}</span><Input type="date" value={req.from} onChange={(e) => setReq({ ...req, from: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("planner.to")}</span><Input type="date" value={req.to} onChange={(e) => setReq({ ...req, to: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("planner.postsPerWeek")}</span><Input type="number" min={1} max={14} value={req.postsPerWeek} onChange={(e) => setReq({ ...req, postsPerWeek: Number(e.target.value) || 1 })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("planner.format")}</span><NativeSelect value={req.format} onChange={(e) => setReq({ ...req, format: e.target.value })}><option value="">{t("planner.anyFormat")}</option>{FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</NativeSelect></label>
          <div className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">{t("planner.platforms")}</span><div className="flex flex-wrap gap-3">{CHOICES.map((p) => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={req.platforms.includes(p)} onChange={() => setReq({ ...req, platforms: req.platforms.includes(p) ? req.platforms.filter((x) => x !== p) : [...req.platforms, p] })} />{PLATFORM_LABELS[p as Platform]}</label>)}</div></div>
          <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">{t("planner.oneAudience")}</span><NativeSelect value={segment} onChange={(e) => setSegment(e.target.value)}><option value="">{t("planner.allAudiences")}</option>{SEGMENTS.map((s) => <option key={s} value={s}>{t("planner.segmentOnly", { segment: td(`segment.${s}`) })}</option>)}</NativeSelect></label>
        </div>
        {!segment ? (
          <div className="grid gap-2 rounded-lg border p-3 text-[13px] sm:grid-cols-3">
            <p className="text-xs text-muted-foreground sm:col-span-3">{t("planner.mixHint")}</p>
            {SIDES.map((s) => <label key={s} className="flex items-center justify-between gap-2"><span>{td(`side.${s}`)}</span><Input type="number" min={0} max={100} className="w-20" value={sides[s]} placeholder="%" onChange={(e) => setSides({ ...sides, [s]: e.target.value })} /></label>)}
          </div>
        ) : null}
        {pillars.length ? (
          <details className="rounded-lg border p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">{mixTotal ? t("planner.pillarMixTotal", { total: mixTotal }) : t("planner.pillarMix")}</summary>
            <p className="my-2 text-xs text-muted-foreground">{t("planner.pillarMixHint")} <button type="button" className="text-primary hover:underline" onClick={() => setMix(Object.fromEntries(pillars.filter((p) => p.target_share).map((p) => { const side = (p.segment ?? "students_parents") as Side; const sideShare = Number(sides[side]) || 0; return [p.id, String(Math.round(((p.target_share ?? 0) * (segment ? 100 : sideShare)) / 100))]; }).filter(([, v]) => Number(v) > 0)))}>{t("planner.useTargetShares")}</button></p>
            <div className="grid gap-2 sm:grid-cols-2">{pillars.map((p) => <label key={p.id} className="flex items-center justify-between gap-2"><span className="truncate">{p.name}{p.segment === "teachers" ? <span className="text-xs text-muted-foreground">{t("planner.teachersSuffix")}</span> : null}</span><Input type="number" min={0} max={100} className="w-20" value={mix[p.id] ?? ""} placeholder="%" onChange={(e) => setMix({ ...mix, [p.id]: e.target.value })} /></label>)}</div>
          </details>
        ) : null}
        <Button onClick={preview} disabled={busy !== null || !req.platforms.length}>{busy === "preview" ? <Loader2 className="animate-spin" /> : <CalendarRange />} {rows ? t("planner.regenerate") : t("planner.preview")}</Button>

        {notes.length ? <ul className="space-y-1 text-xs text-warning-foreground">{notes.map((n) => <li key={n}>• {n}</li>)}</ul> : null}
        {rows ? (
          rows.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-2">{t("planner.columns.keep")}</th><th className="p-2">{t("planner.columns.date")}</th><th className="p-2">{t("planner.columns.time", { tz })}</th><th className="p-2">{t("planner.columns.idea")}</th><th className="p-2">{t("planner.columns.platform")}</th></tr></thead>
                <tbody>{rows.map((r, k) => (
                  <tr key={`${r.ideaId}-${k}`} className={r.approved ? "border-b last:border-0" : "border-b opacity-50 last:border-0"}>
                    <td className="p-2"><button type="button" aria-label={r.approved ? t("planner.reject") : t("planner.approve")} onClick={() => set(k, { approved: !r.approved })} className="flex size-6 items-center justify-center rounded border">{r.approved ? <Check className="size-3.5 text-success" /> : <X className="size-3.5" />}</button></td>
                    <td className="p-2"><Input type="date" className="h-8 w-36" value={r.date} onChange={(e) => set(k, { date: e.target.value })} /><span className="text-[11px] text-muted-foreground">{/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? fmt.day(r.date, { weekday: "long" }) : null}</span></td>
                    <td className="p-2"><Input type="time" className="h-8 w-28" value={r.time} onChange={(e) => set(k, { time: e.target.value })} /></td>
                    <td className="max-w-xs p-2">
                      <NativeSelect className="h-8" value={r.ideaId} onChange={(e) => { const o = options.find((x) => x.id === e.target.value)!; set(k, { ideaId: o.id, title: o.title, score: o.score, pillar_id: o.pillar_id, reason: t("planner.replaced") }); }}>
                        {options.filter((o) => o.id === r.ideaId || !used.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.score != null ? `${o.score} · ` : ""}{o.title}</option>)}
                      </NativeSelect>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{pillar(r.pillar_id)} · {r.reason}</p>
                    </td>
                    <td className="p-2"><Badge variant="outline">{PLATFORM_LABELS[r.platform as Platform] ?? r.platform}</Badge></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">{t("planner.empty")}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>{tc("actions.close")}</Button>
          {rows?.length ? <Button onClick={save} disabled={busy !== null || !rows.some((r) => r.approved)}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} {t("planner.save", { count: rows.filter((r) => r.approved).length })}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
