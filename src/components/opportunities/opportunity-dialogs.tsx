"use client";

import * as React from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { CALENDAR_PLATFORMS, FUNNEL_LABELS, FUNNEL_STAGES, PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { engagementOf, ENGAGEMENT_FORMULA } from "@/lib/history/performance";
import { DEFAULT_WEIGHTS, DIMENSIONS, DIMENSION_LABELS, type Weights } from "@/lib/opportunities/scoring";
import { generateOpportunitiesAction, opportunityEvidenceAction, saveWeightsAction } from "@/server/actions/opportunities";
import type { Opportunity } from "@/types/domain";
import { cn } from "@/lib/utils";
import { ConfidenceDots, EVIDENCE_HELP, EVIDENCE_LABELS, ScoreMeter } from "./opportunity-card";

type EvidenceData = Extract<Awaited<ReturnType<typeof opportunityEvidenceAction>>, { ok: true }>;
const BASIS_LABEL = { data: "Calculated", ai: "AI judgment", neutral: "No data (neutral)", excluded: "Excluded" } as const;
const KIND_LABEL: Record<string, string> = {
  historical: "Your posts", statistic: "Statistic", strategy: "Strategy", competitor: "Competitors", serp: "Google SERP", search: "Google search", results: "Published results", ai_reasoning: "AI reasoning",
};

export function EvidenceDialog({ projectId, o, pillarName, personaName, onClose }: {
  projectId: string; o: Opportunity; pillarName: string | null; personaName: string | null; onClose: () => void;
}) {
  const [data, setData] = React.useState<EvidenceData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    opportunityEvidenceAction(projectId, o.id).then(
      (r) => { if (live) { if (r.ok) setData(r); else setError(r.error); } },
      () => live && setError("Could not load the evidence."),
    );
    return () => { live = false; };
  }, [projectId, o.id]);

  // older history recommendations store one entry per post with the same note: group them
  const facts = o.evidence
    .filter((e) => e.type !== "ai_reasoning")
    .reduce<typeof o.evidence>((acc, e) => {
      const same = !e.signal && acc.find((x) => !x.signal && x.note === e.note && x.type === e.type);
      if (same) same.ref_ids = [...(same.ref_ids ?? (same.ref_id ? [same.ref_id] : [])), ...(e.ref_id ? [e.ref_id] : [])];
      else acc.push({ ...e, ref_ids: e.ref_ids ?? (e.ref_id ? [e.ref_id] : []) });
      return acc;
    }, []);
  const reasoning = o.evidence.filter((e) => e.type === "ai_reasoning");
  const postsById = new Map((data?.posts ?? []).map((p) => [p.id as string, p]));
  const dims = o.score_breakdown?.dimensions;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Evidence and score</DialogTitle>
          <DialogDescription className="line-clamp-2">{o.title ?? o.idea}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1 text-[13px]">
          <section className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <ScoreMeter score={o.opportunity_score} />
            <Badge variant={o.insight_type === "data_supported" ? "success" : o.insight_type === "experiment" ? "warning" : "secondary"}>{EVIDENCE_LABELS[o.insight_type]}</Badge>
            <ConfidenceDots level={o.confidence} />
            <p className="w-full text-xs text-muted-foreground">{EVIDENCE_HELP[o.insight_type]}</p>
          </section>

          {dims ? (
            <section>
              <h4 className="mb-2 font-semibold">Why this score</h4>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">Dimension</th><th className="font-medium">Score</th><th className="font-medium">Weight</th><th className="font-medium">Basis</th><th className="pr-3 font-medium">Reason</th></tr></thead>
                  <tbody>
                    {DIMENSIONS.map((d) => {
                      const x = dims[d];
                      if (!x) return null;
                      return (
                        <tr key={d} className="border-b align-top last:border-0">
                          <td className="px-3 py-2 font-medium">{DIMENSION_LABELS[d]}</td>
                          <td className="py-2 tabular-nums">{x.score ?? "—"}</td>
                          <td className="py-2 tabular-nums">{x.basis === "excluded" ? "—" : x.weight}</td>
                          <td className="py-2"><span className={cn("rounded px-1.5 py-0.5", x.basis === "data" ? "bg-success/12 text-success" : x.basis === "ai" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{BASIS_LABEL[x.basis]}</span></td>
                          <td className="py-2 pr-3 text-muted-foreground">{x.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Formula: {o.score_breakdown!.formula}. Calculated dimensions come from the cited signals; AI judgments are the model’s ratings with their reasons.</p>
            </section>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">This idea was created by the historical analysis before scoring existed. Regenerate it to get a score and calculated evidence.</p>
          )}

          <section>
            <h4 className="mb-2 font-semibold">Supporting evidence</h4>
            {facts.length ? (
              <ol className="space-y-3">
                {facts.map((e, k) => {
                  const ids = e.ref_ids ?? (e.ref_id ? [e.ref_id] : []);
                  return (
                    <li key={k} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline">{KIND_LABEL[e.type] ?? e.type}</Badge>
                        {e.period?.from ? <span>Period {e.period.from} → {e.period.to}</span> : null}
                        {e.n ? <span>· {e.n} posts</span> : null}
                      </div>
                      <p>{e.note}</p>
                      {e.method ? <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Method:</span> {e.method}</p> : null}
                      {e.metrics && Object.keys(e.metrics).length ? (
                        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {Object.entries(e.metrics).filter(([, v]) => v != null).map(([key, v]) => <span key={key}>{key.replaceAll("_", " ")}: <span className="tabular-nums text-foreground">{String(v)}</span></span>)}
                        </p>
                      ) : null}
                      {ids.length ? (
                        <div className="mt-2 overflow-x-auto">
                          {!data && !error ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading posts…</p> : null}
                          {data ? (
                            <table className="w-full min-w-[520px] text-xs">
                              <thead className="text-left text-muted-foreground"><tr><th className="py-1 font-medium">Post</th><th className="font-medium">Date</th><th className="font-medium">Format</th><th className="font-medium">Engagement</th><th className="font-medium">Reach</th><th /></tr></thead>
                              <tbody>
                                {ids.map((id) => postsById.get(id)).filter(Boolean).map((p) => (
                                  <tr key={p!.id as string} className="border-t">
                                    <td className="max-w-[16rem] truncate py-1 pr-2"><span className="inline-flex items-center gap-1"><PlatformIcon platform={p!.platform as string} />{(p!.title as string) || (p!.caption as string)?.slice(0, 60) || "(untitled)"}</span></td>
                                    <td className="pr-2 tabular-nums">{(p!.actual_publication_date ?? p!.publication_date ?? (p!.published_at as string | null)?.slice(0, 10)) as string}</td>
                                    <td className="pr-2">{(p!.format as string) ?? "—"}</td>
                                    <td className="pr-2 tabular-nums">{engagementOf(p as never) ?? "—"}</td>
                                    <td className="pr-2 tabular-nums">{(p!.reach as number | null) ?? "—"}</td>
                                    <td>{p!.permalink ? <a href={p!.permalink as string} target="_blank" rel="noreferrer" className="inline-flex text-primary" aria-label="Open the post"><ExternalLink className="size-3.5" /></a> : null}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                No calculated signal supports this idea. {o.insight_type === "experiment" ? "It is an experiment: publish it and measure the result." : "It is a hypothesis: it has not been validated by your data yet."}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Engagement = {ENGAGEMENT_FORMULA}. Numbers are a snapshot taken when the idea was generated.</p>
          </section>

          <section>
            <h4 className="mb-2 font-semibold">Strategy</h4>
            <dl className="grid gap-1.5 text-xs sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Content pillar</dt><dd>{pillarName ?? "—"}</dd>
              <dt className="text-muted-foreground">Persona</dt><dd>{personaName ?? o.target_audience ?? "—"}</dd>
              <dt className="text-muted-foreground">Funnel stage</dt><dd>{o.funnel_stage ? FUNNEL_LABELS[o.funnel_stage] : "—"}</dd>
              <dt className="text-muted-foreground">Rationale</dt><dd>{o.rationale}</dd>
            </dl>
          </section>

          {reasoning.length ? (
            <section>
              <h4 className="mb-2 font-semibold">Assumptions (not shown by the data)</h4>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{reasoning.flatMap((r) => r.note.split("\n")).map((l, k) => <li key={k}>{l.replace(/^Assumption: /, "")}</li>)}</ul>
            </section>
          ) : null}

          {data?.linked.length ? (
            <section>
              <h4 className="mb-2 font-semibold">In the calendar</h4>
              <ul className="text-xs">{data.linked.map((p) => <li key={p.id}>{p.title} · {p.scheduled_date ?? "no date"} · {p.status}</li>)}</ul>
            </section>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateDialog({ projectId, pillars, initial, onClose }: {
  projectId: string;
  pillars: { id: string; name: string }[];
  initial: { pillar_id?: string; platform?: Platform; funnel_stage?: string; instruction?: string };
  onClose: () => void;
}) {
  const [form, setForm] = React.useState({ count: initial.instruction ? "3" : "8", pillar_id: initial.pillar_id ?? "", platform: initial.platform ?? "", funnel_stage: initial.funnel_stage ?? "", instruction: initial.instruction?.slice(0, 1000) ?? "" });
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    const r = await generateOpportunitiesAction(projectId, {
      count: Number(form.count),
      pillar_id: form.pillar_id || null,
      platform: (form.platform || null) as Platform | null,
      funnel_stage: (form.funnel_stage || null) as never,
      instruction: form.instruction || null,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate opportunities</DialogTitle>
          <DialogDescription>Built from your strategy, brand voice and the signals calculated from your posts. Near-duplicates of existing ideas are skipped.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium">How many
            <NativeSelect value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })}>{["3", "5", "8", "12"].map((n) => <option key={n}>{n}</option>)}</NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">Platform
            <NativeSelect value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}>
              <option value="">Any</option>
              {[...CALENDAR_PLATFORMS, ...PLATFORMS.filter((p) => !(CALENDAR_PLATFORMS as readonly string[]).includes(p) && p !== "other")].map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">Content pillar
            <NativeSelect value={form.pillar_id} onChange={(e) => setForm({ ...form, pillar_id: e.target.value })}>
              <option value="">Any</option>{pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">Funnel stage
            <NativeSelect value={form.funnel_stage} onChange={(e) => setForm({ ...form, funnel_stage: e.target.value })}>
              <option value="">Any</option>{FUNNEL_STAGES.map((f) => <option key={f} value={f}>{FUNNEL_LABELS[f]}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">Instruction (optional)
            <Textarea rows={2} maxLength={1000} value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="e.g. ideas for the Bac revision period, more videos with teachers" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "Analysing and writing… (about a minute)" : "Generate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RefineDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (instruction: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refine opportunity</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} autoFocus maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. make it a Reel with a teacher, target parents, add a stronger CTA" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !text.trim()} onClick={async () => { setBusy(true); await onSubmit(text.trim()); setBusy(false); }}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Refine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WeightsDialog({ projectId, weights, competitorData, onClose }: { projectId: string; weights: Weights; competitorData: boolean; onClose: () => void }) {
  const [w, setW] = React.useState<Record<string, string>>(Object.fromEntries(DIMENSIONS.map((d) => [d, String(weights[d])])));
  const [busy, setBusy] = React.useState(false);
  const total = DIMENSIONS.reduce((t, d) => t + (Number(w[d]) || 0), 0);
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scoring weights</DialogTitle>
          <DialogDescription>Score = Σ(dimension score × weight) ÷ Σ(weights). Saving recalculates every scored opportunity.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {DIMENSIONS.map((d) => (
            <label key={d} className="grid grid-cols-[1fr_5rem] items-center gap-3 text-[13px]">
              <span>{DIMENSION_LABELS[d]}{d === "differentiation" && !competitorData ? <span className="block text-[11px] text-muted-foreground">No competitor data yet: currently excluded</span> : null}</span>
              <Input type="number" min={0} max={100} value={w[d]} onChange={(e) => setW({ ...w, [d]: e.target.value })} className="h-8 text-right tabular-nums" />
            </label>
          ))}
          <p className="text-right text-xs text-muted-foreground">Total {total} (weights are relative; they don’t need to add up to 100)</p>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setW(Object.fromEntries(DIMENSIONS.map((d) => [d, String(DEFAULT_WEIGHTS[d])])))} disabled={busy}>Reset to defaults</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              disabled={busy || total <= 0}
              onClick={async () => {
                setBusy(true);
                const r = await saveWeightsAction(projectId, Object.fromEntries(DIMENSIONS.map((d) => [d, Number(w[d]) || 0])) as Weights);
                setBusy(false);
                if (!r.ok) return toast.error(r.error);
                toast.success(r.message);
                onClose();
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} Save weights
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
