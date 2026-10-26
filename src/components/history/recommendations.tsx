"use client";

import * as React from "react";
import { useTransition } from "react";
import { Bookmark, BookmarkCheck, CalendarCheck, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/app/empty-state";
import { FUNNEL_LABELS, INSIGHT_LABELS, PLATFORM_LABELS, type FunnelStage, type InsightType, type Platform } from "@/lib/domain/constants";
import { generateRecommendationsAction, setRecommendationStateAction } from "@/server/actions/history-intelligence";
import { stripRefs } from "@/lib/history/text";
import type { Opportunity } from "@/types/domain";

const INSIGHT_VARIANT: Record<InsightType, "success" | "default" | "warning"> = { data_supported: "success", hypothesis: "default", experiment: "warning" };
const CATEGORY_LABELS: Record<string, string> = {
  topic: "Topic to explore", refresh: "Angle to refresh", format_test: "Format to test", pillar: "Underused pillar",
  seasonal: "Seasonal opportunity", campaign: "Campaign idea", repurpose: "Content to repurpose",
};

export function Recommendations({
  projectId,
  opportunities,
  itemTitles,
  pillarNames,
  personaNames,
  topicGaps,
  reportDate,
  metricsImported,
  hasHistory,
  aiEnabled,
  readOnly,
}: {
  projectId: string;
  opportunities: Opportunity[];
  itemTitles: Record<string, { title: string; date: string | null }>;
  pillarNames: Record<string, string>;
  personaNames: Record<string, string>;
  topicGaps: { topic: string; why: string; pillar: string | null }[];
  reportDate: string | null;
  metricsImported: boolean;
  hasHistory: boolean;
  aiEnabled: boolean;
  readOnly: boolean;
}) {
  const [instruction, setInstruction] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = React.useState<InsightType | "all">("all");

  const generate = async () => {
    setGenerating(true);
    const r = await generateRecommendationsAction(projectId, instruction || undefined);
    setGenerating(false);
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  };
  const setState = (id: string, state: "new" | "in_progress" | "dismissed") =>
    startTransition(async () => {
      const r = await setRecommendationStateAction(projectId, id, state);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  const shown = opportunities.filter((o) => filter === "all" || o.insight_type === filter);

  return (
    <div className="space-y-6">
      {!readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Generate recommendations</CardTitle>
            <CardDescription>
              Claude reads your strategy (brand, objectives, personas, journey, funnel, pillars, voice, campaigns) together with the statistics above and the imported items.
              Each run replaces the previous unsaved recommendations; saved ones are kept.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="Optional focus, e.g. “prepare the Bac season”, “more TikTok for lycée students”"
              disabled={generating}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{reportDate ? `Last analysis: ${new Date(reportDate).toLocaleString()}` : "No analysis yet."}</p>
              <Button
                onClick={generate}
                disabled={generating || !aiEnabled || !hasHistory}
                title={!aiEnabled ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable AI features" : !hasHistory ? "Import a calendar first" : undefined}
              >
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {generating ? "Analysing… this can take up to a minute" : reportDate ? "Re-run analysis" : "Generate recommendations"}
              </Button>
            </div>
            {!metricsImported ? (
              <p className="text-xs text-muted-foreground">No performance metrics were imported, so recommendations cannot and will not claim what performed well.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {opportunities.length ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "data_supported", "hypothesis", "experiment"] as const).map((k) => (
              <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} onClick={() => setFilter(k)}>
                {k === "all" ? `All (${opportunities.length})` : `${INSIGHT_LABELS[k]} (${opportunities.filter((o) => o.insight_type === k).length})`}
              </Button>
            ))}
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((o) => (
              <li key={o.id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={INSIGHT_VARIANT[o.insight_type]}>{INSIGHT_LABELS[o.insight_type]}</Badge>
                  {o.creative_angle ? <Badge variant="outline">{CATEGORY_LABELS[o.creative_angle] ?? o.creative_angle}</Badge> : null}
                  {o.confidence ? <Badge variant="secondary">{o.confidence} confidence</Badge> : null}
                  {o.state === "in_progress" ? <Badge variant="success"><BookmarkCheck /> Saved</Badge> : null}
                  {o.state === "scheduled" ? <Badge variant="success"><CalendarCheck /> In a calendar</Badge> : null}
                </div>
                <p className="mt-2 font-medium">{stripRefs(o.title ?? o.idea)}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{stripRefs(o.rationale)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <Meta label="Pillar" value={o.pillar_id ? pillarNames[o.pillar_id] : null} />
                  <Meta label="Format" value={[o.format, o.platform ? PLATFORM_LABELS[o.platform as Platform] : null].filter(Boolean).join(" · ")} />
                  <Meta label="Funnel stage" value={o.funnel_stage ? FUNNEL_LABELS[o.funnel_stage as FunnelStage] : null} />
                  <Meta label="Persona" value={o.persona_id ? personaNames[o.persona_id] : o.target_audience} />
                  <Meta label="Timing" value={o.suggested_timing} wide />
                </dl>
                {o.evidence?.length ? (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-medium">Evidence ({o.evidence.length})</summary>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {o.evidence.map((e, k) => (
                        <li key={k}>
                          <span className="font-medium text-foreground">{e.type === "historical" ? "Past item" : e.type === "strategy" ? "Strategy" : "Statistic"}: </span>
                          {e.ref_id && itemTitles[e.ref_id] ? `${itemTitles[e.ref_id].date ?? "no date"} · ${itemTitles[e.ref_id].title} — ` : e.ref_id ? "(item deleted) — " : ""}
                          {stripRefs(e.note)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {!readOnly && o.state !== "scheduled" ? (
                  <div className="mt-3 flex justify-end gap-1">
                    {o.state === "in_progress" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "new")}><Bookmark /> Unsave</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "in_progress")}><Bookmark /> Save</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "dismissed")}><X /> Dismiss</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={Sparkles} title="No recommendations yet" description={hasHistory ? "Generate recommendations to turn the analysis into concrete ideas, each with its evidence." : "Import a historical calendar first."} />
      )}

      {topicGaps.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Strategy topics not covered by the history</CardTitle>
            <CardDescription>AI reading of the strategy against past content (hypotheses to validate).</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 md:grid-cols-2">
              {topicGaps.map((g, k) => (
                <li key={k} className="rounded-lg border p-3 text-[13px]">
                  <p className="font-medium">{g.topic}{g.pillar ? <span className="font-normal text-muted-foreground"> · {g.pillar}</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{g.why}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Meta({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="inline text-muted-foreground">{label}: </dt>
      <dd className="inline">{value || "—"}</dd>
    </div>
  );
}
