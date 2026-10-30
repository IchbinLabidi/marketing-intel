"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarPlus, Gauge, Loader2, RefreshCcw, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { CRITERIA } from "@/lib/backlog/score";
import { goalsFor, SEGMENTS, SEGMENT_LABELS, SIDE_LABELS, conversionLabel, type Side } from "@/lib/backlog/audience";
import { FORMATS } from "@/lib/production/model";
import { dismissSuggestionAction, refreshSuggestionsAction, scoreIdeasAction, setScoreAction, updateIdeaAction } from "@/server/actions/backlog";
import { productionDetailsAction } from "@/server/actions/production";
import type { Idea } from "@/server/services/backlog";
import { MediaLightbox, MediaPreview, type TileAsset } from "@/components/calendar/media-tile";
import { slotLabel } from "./schedule-dialog";

const PLATFORM_CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
export const lifecycleOf = (i: Pick<Idea, "status" | "production_stage" | "scheduled_date" | "archived_at">) =>
  i.archived_at ? "Archived" : i.status === "published" ? "Published" : i.status === "scheduled" ? "Scheduled"
    : i.production_stage === "ready" ? "Ready" : i.production_stage && !["idea"].includes(i.production_stage) ? "In production"
      : i.scheduled_date ? "Planned" : "Backlog";

