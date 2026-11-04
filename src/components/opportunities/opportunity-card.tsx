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
import { PLATFORM_LABELS, type FunnelStage, type InsightType, type Platform } from "@/lib/domain/constants";
import type { FeedbackKind } from "@/lib/opportunities/scoring";
import type { Opportunity } from "@/types/domain";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Evidence classes, in display order (labels: `opportunities.evidence.<type>.label|help`). */
export const EVIDENCE_TYPES: InsightType[] = ["data_supported", "hypothesis", "experiment"];
const EVIDENCE_VARIANT: Record<InsightType, "success" | "secondary" | "warning"> = { data_supported: "success", hypothesis: "secondary", experiment: "warning" };

/** Opportunity states, in display order (labels: `opportunities.state.<state>`). */
export const STATES: Opportunity["state"][] = ["new", "in_progress", "scheduled", "published", "dismissed"];

export const FEEDBACK_OPTIONS: { kind: FeedbackKind; icon: typeof ThumbsUp }[] = [
  { kind: "useful", icon: ThumbsUp },
  { kind: "not_relevant", icon: ThumbsDown },
  { kind: "already_covered", icon: Check },
  { kind: "not_aligned", icon: MessageSquareWarning },
  { kind: "different_angle", icon: RefreshCcw },
];

export function ScoreMeter({ score, className }: { score: number | null; className?: string }) {
  const t = useT("opportunities");
  if (score == null) return <span className={cn("text-xs text-muted-foreground", className)} title={t("score.notScoredHelp")}>{t("score.notScored")}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={t("score.title", { score })}>
      <span className="text-lg font-semibold tabular-nums leading-none">{score}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", score >= 70 ? "bg-primary" : score >= 50 ? "bg-primary/60" : "bg-muted-foreground/40")} style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}

export function ConfidenceDots({ level }: { level: Opportunity["confidence"] }) {
  const t = useT("opportunities");
  const n = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={t("confidence.help")}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((k) => <span key={k} className={cn("size-1.5 rounded-full", k < n ? "bg-foreground/70" : "bg-muted-foreground/25")} />)}
      </span>
      {level ? t(`confidence.${level}`) : t("confidence.na")}
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
  const t = useT("opportunities");
  const td = useT("domain");
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
            {o.funnel_stage ? <span>· {td(`funnel.${o.funnel_stage as FunnelStage}`)}</span> : null}
            {pillar ? (
              <span className="inline-flex items-center gap-1">· <span className={cn("size-1.5 rounded-full", pillar.dot ?? "bg-primary")} />{pillar.name}</span>
            ) : null}
          </div>
          <h3 className="text-[15px] font-semibold leading-snug">{o.title ?? o.idea}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreMeter score={o.opportunity_score} />
          {relevanceAdjust ? <span className="text-[11px] text-muted-foreground" title={t("card.feedbackAdjustHelp")}>{t("card.feedbackAdjust", { adjust: `${relevanceAdjust > 0 ? "+" : ""}${relevanceAdjust}` })}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4">
        <Badge variant={EVIDENCE_VARIANT[o.insight_type]} title={t(`evidence.${o.insight_type}.help`)}>{t(`evidence.${o.insight_type}.label`)}</Badge>
        <ConfidenceDots level={o.confidence} />
        <Badge variant={inCalendar ? "default" : "outline"} className="ml-auto">{inCalendar ? <CalendarCheck /> : null}{o.state === "in_progress" ? (linkedTitle ? t("card.inProduction") : t("card.accepted")) : t(`state.${o.state}`)}</Badge>
      </div>

      <div className="space-y-3 p-4 text-[13px]">
        <p className={cn("text-muted-foreground", !open && "line-clamp-3")}>{o.rationale}</p>
        {o.hook ? (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-[13px] italic" dir="auto">{o.hook}</blockquote>
        ) : null}
        {open ? (
          <dl className="grid gap-2 text-[13px] sm:grid-cols-[7rem_1fr]">
            {o.target_audience ? <><dt className="text-muted-foreground">{t("card.audience")}</dt><dd>{o.target_audience}</dd></> : null}
            {o.creative_angle ? <><dt className="text-muted-foreground">{t("card.angle")}</dt><dd>{o.creative_angle}</dd></> : null}
            {o.cta ? <><dt className="text-muted-foreground">{t("card.cta")}</dt><dd dir="auto">{o.cta}</dd></> : null}
            {o.suggested_timing ? <><dt className="text-muted-foreground">{t("card.timing")}</dt><dd>{o.suggested_timing}</dd></> : null}
          </dl>
        ) : null}
        <div className="rounded-lg bg-muted/40 p-2.5 text-xs">
          <p className="mb-1 font-medium">{t("card.evidence")}</p>
          {facts.length ? (
            <ul className="space-y-1 text-muted-foreground">
              {facts.slice(0, open ? facts.length : 2).map((e, k) => <li key={k} className="line-clamp-2">• {e.note}</li>)}
              {!open && facts.length > 2 ? <li>{t("card.more", { count: facts.length - 2 })}</li> : null}
            </ul>
          ) : (
            <p className="text-muted-foreground">{o.insight_type === "experiment" ? t("card.noSignalExperiment") : t("card.noSignalHypothesis")}</p>
          )}
        </div>
        {linkedTitle ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarCheck className="size-3.5" /> {t("card.linked", { title: linkedTitle })}</p> : null}
        <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" aria-expanded={open}>
          {open ? t("card.showLess") : t("card.showMore")} <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t p-3">
        {!readOnly && <Button size="sm" variant="outline" onClick={onProduction} disabled={busy !== null || dismissed}>{linkedTitle ? t("card.openProduction") : t("card.createContent")}</Button>}
        {!readOnly ? (
          <Button size="sm" onClick={onAdd} disabled={busy !== null || dismissed} variant={inCalendar || linkedTitle ? "outline" : "default"}>
            {inCalendar || linkedTitle ? <CalendarCheck /> : <CalendarPlus />} {inCalendar || linkedTitle ? t("card.openInCalendar") : t("card.addToCalendar")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onOpenEvidence}><FileSearch /> {t("card.viewEvidence")}</Button>
        {!readOnly ? (
          <div className="ml-auto flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={t("card.feedback")}><ThumbsUp /> {t("card.feedback")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("card.feedbackQuestion")}</DropdownMenuLabel>
                {FEEDBACK_OPTIONS.map((f) => (
                  <DropdownMenuItem key={f.kind} disabled={f.kind === "different_angle" && (!aiEnabled || inCalendar)} onSelect={() => onFeedback(f.kind)}>
                    <f.icon /> {t(`feedback.${f.kind}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" disabled={busy !== null} aria-label={t("card.moreActions")}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!aiEnabled || inCalendar} onSelect={onRegenerate}><Sparkles /> {t("card.regenerate")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!aiEnabled || inCalendar} onSelect={onRefine}><Wand2 /> {t("card.refine")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                {o.state === "new" ? <DropdownMenuItem onSelect={() => onState("in_progress")}><Check /> {t("card.markInProgress")}</DropdownMenuItem> : null}
                {o.state === "in_progress" ? <DropdownMenuItem onSelect={() => onState("new")}><RotateCcw /> {t("card.backToNew")}</DropdownMenuItem> : null}
                {dismissed ? (
                  <DropdownMenuItem onSelect={() => onState("new")}><RotateCcw /> {t("card.restore")}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onState("dismissed")}><X /> {t("card.dismiss")}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </article>
  );
}
