"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarPlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/form";
import { PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { generateCalendarDraftAction, saveCalendarAction, type CalendarDraft } from "@/server/actions/history-intelligence";

type Pillar = { id: string; name: string; target_share: number | null };

// Local calendar date (toISOString would convert local midnight to UTC and shift the day east of Greenwich).
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function CalendarGenerator({
  projectId,
  channels,
  pillars,
  aiEnabled,
  hasHistory,
  hasRecommendations,
}: {
  projectId: string;
  channels: { platform: Platform; target_posts_per_week: number | null; is_active: boolean }[];
  pillars: Pillar[];
  aiEnabled: boolean;
  hasHistory: boolean;
  hasRecommendations: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<"setup" | "loading" | "review" | "saving">("setup");
  const today = new Date();
  const [start, setStart] = React.useState(iso(new Date(today.getFullYear(), today.getMonth() + 1, 1)));
  const [end, setEnd] = React.useState(iso(new Date(today.getFullYear(), today.getMonth() + 2, 0)));
  const initialRhythm = channels.filter((c) => c.is_active).map((c) => ({ platform: c.platform, perWeek: Number(c.target_posts_per_week) || 3 }));
  const [rhythm, setRhythm] = React.useState(initialRhythm.length ? initialRhythm : [{ platform: "instagram" as Platform, perWeek: 3 }]);
  const [instruction, setInstruction] = React.useState("");
  const [draft, setDraft] = React.useState<CalendarDraft | null>(null);
  const [name, setName] = React.useState("");

  const generate = async () => {
    setStage("loading");
    const r = await generateCalendarDraftAction(projectId, { start, end, platforms: rhythm, instruction: instruction || undefined });
    if (!r.ok) {
      toast.error(r.error);
      setStage("setup");
      return;
    }
    setDraft(r.data!);
    setName(`Calendar ${start} → ${end}`);
    setStage("review");
  };

  const save = async () => {
    if (!draft) return;
    setStage("saving");
    const r = await saveCalendarAction(projectId, {
      name,
      start: draft.start,
      end: draft.end,
      items: draft.items.map((i) => ({
        scheduled_date: i.scheduled_date, platform: i.platform, title: i.title, format: i.format, pillar_id: i.pillar_id, campaign_id: i.campaign_id,
        funnel_stage: i.funnel_stage, hook: i.hook, cta: i.cta, marketing_objective: i.marketing_objective, opportunity_id: i.opportunity_id,
        historical_source_id: i.historical_source_id,
        // the rationale travels with the brief so the team sees why the item exists
        creative_brief: [i.creative_brief, i.rationale ? `Why: ${i.rationale}` : null].filter(Boolean).join("\n\n").slice(0, 3000) || null,
      })),
      settings: { platforms: rhythm, instruction: instruction || null },
    });
    if (!r.ok) {
      toast.error(r.error);
      setStage("review");
      return;
    }
    toast.success(r.message);
    setOpen(false);
    setDraft(null);
    setStage("setup");
    router.push(`/p/${projectId}/calendar?c=${r.data?.calendarId}`);
  };

  const update = (k: number, patch: Partial<CalendarDraft["items"][number]>) =>
    setDraft((d) => (d ? { ...d, items: d.items.map((i, j) => (j === k ? { ...i, ...patch } : i)) } : d));

  const mix = draft
    ? pillars.map((p) => {
        const n = draft.items.filter((i) => i.pillar_id === p.id).length;
        return { ...p, n, share: draft.items.length ? Math.round((n / draft.items.length) * 100) : 0 };
      })
    : [];

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!aiEnabled}
        title={!aiEnabled ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable AI features" : undefined}
      >
        <CalendarPlus /> Generate calendar using historical insights
      </Button>
      <Dialog open={open} onOpenChange={(o) => stage !== "loading" && stage !== "saving" && setOpen(o)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Generate an editorial calendar</DialogTitle>
            <DialogDescription>
              Built from your strategy, pillar targets, brand voice and the historical analysis{hasRecommendations ? " and its recommendations" : ""}. Nothing is saved until you approve it.
            </DialogDescription>
          </DialogHeader>

          {stage === "setup" || stage === "loading" ? (
            <div className="grid gap-4">
              {!hasHistory ? <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">No history imported yet: the calendar will rely on the strategy only.</p> : null}
              {!hasRecommendations && hasHistory ? <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Tip: generate recommendations first so the calendar can implement them.</p> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start" htmlFor="cal-start"><Input id="cal-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="End" htmlFor="cal-end" hint="Up to 3 months per generation"><Input id="cal-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              </div>
              <div className="grid gap-2">
                <p className="text-[13px] font-medium">Platforms and posts per week</p>
                {rhythm.map((r, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <NativeSelect aria-label="Platform" value={r.platform} onChange={(e) => setRhythm((list) => list.map((x, j) => (j === k ? { ...x, platform: e.target.value as Platform } : x)))} className="w-44">
                      {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
                    </NativeSelect>
                    <Input aria-label="Posts per week" type="number" min={0.5} max={21} step={0.5} value={r.perWeek} onChange={(e) => setRhythm((list) => list.map((x, j) => (j === k ? { ...x, perWeek: Number(e.target.value) } : x)))} className="w-24" />
                    <span className="text-xs text-muted-foreground">/ week</span>
                    {rhythm.length > 1 ? <Button variant="ghost" size="icon-sm" aria-label="Remove platform" onClick={() => setRhythm((list) => list.filter((_, j) => j !== k))}><Trash2 /></Button> : null}
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="w-fit" onClick={() => setRhythm((list) => [...list, { platform: PLATFORMS.find((p) => !list.some((x) => x.platform === p)) ?? "other", perWeek: 2 }])}>
                  + Add platform
                </Button>
              </div>
              <Field label="Instructions (optional)" htmlFor="cal-instruction">
                <Textarea id="cal-instruction" rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. “focus on 9e and Bac students”, “one live per month”" />
              </Field>
              <DialogFooter>
                <Button onClick={generate} disabled={stage === "loading"}>
                  {stage === "loading" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {stage === "loading" ? "Planning… this can take a minute or two" : "Generate draft"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {(stage === "review" || stage === "saving") && draft ? (
            <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
              {pillars.length ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Pillar mix of this draft vs strategy target</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {mix.map((p) => (
                      <Badge key={p.id} variant={p.target_share != null && Math.abs(p.share - Number(p.target_share)) > 10 ? "warning" : "secondary"}>
                        {p.name}: {p.share}% {p.target_share != null ? `(target ${p.target_share}%)` : ""}
                      </Badge>
                    ))}
                    <Badge variant="outline">No pillar: {draft.items.filter((i) => !i.pillar_id).length}</Badge>
                  </div>
                </div>
              ) : null}
              {draft.dropped.length ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                  <p className="flex items-center gap-1 font-medium"><AlertTriangle className="size-3.5" /> {draft.dropped.length} suggested item(s) were left out</p>
                  <ul className="mt-1 list-disc pl-5">{draft.dropped.map((d, k) => <li key={k}>{d.title}: {d.reason}</li>)}</ul>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-[13px]">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b"><th className="py-2 pr-2 font-medium">Date</th><th className="pr-2 font-medium">Platform</th><th className="pr-2 font-medium">Title · hook · brief</th><th className="pr-2 font-medium">Format</th><th className="pr-2 font-medium">Pillar</th><th className="w-8" /></tr>
                  </thead>
                  <tbody>
                    {draft.items.map((i, k) => (
                      <tr key={k} className="border-b align-top last:border-0">
                        <td className="py-2 pr-2"><Input type="date" aria-label="Date" min={draft.start} max={draft.end} value={i.scheduled_date} onChange={(e) => update(k, { scheduled_date: e.target.value })} className="h-8 w-36" /></td>
                        <td className="pr-2 pt-2">
                          <NativeSelect aria-label="Platform" value={i.platform} onChange={(e) => update(k, { platform: e.target.value as Platform })} className="h-8 w-32">
                            {rhythm.map((r) => <option key={r.platform} value={r.platform}>{PLATFORM_LABELS[r.platform]}</option>)}
                          </NativeSelect>
                        </td>
                        <td className="space-y-1 pr-2 pt-2">
                          <Input aria-label="Title" value={i.title} onChange={(e) => update(k, { title: e.target.value })} className="h-8" />
                          {i.hook ? <p className="text-xs"><span className="text-muted-foreground">Hook: </span>{i.hook}</p> : null}
                          {i.creative_brief ? <p className="text-xs text-muted-foreground">{i.creative_brief}</p> : null}
                          <p className="text-[11px] text-muted-foreground">
                            Why: {i.rationale}
                            {i.historical_source_id ? " · refreshes a past item" : ""}
                            {i.opportunity_id ? " · implements a recommendation" : ""}
                          </p>
                          {i.issues.map((x) => <p key={x} className="text-[11px] text-warning">{x}</p>)}
                        </td>
                        <td className="pr-2 pt-2"><Input aria-label="Format" value={i.format ?? ""} onChange={(e) => update(k, { format: e.target.value || null })} className="h-8 w-32" /></td>
                        <td className="pr-2 pt-2">
                          <NativeSelect aria-label="Pillar" value={i.pillar_id ?? ""} onChange={(e) => update(k, { pillar_id: e.target.value || null })} className="h-8 w-40">
                            <option value="">No pillar</option>
                            {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </NativeSelect>
                        </td>
                        <td className="pt-2">
                          <Button variant="ghost" size="icon-sm" aria-label="Remove item" onClick={() => setDraft((d) => (d ? { ...d, items: d.items.filter((_, j) => j !== k) } : d))}><Trash2 /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft.notes.assumptions.length || draft.notes.questions.length ? (
                <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
                  {draft.notes.assumptions.length ? <div><p className="font-medium">Assumptions</p><ul className="list-disc pl-5 text-muted-foreground">{draft.notes.assumptions.map((a, k) => <li key={k}>{a}</li>)}</ul></div> : null}
                  {draft.notes.questions.length ? <div><p className="font-medium">Questions</p><ul className="list-disc pl-5 text-muted-foreground">{draft.notes.questions.map((a, k) => <li key={k}>{a}</li>)}</ul></div> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {(stage === "review" || stage === "saving") && draft ? (
            <DialogFooter className="items-end gap-2 sm:justify-between">
              <Field label="Calendar name" htmlFor="cal-name" className="w-full sm:max-w-sm">
                <Input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
              </Field>
              <div className="flex gap-2">
                <Button variant="outline" disabled={stage === "saving"} onClick={() => setStage("setup")}>Back to settings</Button>
                <Button disabled={stage === "saving" || !draft.items.length || !name.trim()} onClick={save}>
                  {stage === "saving" ? <Loader2 className="animate-spin" /> : null} Approve and add {draft.items.length} items
                </Button>
              </div>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
