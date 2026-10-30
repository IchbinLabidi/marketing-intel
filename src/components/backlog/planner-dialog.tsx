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
import { WEEKDAY_LABELS } from "@/lib/calendar/insights";
import type { PlanIdea, Placement } from "@/lib/backlog/planner";
import { FORMATS } from "@/lib/production/model";
import { previewPlanAction, savePlanAction } from "@/server/actions/backlog";
import { SEGMENTS, SEGMENT_LABELS, SIDES, SIDE_LABELS, type AudienceMix, type Side } from "@/lib/backlog/audience";

const CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type Row = Placement & { approved: boolean };

/**
 * Calendar Planner: proposes a balanced plan from the Backlog (best scores, pillar mix, best time slots). The preview
 * can be edited line by line; only approved lines are saved, as calendar placements. Nothing is ever published.
 */
export function PlannerDialog({ projectId, today, tz, pillars, audienceMix, onClose, onSaved }: { projectId: string; today: string; tz: string; pillars: { id: string; name: string; segment?: string; target_share?: number | null }[]; audienceMix?: AudienceMix | null; onClose: () => void; onSaved: () => void }) {
  const [req, setReq] = React.useState({ from: addDays(today, 1), to: addDays(today, 14), postsPerWeek: 4, platforms: ["facebook"] as string[], format: "", audience: "" });
  const [mix, setMix] = React.useState<Record<string, string>>({});
  const [sides, setSides] = React.useState<Record<Side, string>>(() => Object.fromEntries(SIDES.map((s) => [s, audienceMix ? String(audienceMix[s]) : ""])) as Record<Side, string>);
  const [segment, setSegment] = React.useState("");
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [options, setOptions] = React.useState<PlanIdea[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const pillar = (id: string | null) => pillars.find((p) => p.id === id)?.name ?? "No pillar";
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
    toast.success(r.message ?? "Saved");
    onSaved();
  };
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const used = new Set((rows ?? []).map((r) => r.ideaId));

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Calendar Planner</DialogTitle>
          <DialogDescription>Proposes a plan from your Backlog using idea scores, your pillar mix and your best time slots. Review it, then save the lines you approve. Nothing is published.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">From</span><Input type="date" value={req.from} onChange={(e) => setReq({ ...req, from: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">To</span><Input type="date" value={req.to} onChange={(e) => setReq({ ...req, to: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Posts per week</span><Input type="number" min={1} max={14} value={req.postsPerWeek} onChange={(e) => setReq({ ...req, postsPerWeek: Number(e.target.value) || 1 })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Format (optional)</span><NativeSelect value={req.format} onChange={(e) => setReq({ ...req, format: e.target.value })}><option value="">Any format</option>{FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</NativeSelect></label>
          <div className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Platforms</span><div className="flex flex-wrap gap-3">{CHOICES.map((p) => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={req.platforms.includes(p)} onChange={() => setReq({ ...req, platforms: req.platforms.includes(p) ? req.platforms.filter((x) => x !== p) : [...req.platforms, p] })} />{PLATFORM_LABELS[p as Platform]}</label>)}</div></div>
          <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Only one audience (optional)</span><NativeSelect value={segment} onChange={(e) => setSegment(e.target.value)}><option value="">All audiences, using the mix below</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]} only</option>)}</NativeSelect></label>
        </div>
        {!segment ? (
          <div className="grid gap-2 rounded-lg border p-3 text-[13px] sm:grid-cols-3">
            <p className="text-xs text-muted-foreground sm:col-span-3">Audience mix for this plan (%). Teacher and student content are balanced separately.</p>
            {SIDES.map((s) => <label key={s} className="flex items-center justify-between gap-2"><span>{SIDE_LABELS[s]}</span><Input type="number" min={0} max={100} className="w-20" value={sides[s]} placeholder="%" onChange={(e) => setSides({ ...sides, [s]: e.target.value })} /></label>)}
          </div>
        ) : null}
        {pillars.length ? (
          <details className="rounded-lg border p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">Pillar mix (optional){mixTotal ? ` · ${mixTotal}%` : ""}</summary>
            <p className="my-2 text-xs text-muted-foreground">E.g. 40% educational, 30% promotional, 20% engagement, 10% tutorials. Only pillars with a share are planned. <button type="button" className="text-primary hover:underline" onClick={() => setMix(Object.fromEntries(pillars.filter((p) => p.target_share).map((p) => { const side = (p.segment ?? "students_parents") as Side; const sideShare = Number(sides[side]) || 0; return [p.id, String(Math.round(((p.target_share ?? 0) * (segment ? 100 : sideShare)) / 100))]; }).filter(([, v]) => Number(v) > 0)))}>Use each pillar&apos;s target share</button></p>
            <div className="grid gap-2 sm:grid-cols-2">{pillars.map((p) => <label key={p.id} className="flex items-center justify-between gap-2"><span className="truncate">{p.name}{p.segment === "teachers" ? <span className="text-xs text-muted-foreground"> · Teachers</span> : null}</span><Input type="number" min={0} max={100} className="w-20" value={mix[p.id] ?? ""} placeholder="%" onChange={(e) => setMix({ ...mix, [p.id]: e.target.value })} /></label>)}</div>
          </details>
        ) : null}
        <Button onClick={preview} disabled={busy !== null || !req.platforms.length}>{busy === "preview" ? <Loader2 className="animate-spin" /> : <CalendarRange />} {rows ? "Regenerate preview" : "Preview plan"}</Button>

        {notes.length ? <ul className="space-y-1 text-xs text-warning-foreground">{notes.map((n) => <li key={n}>• {n}</li>)}</ul> : null}
        {rows ? (
          rows.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-2">Keep</th><th className="p-2">Date</th><th className="p-2">Time ({tz})</th><th className="p-2">Idea</th><th className="p-2">Platform</th></tr></thead>
                <tbody>{rows.map((r, k) => (
                  <tr key={`${r.ideaId}-${k}`} className={r.approved ? "border-b last:border-0" : "border-b opacity-50 last:border-0"}>
                    <td className="p-2"><button type="button" aria-label={r.approved ? "Reject this placement" : "Approve this placement"} onClick={() => set(k, { approved: !r.approved })} className="flex size-6 items-center justify-center rounded border">{r.approved ? <Check className="size-3.5 text-success" /> : <X className="size-3.5" />}</button></td>
                    <td className="p-2"><Input type="date" className="h-8 w-36" value={r.date} onChange={(e) => set(k, { date: e.target.value })} /><span className="text-[11px] text-muted-foreground">{WEEKDAY_LABELS[new Date(`${r.date}T00:00:00Z`).getUTCDay()]}</span></td>
                    <td className="p-2"><Input type="time" className="h-8 w-28" value={r.time} onChange={(e) => set(k, { time: e.target.value })} /></td>
                    <td className="max-w-xs p-2">
                      <NativeSelect className="h-8" value={r.ideaId} onChange={(e) => { const o = options.find((x) => x.id === e.target.value)!; set(k, { ideaId: o.id, title: o.title, score: o.score, pillar_id: o.pillar_id, reason: "Replaced manually" }); }}>
                        {options.filter((o) => o.id === r.ideaId || !used.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.score != null ? `${o.score} · ` : ""}{o.title}</option>)}
                      </NativeSelect>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{pillar(r.pillar_id)} · {r.reason}</p>
                    </td>
                    <td className="p-2"><Badge variant="outline">{PLATFORM_LABELS[r.platform as Platform] ?? r.platform}</Badge></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">No idea matches these settings. Add ideas to the Backlog or widen the filters.</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>Close</Button>
          {rows?.length ? <Button onClick={save} disabled={busy !== null || !rows.some((r) => r.approved)}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save {rows.filter((r) => r.approved).length} placement{rows.filter((r) => r.approved).length === 1 ? "" : "s"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
