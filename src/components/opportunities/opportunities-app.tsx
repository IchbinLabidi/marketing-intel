"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, FlaskConical, Lightbulb, ListFilter, SlidersHorizontal, Sparkles, Star, Target, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/app/empty-state";
import { PostEditor } from "@/components/calendar/post-editor";
import { pillarDotClass } from "@/components/calendar/styles";
import { FUNNEL_LABELS, FUNNEL_STAGES, PLATFORM_LABELS, type InsightType, type Platform } from "@/lib/domain/constants";
import type { PlatformTiming } from "@/lib/calendar/insights";
import { relevanceOf, type FeedbackKind, type Weights } from "@/lib/opportunities/scoring";
import { opportunityFeedbackAction, regenerateOpportunityAction, setOpportunityStateAction } from "@/server/actions/opportunities";
import { opportunityToProductionAction } from "@/server/actions/production";
import type { Opportunity, OpportunityFeedback } from "@/types/domain";
import { cn } from "@/lib/utils";
import { EVIDENCE_LABELS, OpportunityCard, STATE_LABELS } from "./opportunity-card";
import { EvidenceDialog, GenerateDialog, RefineDialog, WeightsDialog } from "./opportunity-dialogs";

type Linked = { id: string; opportunity_id: string | null; title: string; status: string; scheduled_date: string | null };
type Filters = { platform: string; pillar: string; funnel: string; format: string; minScore: string; confidence: string; evidence: string; status: string };
const NO_FILTERS: Filters = { platform: "", pillar: "", funnel: "", format: "", minScore: "", confidence: "", evidence: "", status: "active" };
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const;
type Sort = "relevance" | "score" | "confidence" | "newest";

