import "server-only";
import { cache } from "react";
import { FUNNEL_STAGES, type Platform } from "@/lib/domain/constants";
import { bestPublicationTimes } from "@/lib/calendar/insights";
import { todayInZone } from "@/lib/calendar/time";
import { computePerformance } from "@/lib/history/performance";
import { buildSignals } from "@/lib/opportunities/signals";
import { listHistoricalItems } from "./history";
import { publishedResults } from "./editorial";
import { competitorPostsForSignals } from "./opportunities";
import { serpSignalInputs } from "./serp";
import { getProjectContext, listChannels } from "./projects";
import { getStrategyBundle } from "./strategy";

/** The calculated signals for a project (real posts, strategy, imported competitor posts), once per request. */
export const loadSignals = cache(async (projectId: string) => {
  const { project } = await getProjectContext(projectId);
  const [items, bundle, channels, competitorItems, searchItems] = await Promise.all([
    listHistoricalItems(projectId),
    getStrategyBundle(projectId),
    listChannels(projectId),
    competitorPostsForSignals(projectId),
    serpSignalInputs(projectId),
  ]);
  const { learnings } = await publishedResults(projectId, items);
  const tz = project.timezone || "Africa/Tunis";
  const pillarName = (id: string) => bundle.pillars.find((p) => p.id === id)?.name;
  const performance = computePerformance(items, pillarName);
  const signals = buildSignals({
    items,
    performance,
    timing: bestPublicationTimes(items, tz),
    pillars: bundle.pillars.map((p) => ({ id: p.id, name: p.name, target_share: p.target_share })),
    strategyFunnel: FUNNEL_STAGES.filter((s) => (bundle.strategy?.funnel?.[s] ?? "").trim()),
    activePlatforms: [...new Set([...channels.filter((c) => c.is_active).map((c) => c.platform), ...items.map((i) => i.platform).filter((p): p is Platform => Boolean(p) && p !== "other")])],
    competitorItems: competitorItems.map((c) => ({ ...c, platform: c.platform as Platform | null })),
    today: todayInZone(tz),
    searchItems,
    learnings,
  });
  return { project, bundle, channels, signals, pillarName, competitorData: competitorItems.length >= 5, serpData: searchItems.length > 0, posts: items.length, items, performance };
});
