import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { OpportunitiesApp } from "@/components/opportunities/opportunities-app";
import { SignalsPanel } from "@/components/opportunities/signals-panel";
import { loadSignals } from "@/server/services/opportunity-signals";
import { canEdit } from "@/lib/domain/constants";
import { bestPublicationTimes } from "@/lib/calendar/insights";
import { normalizeWeights } from "@/lib/opportunities/scoring";
import { isAIConfigured } from "@/server/ai/client";
import { createClient } from "@/lib/supabase/server";
import { loadHistoryPerformance } from "@/server/services/history-analysis";
import { linkedPosts, listFeedback, listOpportunities } from "@/server/services/opportunities";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";
import { buildSignals } from "@/lib/opportunities/signals";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("opportunities");
  return { title: t("title") };
}

async function counts(projectId: string) {
  const supabase = await createClient();
  const [competitors, history] = await Promise.all([
    supabase.from("competitor_content_items").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("historical_content_items").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  return { competitors: competitors.count ?? 0, history: history.count ?? 0 };
}

async function Signals({ projectId, canGenerate }: { projectId: string; canGenerate: boolean }) {
  const [{ signalInput, posts, bundle }, t, td] = await Promise.all([loadSignals(projectId), getT("opportunities"), getT("domain")]);
  // same signals (same keys) as the engine, written in the viewer's language
  const signals = buildSignals(signalInput, t, td);
  return <SignalsPanel projectId={projectId} signals={signals} posts={posts} pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name }))} canGenerate={canGenerate} />;
}

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [{ project, role }, t] = await Promise.all([getProjectContext(projectId), getT("opportunities")]);
  const tz = project.timezone || "Africa/Tunis";
  // best times for the calendar editor's suggestions stream in; the list never waits for them
  const timing = loadHistoryPerformance(projectId).then((h) => bestPublicationTimes(h.items, tz));
  const [opportunities, feedback, linked, bundle, n] = await Promise.all([
    listOpportunities(projectId),
    listFeedback(projectId),
    linkedPosts(projectId),
    getStrategyBundle(projectId),
    counts(projectId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <Suspense fallback={<div className="h-[74px] animate-pulse rounded-xl border bg-card" aria-busy="true" aria-label={t("signals.panel.loading")} />}>
        <Signals projectId={projectId} canGenerate={canEdit(role) && isAIConfigured()} />
      </Suspense>
      <OpportunitiesApp
        projectId={projectId}
        opportunities={opportunities}
        feedback={feedback}
        linked={linked.map((l) => ({ id: l.id, opportunity_id: l.opportunity_id, title: l.title, status: l.status, scheduled_date: l.scheduled_date }))}
        pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name, color: p.color ?? null }))}
        personas={bundle.personas.map((p) => ({ id: p.id, name: p.name }))}
        campaigns={bundle.campaigns.map((c) => ({ id: c.id, name: c.name }))}
        tz={tz}
        timing={timing}
        weights={normalizeWeights(project.opportunity_weights)}
        competitorData={n.competitors >= 5}
        hasHistory={n.history > 0}
        readOnly={!canEdit(role)}
        aiEnabled={isAIConfigured()}
      />
    </div>
  );
}
