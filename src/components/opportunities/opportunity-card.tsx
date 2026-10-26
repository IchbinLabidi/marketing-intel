"use client";

import * as React from "react";
import {
  CalendarCheck, CalendarPlus, Check, ChevronDown, FileSearch, Loader2, MessageSquareWarning, MoreHorizontal, RefreshCcw, RotateCcw, Sparkles,
  ThumbsDown, ThumbsUp, Wand2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type InsightType, type Platform } from "@/lib/domain/constants";
import type { FeedbackKind } from "@/lib/opportunities/scoring";
import type { Opportunity } from "@/types/domain";
import { cn } from "@/lib/utils";

export const EVIDENCE_LABELS: Record<InsightType, string> = { data_supported: "Data-supported", hypothesis: "Hypothesis", experiment: "Experiment" };
export const EVIDENCE_HELP: Record<InsightType, string> = {
  data_supported: "Backed by calculated signals from your own posts or strategy.",
  hypothesis: "Reasoned from strategy and patterns; not validated by results yet.",
  experiment: "A deliberate test to find out whether it works.",
};
const EVIDENCE_VARIANT: Record<InsightType, "success" | "secondary" | "warning"> = { data_supported: "success", hypothesis: "secondary", experiment: "warning" };

export const STATE_LABELS: Record<Opportunity["state"], string> = {
  new: "New", in_progress: "Accepted / in production", scheduled: "Scheduled", published: "Published", dismissed: "Dismissed",
};

export const FEEDBACK_OPTIONS: { kind: FeedbackKind; label: string; icon: typeof ThumbsUp }[] = [
  { kind: "useful", label: "Useful", icon: ThumbsUp },
  { kind: "not_relevant", label: "Not relevant", icon: ThumbsDown },
  { kind: "already_covered", label: "Already covered", icon: Check },
  { kind: "not_aligned", label: "Not aligned with strategy", icon: MessageSquareWarning },
  { kind: "different_angle", label: "Generate a different angle", icon: RefreshCcw },
];

export function ScoreMeter({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return <span className={cn("text-xs text-muted-foreground", className)} title="Generated before scoring existed: regenerate to score it">Not scored</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={`Opportunity score ${score}/100`}>
      <span className="text-lg font-semibold tabular-nums leading-none">{score}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", score >= 70 ? "bg-primary" : score >= 50 ? "bg-primary/60" : "bg-muted-foreground/40")} style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}

export function ConfidenceDots({ level }: { level: Opportunity["confidence"] }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Confidence in the evidence (sample size and effect strength)">
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((k) => <span key={k} className={cn("size-1.5 rounded-full", k < n ? "bg-foreground/70" : "bg-muted-foreground/25")} />)}
      </span>
      {level ? `${level[0].toUpperCase()}${level.slice(1)} confidence` : "Confidence n/a"}
    </span>
  );
}