/** Everything about one idea: editable fields, score breakdown, publishing recommendation and attachments. */
export function IdeaDetail({ projectId, idea, pillars, tz, canEdit, onClose, onChanged, onPlace }: {
  projectId: string; idea: Idea; pillars: { id: string; name: string; segment?: string }[]; tz: string; canEdit: boolean;
  onClose: () => void; onChanged: (i: Partial<Idea> & { id: string }) => void; onPlace: (i: Idea, date?: string, time?: string) => void;
}) {
  const [form, setForm] = React.useState({
    title: idea.title, description: idea.description ?? idea.hook ?? "", pillar_id: idea.pillar_id ?? "", format: idea.format ?? "",
    target_platforms: idea.target_platforms?.length ? idea.target_platforms : idea.platform ? [idea.platform] : [], target_audience: idea.target_audience ?? "",
    tags: (idea.tags ?? []).join(", "), priority: idea.priority ?? "medium",
    audience_segment: idea.audience_segment ?? "", conversion_goal: idea.conversion_goal ?? "",
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState<{ score: string; note: string } | null>(null);
  const [assets, setAssets] = React.useState<TileAsset[] | null>(null);
  const [zoom, setZoom] = React.useState<number | null>(null);
  React.useEffect(() => {
    let alive = true;
    productionDetailsAction(projectId, idea.id).then((r) => {
      if (!alive) return;
      setAssets(r.ok && r.data ? r.data.assets.map((a) => ({ id: a.id, name: a.body.name, mime: a.body.mime ?? null, source: a.body.path ? "stored" : a.body.source_type === "google_drive" ? "google_drive" : "link", previewUrl: `/api/media/${a.id}?project=${projectId}&size=thumb`, fullUrl: `/api/media/${a.id}?project=${projectId}` })) : []);
    });
    return () => { alive = false; };
  }, [projectId, idea.id]);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } finally { setBusy(null); } };
  const save = () => run("save", async () => {
    const r = await updateIdeaAction(projectId, idea.id, {
      title: form.title, description: form.description || null, pillar_id: form.pillar_id || null, format: form.format || null,
      target_platforms: form.target_platforms, target_audience: form.target_audience || null, priority: form.priority,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      audience_segment: (form.audience_segment || null) as never, conversion_goal: form.conversion_goal || null,
    });
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Saved"); onChanged(r.data!);
  });
  const s = idea.suggested_slot;
  const d = idea.score_details;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{idea.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{lifecycleOf(idea)}</Badge>
            {idea.scheduled_date ? <span>Calendar: {idea.scheduled_date}{idea.scheduled_time ? ` ${idea.scheduled_time.slice(0, 5)}` : ""}</span> : <span>Not on the calendar</span>}
            <span>· Created {idea.created_at.slice(0, 10)}</span>
            {idea.audience_segment ? <span>· {SEGMENT_LABELS[idea.audience_segment as keyof typeof SEGMENT_LABELS]}{idea.conversion_goal ? ` → ${conversionLabel(idea.conversion_goal)}` : ""}</span> : null}
            {idea.idea_source ? <span>· Source: {idea.idea_source}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 text-[13px] md:grid-cols-[1fr_17rem]">
          <div className="space-y-3">
            <label className="block space-y-1"><span className="text-xs text-muted-foreground">Title</span><Input value={form.title} disabled={!canEdit} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="block space-y-1"><span className="text-xs text-muted-foreground">Description</span><Textarea rows={4} value={form.description} disabled={!canEdit} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Audience</span>
                <NativeSelect value={form.audience_segment} disabled={!canEdit} onChange={(e) => { const seg = e.target.value; setForm({ ...form, audience_segment: seg, conversion_goal: goalsFor(seg).some((g) => g.key === form.conversion_goal) ? form.conversion_goal : "" }); }}><option value="">Not set</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</NativeSelect></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Conversion goal</span>
                <NativeSelect value={form.conversion_goal} disabled={!canEdit} onChange={(e) => setForm({ ...form, conversion_goal: e.target.value })}><option value="">Not set</option>{goalsFor(form.audience_segment).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</NativeSelect></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Content pillar</span>
                <NativeSelect value={form.pillar_id} disabled={!canEdit} onChange={(e) => setForm({ ...form, pillar_id: e.target.value })}><option value="">No pillar</option>{(["students_parents", "teachers", "both"] as Side[]).map((side) => { const list = pillars.filter((p) => (p.segment ?? "students_parents") === side); return list.length ? <optgroup key={side} label={SIDE_LABELS[side]}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null; })}</NativeSelect></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Format</span>
                <NativeSelect value={form.format} disabled={!canEdit} onChange={(e) => setForm({ ...form, format: e.target.value })}><option value="">Not set</option>{[...new Set([...FORMATS, ...(form.format ? [form.format] : [])])].map((f) => <option key={f} value={f}>{f}</option>)}</NativeSelect></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Target audience</span><Input value={form.target_audience} disabled={!canEdit} placeholder="e.g. Bac students, parents" onChange={(e) => setForm({ ...form, target_audience: e.target.value })} /></label>
              <label className="space-y-1"><span className="text-xs text-muted-foreground">Priority</span>
                <NativeSelect value={form.priority} disabled={!canEdit} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}>{["urgent", "high", "medium", "low"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</NativeSelect></label>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Target platforms</span>
              <div className="flex flex-wrap gap-3">{PLATFORM_CHOICES.map((p) => (
                <label key={p} className="flex items-center gap-1.5"><input type="checkbox" disabled={!canEdit} checked={form.target_platforms.includes(p)} onChange={() => setForm({ ...form, target_platforms: form.target_platforms.includes(p) ? form.target_platforms.filter((x) => x !== p) : [...form.target_platforms, p] })} />{PLATFORM_LABELS[p as Platform]}</label>
              ))}</div>
            </div>
            <label className="block space-y-1"><span className="text-xs text-muted-foreground">Tags (comma separated)</span><Input value={form.tags} disabled={!canEdit} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
            {canEdit ? <Button size="sm" onClick={save} disabled={busy !== null}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} Save idea</Button> : null}

            <section className="space-y-2 border-t pt-3">
              <p className="font-medium">Attachments & references</p>
              {assets === null ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : assets.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{assets.map((a, i) => (
                  <button key={a.id} type="button" onClick={() => setZoom(i)} className="h-20 overflow-hidden rounded-md border bg-muted" aria-label={`View ${a.name}`}><MediaPreview asset={a} className="size-full" /></button>
                ))}</div>
              ) : <p className="text-xs text-muted-foreground">No files yet. Add them in <Link className="text-primary hover:underline" href={`/p/${projectId}/production?item=${idea.id}`}>Content Production</Link>.</p>}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 font-medium"><Gauge className="size-4" /> Idea score</p>
              {idea.idea_score != null ? <p className="text-2xl font-semibold tabular-nums">{idea.idea_score}<span className="text-sm text-muted-foreground">/100</span> <span className="text-xs font-normal text-muted-foreground">{d?.source === "manual" ? "set manually" : "AI estimate"}</span></p> : <p className="text-xs text-muted-foreground">Not scored yet.</p>}
              {d?.criteria ? (
                <ul className="space-y-1">{CRITERIA.map((c) => (
                  <li key={c.key} className="space-y-0.5">
                    <div className="flex justify-between text-[11px]"><span>{c.label} <span className="text-muted-foreground">({d.weights?.[c.key] ?? c.weight}%)</span></span><span className="tabular-nums">{d.criteria![c.key]}</span></div>
                    <div className="h-1 rounded bg-muted"><div className="h-1 rounded bg-primary" style={{ width: `${d.criteria![c.key]}%` }} /></div>
                  </li>
                ))}</ul>
              ) : null}
              {d?.explanation ? <p className="text-xs text-muted-foreground">{d.explanation}</p> : null}
              {d?.note ? <p className="text-xs">Note: {d.note}</p> : null}
              <p className="text-[11px] text-muted-foreground">An estimate to rank ideas, not a performance prediction.</p>
              {canEdit ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("score", async () => { const r = await scoreIdeasAction(projectId, [idea.id]); if (r.ok) { toast.success(r.message ?? "Scored"); onChanged({ id: idea.id }); } else toast.error(r.error); })}>{busy === "score" ? <Loader2 className="animate-spin" /> : <Sparkles />} {idea.idea_score == null ? "Score with AI" : "Rescore"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setOverride({ score: String(idea.idea_score ?? ""), note: "" })}>Override</Button>
                </div>
              ) : null}
              {override ? (
                <div className="space-y-1.5">
                  <Input type="number" min={0} max={100} value={override.score} onChange={(e) => setOverride({ ...override, score: e.target.value })} aria-label="Manual score" />
                  <Input placeholder="Why (optional)" value={override.note} onChange={(e) => setOverride({ ...override, note: e.target.value })} />
                  <div className="flex gap-1.5"><Button size="sm" disabled={busy !== null} onClick={() => run("override", async () => { const r = await setScoreAction(projectId, idea.id, Number(override.score), override.note); if (r.ok) { toast.success(r.message ?? "Saved"); setOverride(null); onChanged({ id: idea.id }); } else toast.error(r.error); })}>Save score</Button><Button size="sm" variant="ghost" onClick={() => setOverride(null)}>Cancel</Button></div>
                </div>
              ) : null}
            </section>

            <section className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 font-medium"><Sparkles className="size-4 text-primary" /> Publishing recommendation</p>
              {s ? (
                <>
                  <p><span className="text-xs text-muted-foreground">Best estimated slot</span><br /><span className="font-semibold">{slotLabel(s.date, s.time)}</span> <span className="text-xs text-muted-foreground">· {PLATFORM_LABELS[s.platform as Platform] ?? s.platform}</span></p>
                  {s.alternatives.length ? <p className="text-xs"><span className="text-muted-foreground">Alternatives: </span>{s.alternatives.map((a) => slotLabel(a.date, a.time)).join(" · ")}</p> : null}
                  <p className="text-xs"><Badge variant={s.confidence === "high" ? "success" : s.confidence === "medium" ? "info" : "outline"}>Confidence: {s.confidence}</Badge> <span className="text-muted-foreground">{s.source === "analytics" ? "from your synced posts" : "heuristic"}</span></p>
                  <p className="text-xs text-muted-foreground">{s.reason}</p>
                  <p className="text-[11px] text-muted-foreground">Computed {s.computed_at.slice(0, 16).replace("T", " ")} UTC · times in {tz}. Never scheduled automatically.</p>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => onPlace(idea, s.date, s.time)}><CalendarPlus /> Use suggested time</Button>
                      <Button size="sm" variant="outline" onClick={() => onPlace(idea)}>Choose manually</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("refresh", async () => { const r = await refreshSuggestionsAction(projectId, [idea.id]); if (r.ok) onChanged({ id: idea.id, suggested_slot: r.data?.[idea.id] ?? null }); else toast.error(r.error); })}>{busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCcw />} Refresh</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("dismiss", async () => { const r = await dismissSuggestionAction(projectId, idea.id); if (r.ok) onChanged({ id: idea.id, suggested_slot: null }); })}><X /> Dismiss</Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">No recommendation yet.</p>
                  {canEdit ? <div className="flex gap-1.5"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("refresh", async () => { const r = await refreshSuggestionsAction(projectId, [idea.id]); if (r.ok) onChanged({ id: idea.id, suggested_slot: r.data?.[idea.id] ?? null }); else toast.error(r.error); })}>{busy === "refresh" ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest a time</Button><Button size="sm" variant="ghost" onClick={() => onPlace(idea)}>Choose manually</Button></div> : null}
                </>
              )}
            </section>
          </aside>
        </div>
        {zoom !== null && assets?.[zoom] ? <MediaLightbox assets={assets} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
