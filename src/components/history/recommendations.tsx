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
import type { FunnelStage, InsightType } from "@/lib/domain/constants";
import { generateRecommendationsAction, setRecommendationStateAction } from "@/server/actions/history-intelligence";
import { stripRefs } from "@/lib/history/text";
import { platformLabel } from "@/lib/history/parse";
import type { Opportunity } from "@/types/domain";
import { useFormatter, useT } from "@/i18n/client";

const INSIGHT_VARIANT: Record<InsightType, "success" | "default" | "warning"> = { data_supported: "success", hypothesis: "default", experiment: "warning" };
const CATEGORIES = ["topic", "refresh", "format_test", "pillar", "seasonal", "campaign", "repurpose"] as const;

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
  const t = useT("history");
  const td = useT("domain");
  const fmt = useFormatter();
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
            <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {t("recommendations.generate")}</CardTitle>
            <CardDescription>
              {t("recommendations.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder={t("recommendations.placeholder")}
              disabled={generating}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{reportDate ? t("recommendations.lastAnalysis", { date: fmt.dateTime(reportDate) }) : t("recommendations.noAnalysis")}</p>
              <Button
                onClick={generate}
                disabled={generating || !aiEnabled || !hasHistory}
                title={!aiEnabled ? t("common.aiDisabled") : !hasHistory ? t("recommendations.importFirst") : undefined}
              >
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {generating ? t("recommendations.analysing") : reportDate ? t("recommendations.rerun") : t("recommendations.generate")}
              </Button>
            </div>
            {!metricsImported ? (
              <p className="text-xs text-muted-foreground">{t("recommendations.noMetrics")}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {opportunities.length ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "data_supported", "hypothesis", "experiment"] as const).map((k) => (
              <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} onClick={() => setFilter(k)}>
                {k === "all" ? t("recommendations.all", { count: opportunities.length }) : t("recommendations.filter", { label: td(`insight.${k}`), count: opportunities.filter((o) => o.insight_type === k).length })}
              </Button>
            ))}
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((o) => (
              <li key={o.id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={INSIGHT_VARIANT[o.insight_type]}>{td(`insight.${o.insight_type}`)}</Badge>
                  {o.creative_angle ? <Badge variant="outline">{(CATEGORIES as readonly string[]).includes(o.creative_angle) ? t(`recommendations.categories.${o.creative_angle as (typeof CATEGORIES)[number]}`) : o.creative_angle}</Badge> : null}
                  {o.confidence ? <Badge variant="secondary">{t(`recommendations.confidence.${o.confidence}`)}</Badge> : null}
                  {o.state === "in_progress" ? <Badge variant="success"><BookmarkCheck /> {t("recommendations.saved")}</Badge> : null}
                  {o.state === "scheduled" ? <Badge variant="success"><CalendarCheck /> {t("recommendations.inCalendar")}</Badge> : null}
                </div>
                <p className="mt-2 font-medium">{stripRefs(o.title ?? o.idea)}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{stripRefs(o.rationale)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <Meta label={t("recommendations.meta.pillar")} value={o.pillar_id ? pillarNames[o.pillar_id] : null} />
                  <Meta label={t("recommendations.meta.format")} value={[o.format, o.platform ? platformLabel(td, o.platform) : null].filter(Boolean).join(" · ")} />
                  <Meta label={t("recommendations.meta.funnel")} value={o.funnel_stage ? td(`funnel.${o.funnel_stage as FunnelStage}`) : null} />
                  <Meta label={t("recommendations.meta.persona")} value={o.persona_id ? personaNames[o.persona_id] : o.target_audience} />
                  <Meta label={t("recommendations.meta.timing")} value={o.suggested_timing} wide />
                </dl>
                {o.evidence?.length ? (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-medium">{t("recommendations.evidence", { count: o.evidence.length })}</summary>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {o.evidence.map((e, k) => (
                        <li key={k}>
                          <span className="font-medium text-foreground">{e.type === "historical" ? t("recommendations.evidenceType.historical") : e.type === "strategy" ? t("recommendations.evidenceType.strategy") : t("recommendations.evidenceType.statistic")}{t("recommendations.colon")} </span>
                          {e.ref_id && itemTitles[e.ref_id] ? `${itemTitles[e.ref_id].date ?? t("common.noDate")} · ${itemTitles[e.ref_id].title} — ` : e.ref_id ? t("recommendations.itemDeleted") : ""}
                          {stripRefs(e.note)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {!readOnly && o.state !== "scheduled" ? (
                  <div className="mt-3 flex justify-end gap-1">
                    {o.state === "in_progress" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "new")}><Bookmark /> {t("recommendations.unsave")}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "in_progress")}><Bookmark /> {t("recommendations.save")}</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setState(o.id, "dismissed")}><X /> {t("recommendations.dismiss")}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={Sparkles} title={t("recommendations.emptyTitle")} description={hasHistory ? t("recommendations.emptyDescription") : t("recommendations.emptyNoHistory")} />
      )}

      {topicGaps.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("recommendations.topicGaps")}</CardTitle>
            <CardDescription>{t("recommendations.topicGapsHint")}</CardDescription>
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
  const t = useT("history");
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="inline text-muted-foreground">{label}{t("recommendations.colon")} </dt>
      <dd className="inline">{value || "—"}</dd>
    </div>
  );
}