export function OpportunitiesApp({
  projectId, opportunities, feedback, linked, pillars, personas, campaigns, tz, timing: timingPromise, weights, competitorData, hasHistory, readOnly, aiEnabled,
}: {
  projectId: string;
  opportunities: Opportunity[];
  feedback: OpportunityFeedback[];
  linked: Linked[];
  pillars: { id: string; name: string; color: string | null }[];
  personas: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  tz: string;
  timing: Promise<PlatformTiming[]>;
  weights: Weights;
  competitorData: boolean;
  hasHistory: boolean;
  readOnly: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const [sort, setSort] = React.useState<Sort>("relevance");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<
    | { kind: "evidence" | "refine" | "add"; o: Opportunity }
    | { kind: "generate"; initial: { pillar_id?: string; platform?: Platform; funnel_stage?: string } }
    | { kind: "weights" }
    | null
  >(null);
  const [timing, setTiming] = React.useState<PlatformTiming[]>([]);
  React.useEffect(() => {
    let live = true;
    timingPromise.then((t) => live && setTiming(t), () => live && setTiming([]));
    return () => { live = false; };
  }, [timingPromise]);

  const pillarRef = (id: string | null) => {
    const p = pillars.find((x) => x.id === id);
    return p ? { name: p.name, dot: pillarDotClass(pillars, p.id) } : null;
  };
  const linkedOf = (id: string) => linked.find((l) => l.opportunity_id === id) ?? null;

  // feedback joined with the attributes of the idea it was given on, for relevance
  const feedbackRows = React.useMemo(() => {
    const byId = new Map(opportunities.map((o) => [o.id, o]));
    return feedback.map((f) => ({ opportunity_id: f.opportunity_id, kind: f.kind, pillar_id: byId.get(f.opportunity_id)?.pillar_id ?? null, format: byId.get(f.opportunity_id)?.format ?? null }));
  }, [feedback, opportunities]);

  const active = opportunities.filter((o) => o.state !== "dismissed");
  const stats = {
    total: active.length,
    high: active.filter((o) => (o.opportunity_score ?? 0) >= 70).length,
    data: active.filter((o) => o.insight_type === "data_supported").length,
    hypotheses: active.filter((o) => o.insight_type !== "data_supported").length,
    calendar: opportunities.filter((o) => o.state === "scheduled" || o.state === "published").length,
    published: opportunities.filter((o) => o.state === "published").length,
  };
  const formats = [...new Set(opportunities.map((o) => o.format).filter((f): f is string => Boolean(f)))].sort();

  const visible = opportunities
    .filter((o) => {
      const f = filters;
      if (f.status === "active" ? o.state === "dismissed" : f.status && o.state !== f.status) return false;
      if (f.platform && o.platform !== f.platform) return false;
      if (f.pillar && (f.pillar === "none" ? o.pillar_id : o.pillar_id !== f.pillar)) return false;
      if (f.funnel && o.funnel_stage !== f.funnel) return false;
      if (f.format && o.format !== f.format) return false;
      if (f.minScore && (o.opportunity_score ?? -1) < Number(f.minScore)) return false;
      if (f.confidence && o.confidence !== f.confidence) return false;
      if (f.evidence && o.insight_type !== f.evidence) return false;
      return true;
    })
    .map((o) => ({ o, ...relevanceOf(o, feedbackRows) }))
    .sort((a, b) =>
      sort === "score" ? (b.o.opportunity_score ?? -1) - (a.o.opportunity_score ?? -1)
      : sort === "confidence" ? (CONF_RANK[b.o.confidence ?? "low"] ?? 0) - (CONF_RANK[a.o.confidence ?? "low"] ?? 0) || (b.o.opportunity_score ?? -1) - (a.o.opportunity_score ?? -1)
      : sort === "newest" ? b.o.created_at.localeCompare(a.o.created_at)
      : b.relevance - a.relevance,
    );
  const activeFilters = (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => filters[k] !== NO_FILTERS[k]).length;

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusyId(id);
    const r = await fn();
    setBusyId(null);
    if (!r.ok) toast.error(r.error);
    else if (r.message) toast.success(r.message);
    return r.ok;
  };
  const onFeedback = async (o: Opportunity, kind: FeedbackKind) => {
    const ok = await run(o.id, () => opportunityFeedbackAction(projectId, o.id, kind));
    if (ok && kind === "different_angle") await run(o.id, () => regenerateOpportunityAction(projectId, o.id, "Generate a clearly different angle on the same need"));
  };
  const onAdd = (o: Opportunity) => {
    const l = linkedOf(o.id);
    if (l) return router.push(`/p/${projectId}/calendar?view=${l.scheduled_date ? "day" : "month"}${l.scheduled_date ? `&date=${l.scheduled_date}` : ""}`);
    setDialog({ kind: "add", o });
  };

  const brief = (o: Opportunity) =>
    [o.creative_angle ? `Angle: ${o.creative_angle}` : "", o.target_audience ? `Audience: ${o.target_audience}` : "", `Why: ${o.rationale}`, o.suggested_timing ? `Timing: ${o.suggested_timing}` : ""]
      .filter(Boolean).join("\n").slice(0, 3000);

  return (
    <div className="space-y-6">
      {/* Overview */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Overview">
        <Stat icon={Lightbulb} label="Opportunities" value={stats.total} hint="Not dismissed" />
        <Stat icon={Star} label="High priority" value={stats.high} hint="Score 70 or more" />
        <Stat icon={Target} label="Data-supported" value={stats.data} hint="Backed by your data" />
        <Stat icon={FlaskConical} label="To validate" value={stats.hypotheses} hint="Hypotheses and experiments" />
        <Stat icon={CalendarCheck} label="In the calendar" value={stats.calendar} hint={`${stats.published} published`} className="col-span-2 md:col-span-1" />
      </section>

      {/* Toolbar */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly ? (
            <Button onClick={() => setDialog({ kind: "generate", initial: { pillar_id: filters.pillar && filters.pillar !== "none" ? filters.pillar : undefined, platform: (filters.platform || undefined) as Platform | undefined, funnel_stage: filters.funnel || undefined } })} disabled={!aiEnabled} title={!aiEnabled ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable AI features" : undefined}>
              <Sparkles /> Generate opportunities
            </Button>
          ) : null}
          {!readOnly ? <Button variant="outline" onClick={() => setDialog({ kind: "weights" })}><SlidersHorizontal /> Scoring weights</Button> : null}
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Sort
              <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 w-40 text-[13px]" aria-label="Sort opportunities">
                <option value="relevance">Relevance</option>
                <option value="score">Opportunity score</option>
                <option value="confidence">Confidence</option>
                <option value="newest">Newest</option>
              </NativeSelect>
            </label>
          </div>
        </div>
        <div className="grid gap-2 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <F label="Platform" value={filters.platform} onChange={(v) => setFilters({ ...filters, platform: v })} options={[...new Set(opportunities.map((o) => o.platform).filter(Boolean))].map((p) => ({ value: p!, label: PLATFORM_LABELS[p as Platform] ?? p! }))} />
          <F label="Pillar" value={filters.pillar} onChange={(v) => setFilters({ ...filters, pillar: v })} options={[...pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No pillar" }]} />
          <F label="Funnel" value={filters.funnel} onChange={(v) => setFilters({ ...filters, funnel: v })} options={FUNNEL_STAGES.map((f) => ({ value: f, label: FUNNEL_LABELS[f] }))} />
          <F label="Format" value={filters.format} onChange={(v) => setFilters({ ...filters, format: v })} options={formats.map((f) => ({ value: f, label: f }))} />
          <F label="Score" value={filters.minScore} onChange={(v) => setFilters({ ...filters, minScore: v })} options={[{ value: "50", label: "50 or more" }, { value: "70", label: "70 or more" }, { value: "85", label: "85 or more" }]} />
          <F label="Confidence" value={filters.confidence} onChange={(v) => setFilters({ ...filters, confidence: v })} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <F label="Evidence" value={filters.evidence} onChange={(v) => setFilters({ ...filters, evidence: v })} options={(Object.keys(EVIDENCE_LABELS) as InsightType[]).map((k) => ({ value: k, label: EVIDENCE_LABELS[k] }))} />
          <F label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} allLabel="All, incl. dismissed" options={[{ value: "active", label: "Active (not dismissed)" }, ...(Object.keys(STATE_LABELS) as Opportunity["state"][]).map((s) => ({ value: s, label: STATE_LABELS[s] }))]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><ListFilter className="size-3.5" /> {visible.length} of {opportunities.length} shown{sort === "relevance" ? " · relevance = score adjusted by your feedback on similar pillar/format (±20 max)" : ""}</span>
          {activeFilters ? <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}><X /> Clear filters</Button> : null}
        </div>
        {!competitorData ? (
          <p className="text-xs text-muted-foreground">No competitor posts yet, so differentiation is left out of scores and no competitor insight is claimed. Competitor Intelligence (Phase 6) will add them.</p>
        ) : null}
      </section>

      {/* List */}
      {!opportunities.length ? (
        <EmptyState
          icon={Lightbulb}
          title="No opportunities yet"
          description={hasHistory ? "Generate opportunities: they are built from your strategy and the signals calculated from your synced posts, each with its evidence and score." : "Connect Meta or import past content in Historical Intelligence first, so opportunities can be grounded in real results. You can still generate hypotheses from the strategy."}
          action={!readOnly && aiEnabled ? <Button onClick={() => setDialog({ kind: "generate", initial: {} })}><Sparkles /> Generate opportunities</Button> : null}
        />
      ) : !visible.length ? (
        <EmptyState icon={ListFilter} title="No opportunity matches these filters" action={<Button variant="outline" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map(({ o, adjust }) => (
            <OpportunityCard
              key={o.id}
              o={o}
              pillar={pillarRef(o.pillar_id)}
              relevanceAdjust={sort === "relevance" ? adjust : 0}
              linkedTitle={linkedOf(o.id)?.title ?? null}
              busy={busyId === o.id ? "busy" : null}
              readOnly={readOnly}
              aiEnabled={aiEnabled}
              onAdd={() => onAdd(o)}
              onProduction={async () => {
                const existing = linkedOf(o.id);
                if (existing) return router.push(`/p/${projectId}/production?item=${existing.id}`);
                setBusyId(o.id);
                try {
                  const r = await opportunityToProductionAction(projectId, o.id);
                  if (!r.ok) toast.error(r.error);
                  else if (r.data) router.push(`/p/${projectId}/production?item=${r.data.id}`);
                } catch { toast.error("Could not create production content. Try again."); }
                finally { setBusyId(null); }
              }}
              onOpenEvidence={() => setDialog({ kind: "evidence", o })}
              onFeedback={(k) => void onFeedback(o, k)}
              onRegenerate={() => void run(o.id, () => regenerateOpportunityAction(projectId, o.id, null))}
              onRefine={() => setDialog({ kind: "refine", o })}
              onState={(s) => void run(o.id, () => setOpportunityStateAction(projectId, o.id, s))}
            />
          ))}
        </div>
      )}

      {dialog?.kind === "evidence" ? (
        <EvidenceDialog projectId={projectId} o={dialog.o} pillarName={pillarRef(dialog.o.pillar_id)?.name ?? null} personaName={personas.find((p) => p.id === dialog.o.persona_id)?.name ?? null} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "generate" ? <GenerateDialog projectId={projectId} pillars={pillars} initial={dialog.initial} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "weights" ? <WeightsDialog projectId={projectId} weights={weights} competitorData={competitorData} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "refine" ? (
        <RefineDialog
          title={dialog.o.title ?? dialog.o.idea}
          onClose={() => setDialog(null)}
          onSubmit={async (instruction) => { if (await run(dialog.o.id, () => regenerateOpportunityAction(projectId, dialog.o.id, instruction))) setDialog(null); }}
        />
      ) : null}
      {dialog?.kind === "add" ? (
        <PostEditor
          projectId={projectId}
          post={null}
          defaults={{
            date: null,
            time: null,
            platform: (dialog.o.platform as Platform) ?? "instagram",
            opportunity_id: dialog.o.id,
            prefill: {
              title: (dialog.o.title ?? dialog.o.idea).slice(0, 300),
              format: dialog.o.format ?? "",
              pillar_id: dialog.o.pillar_id ?? "",
              funnel_stage: dialog.o.funnel_stage ?? "",
              hook: dialog.o.hook ?? "",
              cta: dialog.o.cta ?? "",
              creative_brief: brief(dialog.o),
            },
          }}
          pillars={pillars}
          campaigns={campaigns}
          tz={tz}
          timing={timing}
          aiEnabled={aiEnabled}
          readOnly={readOnly}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); toast.success("Added to the Editorial Calendar"); router.refresh(); }}
          onDeleted={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, className }: { icon: typeof Lightbulb; label: string; value: number; hint: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-xs", className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" /> {label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function F({ label, value, onChange, options, allLabel = "All" }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px] text-foreground">
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );
}
