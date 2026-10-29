import { notFound } from "next/navigation";
import { CompetitorDashboard, type AnalysisReport } from "@/components/competitors/dashboard";
import type { ProviderStatus } from "@/components/competitors/competitor-form";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { summarize } from "@/lib/competitors/analysis";
import { createClient } from "@/lib/supabase/server";
import { isAIConfigured } from "@/server/ai/client";
import { availabilityFor } from "@/server/competitors/providers";
import { followerHistory, getCompetitor, listCompetitorAds, listRuns, postsForAnalysis, projectCredentials } from "@/server/services/competitors";
import { getProjectContext } from "@/server/services/projects";

export const metadata = { title: "Competitor" };

export default async function Page({ params }: { params: Promise<{ projectId: string; competitorId: string }> }) {
  const { projectId, competitorId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const competitor = await getCompetitor(projectId, competitorId);
  if (!competitor) notFound();
  const db = await createClient();
  const [posts, runs, followers, creds, { data: report }, ads] = await Promise.all([
    postsForAnalysis(projectId, [competitorId], competitor.history_days, 2000),
    listRuns(projectId, competitorId, 8),
    followerHistory(projectId, competitor.competitor_channels.map((c) => c.id)),
    projectCredentials(projectId),
    db.from("analysis_reports").select("id, created_at, result").eq("project_id", projectId).eq("kind", "competitor").contains("scope", { competitor_ids: [competitorId] }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    listCompetitorAds(projectId, competitorId),
  ]);
  const summary = summarize(
    posts.map((p) => ({ id: p.id, account: p.channel_id ?? competitorId, platform: p.platform, published_at: p.published_at, format: p.format, caption: p.caption, hashtags: p.hashtags, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, views: p.views, followers: p.followers_at_collection, url: p.url, thumbnail_url: p.thumbnail_url })),
    { tz: project.timezone || "Africa/Tunis", periodDays: competitor.history_days, ignore: [competitor.name, ...competitor.competitor_channels.flatMap((c) => [c.display_name ?? "", c.handle ?? ""])] },
  );
  const providers: ProviderStatus = Object.fromEntries(competitor.competitor_channels.map((c) => {
    const a = availabilityFor(c.platform as Platform, creds);
    return [c.platform, { ok: a.ok, reason: a.ok ? undefined : a.reason, provider: a.provider }];
  }));
  const postLinks = Object.fromEntries(posts.map((p) => [p.id, { url: p.url, hook: p.hook }]));
  return (
    <CompetitorDashboard
      projectId={projectId} competitor={competitor} summary={summary} followers={followers} runs={runs}
      report={(report as AnalysisReport) ?? null} postLinks={postLinks} ads={ads} providers={providers} readOnly={!canEdit(role)} aiEnabled={isAIConfigured()}
    />
  );
}
