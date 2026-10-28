import "server-only";
import { cache } from "react";
import { computeHistoricalStats } from "@/lib/history/analysis";
import { computePerformance } from "@/lib/history/performance";
import { normalizeText } from "@/lib/history/text";
import { getBrandProfile, getProjectContext, listChannels } from "./projects";
import { getStrategyBundle } from "./strategy";
import { listHistoricalItems, PERFORMANCE_COLUMNS } from "./history";

/**
 * Historical posts (performance columns only) and their performance, without the CPU-heavy descriptive stats.
 * Used by the calendar, which renders on every navigation and drag.
 */
export const loadHistoryPerformance = cache(async (projectId: string) => {
  const { project, role } = await getProjectContext(projectId);
  const [items, bundle] = await Promise.all([listHistoricalItems(projectId, PERFORMANCE_COLUMNS), getStrategyBundle(projectId)]);
  const pillarName = (id: string) => bundle.pillars.find((p) => p.id === id)?.name;
  const performance = computePerformance(items, pillarName);
  return { project, role, items, bundle, performance };
});

/** Everything the Content history screens and AI actions need, loaded once per request. */
export const loadHistoryAnalysis = cache(async (projectId: string) => {
  const { project, role } = await getProjectContext(projectId);
  const [items, bundle, channels, brand] = await Promise.all([
    listHistoricalItems(projectId),
    getStrategyBundle(projectId),
    listChannels(projectId),
    getBrandProfile(projectId),
  ]);
  // Ramadan is analysed only when the brand's strategy or history mentions it.
  const corpus = normalizeText(
    [
      bundle.strategy?.business_objectives, bundle.strategy?.marketing_objectives, project.description,
      ...bundle.campaigns.flatMap((c) => [c.name, c.description, c.objective]),
      ...items.slice(0, 3000).flatMap((i) => [i.title, i.topic, i.campaign]),
    ].join(" "),
  );
  const ramadanRelevant = /\bramadan\b|رمضان/.test(corpus);
  const stats = computeHistoricalStats(items, {
    pillars: bundle.pillars.map((p) => ({ id: p.id, name: p.name, target_share: p.target_share })),
    campaigns: bundle.campaigns.map((c) => ({ id: c.id, name: c.name })),
    channels,
    ramadanRelevant,
  });
  const pillarName = (id: string) => bundle.pillars.find((p) => p.id === id)?.name;
  const performance = computePerformance(items, pillarName);
  // posts the performance analysis cites; prompts must be able to reference them
  const citedIds = new Set(performance.flatMap((p) => [...p.top, ...p.bottom, ...p.refreshCandidates].map((x) => x.id)));
  return { project, role, items, bundle, channels, brand, stats, performance, citedIds, pillarName, ramadanRelevant };
});