export function OpportunityCard({
  o, pillar, relevanceAdjust, linkedTitle, busy, readOnly, aiEnabled,
  onAdd, onProduction, onOpenEvidence, onFeedback, onRegenerate, onRefine, onState,
}: {
  o: Opportunity;
  pillar: { name: string; dot: string | null } | null;
  relevanceAdjust: number;
  linkedTitle: string | null;
  busy: string | null;
  readOnly: boolean;
  aiEnabled: boolean;
  onAdd: () => void;
  onProduction: () => void;
  onOpenEvidence: () => void;
  onFeedback: (kind: FeedbackKind) => void;
  onRegenerate: () => void;
  onRefine: () => void;
  onState: (state: "new" | "in_progress" | "dismissed") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const facts = o.evidence.filter((e, k, all) => e.type !== "ai_reasoning" && all.findIndex((x) => x.note === e.note) === k);
  const inCalendar = o.state === "scheduled" || o.state === "published";
  const dismissed = o.state === "dismissed";

  return (
    <article className={cn("flex flex-col rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-sm", dismissed && "opacity-60")}>
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {o.platform ? <span className="inline-flex items-center gap-1"><PlatformIcon platform={o.platform} /> {PLATFORM_LABELS[o.platform as Platform] ?? o.platform}</span> : null}
            {o.format ? <span>· {o.format}</span> : null}
            {o.funnel_stage ? <span>· {FUNNEL_LABELS[o.funnel_stage as FunnelStage]}</span> : null}
            {pillar ? (
              <span className="inline-flex items-center gap-1">· <span className={cn("size-1.5 rounded-full", pillar.dot ?? "bg-primary")} />{pillar.name}</span>
            ) : null}
          </div>
          <h3 className="text-[15px] font-semibold leading-snug">{o.title ?? o.idea}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreMeter score={o.opportunity_score} />
          {relevanceAdjust ? <span className="text-[11px] text-muted-foreground" title="Adjusted by your team's feedback on similar pillar/format">{relevanceAdjust > 0 ? "+" : ""}{relevanceAdjust} from feedback</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4">
        <Badge variant={EVIDENCE_VARIANT[o.insight_type]} title={EVIDENCE_HELP[o.insight_type]}>{EVIDENCE_LABELS[o.insight_type]}</Badge>
        <ConfidenceDots level={o.confidence} />
        <Badge variant={inCalendar ? "default" : "outline"} className="ml-auto">{inCalendar ? <CalendarCheck /> : null}{o.state === "in_progress" ? (linkedTitle ? "In production" : "Accepted") : STATE_LABELS[o.state]}</Badge>
      </div>

      <div className="space-y-3 p-4 text-[13px]">
        <p className={cn("text-muted-foreground", !open && "line-clamp-3")}>{o.rationale}</p>
        {o.hook ? (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-[13px] italic" dir="auto">{o.hook}</blockquote>
        ) : null}
        {open ? (
          <dl className="grid gap-2 text-[13px] sm:grid-cols-[7rem_1fr]">
            {o.target_audience ? <><dt className="text-muted-foreground">Audience</dt><dd>{o.target_audience}</dd></> : null}
            {o.creative_angle ? <><dt className="text-muted-foreground">Angle</dt><dd>{o.creative_angle}</dd></> : null}
            {o.cta ? <><dt className="text-muted-foreground">CTA</dt><dd dir="auto">{o.cta}</dd></> : null}
            {o.suggested_timing ? <><dt className="text-muted-foreground">Timing</dt><dd>{o.suggested_timing}</dd></> : null}
          </dl>
        ) : null}
        <div className="rounded-lg bg-muted/40 p-2.5 text-xs">
          <p className="mb-1 font-medium">Evidence</p>
          {facts.length ? (
            <ul className="space-y-1 text-muted-foreground">
              {facts.slice(0, open ? facts.length : 2).map((e, k) => <li key={k} className="line-clamp-2">• {e.note}</li>)}
              {!open && facts.length > 2 ? <li>+{facts.length - 2} more</li> : null}
            </ul>
          ) : (
            <p className="text-muted-foreground">No data signal: {o.insight_type === "experiment" ? "an experiment to validate." : "not yet validated by your results."}</p>
          )}
        </div>
        {linkedTitle ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarCheck className="size-3.5" /> Linked content: “{linkedTitle}”</p> : null}
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" aria-expanded={open}>
          {open ? "Show less" : "Audience, angle, CTA"} <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t p-3">
        {!readOnly && <Button size="sm" variant="outline" onClick={onProduction} disabled={busy !== null || dismissed}>{linkedTitle ? "Open production" : "Create content"}</Button>}
        {!readOnly ? (
          <Button size="sm" onClick={onAdd} disabled={busy !== null || dismissed} variant={inCalendar || linkedTitle ? "outline" : "default"}>
            {inCalendar || linkedTitle ? <CalendarCheck /> : <CalendarPlus />} {inCalendar || linkedTitle ? "Open in calendar" : "Add to Editorial Calendar"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onOpenEvidence}><FileSearch /> View evidence</Button>
        {!readOnly ? (
          <div className="ml-auto flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy !== null} aria-label="Feedback"><ThumbsUp /> Feedback</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Is this idea useful?</DropdownMenuLabel>
                {FEEDBACK_OPTIONS.map((f) => (
                  <DropdownMenuItem key={f.kind} disabled={f.kind === "different_angle" && (!aiEnabled || inCalendar)} onSelect={() => onFeedback(f.kind)}>
                    <f.icon /> {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" disabled={busy !== null} aria-label="More actions"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!aiEnabled || inCalendar} onSelect={onRegenerate}><Sparkles /> Regenerate</DropdownMenuItem>
                <DropdownMenuItem disabled={!aiEnabled || inCalendar} onSelect={onRefine}><Wand2 /> Refine…</DropdownMenuItem>
                <DropdownMenuSeparator />
                {o.state === "new" ? <DropdownMenuItem onSelect={() => onState("in_progress")}><Check /> Mark in progress</DropdownMenuItem> : null}
                {o.state === "in_progress" ? <DropdownMenuItem onSelect={() => onState("new")}><RotateCcw /> Back to New</DropdownMenuItem> : null}
                {dismissed ? (
                  <DropdownMenuItem onSelect={() => onState("new")}><RotateCcw /> Restore</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onState("dismissed")}><X /> Dismiss</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </article>
  );
}
