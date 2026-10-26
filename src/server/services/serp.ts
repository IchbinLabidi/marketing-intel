import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { IntentResult, PagesSummary } from "@/lib/serp/analysis";
import type { SerpItem } from "@/lib/serp/normalize";
import type { RankingPage } from "@/server/serp/pages";
import type { SeoBrief, SerpInsight } from "@/server/ai/serp";

export type SerpAnalysis = {
  id: string; project_id: string; keyword: string; keyword_normalized: string; country: string; language: string; search_engine: string;
  device: "desktop" | "mobile"; location: string | null; provider: string; provider_search_id: string | null; status: "running" | "completed" | "failed";
  error: string | null; total_results: number | null; features: string[]; intent: IntentResult | null;
  competitors: { pages: RankingPage[]; summary: PagesSummary } | null; ai_analysis: (SerpInsight & { created_at: string }) | null;
  fetched_at: string | null; created_at: string;
};
export type StoredSerpItem = SerpItem & { id: string; analysis_id: string };
export type SeoBriefRow = { id: string; project_id: string; analysis_id: string | null; opportunity_id: string | null; content_item_id: string | null; keyword: string; country: string; language: string; brief: SeoBrief; draft: string | null; created_at: string; updated_at: string };

export async function listAnalyses(projectId: string, limit = 300) {
  const db = await createClient();
  const { data, error } = await db.from("serp_analyses").select("id, project_id, keyword, keyword_normalized, country, language, search_engine, device, location, provider, provider_search_id, status, error, total_results, features, intent, fetched_at, created_at, own_position:competitors->summary->ownPosition").eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, competitors: null, ai_analysis: null })) as unknown as (SerpAnalysis & { own_position: number | null })[];
}

export async function getAnalysis(projectId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const [{ data: a, error }, { data: items, error: e2 }] = await Promise.all([
    db.from("serp_analyses").select("*").eq("project_id", projectId).eq("id", id).maybeSingle(),
    db.from("serp_items").select("*").eq("project_id", projectId).eq("analysis_id", id).order("type").order("position"),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  return a ? { analysis: a as SerpAnalysis, items: (items ?? []) as StoredSerpItem[] } : null;
}

export async function itemsFor(projectId: string, analysisIds: string[]) {
  if (!analysisIds.length) return [];
  const db = await createClient();
  const { data, error } = await db.from("serp_items").select("*").eq("project_id", projectId).in("analysis_id", analysisIds).limit(5000);
  if (error) throw error;
  return (data ?? []) as StoredSerpItem[];
}

/** Latest completed snapshot per keyword × market, with its People-also-ask questions and related searches (signals). */
export async function serpSignalInputs(projectId: string, max = 12) {
  const latest = new Map<string, SerpAnalysis & { own_position: number | null }>();
  for (const a of await listAnalyses(projectId)) {
    const k = `${a.keyword_normalized}|${a.country}|${a.language}`;
    if (a.status === "completed" && !latest.has(k)) latest.set(k, a);
  }
  const picked = [...latest.values()].slice(0, max);
  if (!picked.length) return [];
  const db = await createClient();
  const { data, error } = await db.from("serp_items").select("analysis_id, type, title").eq("project_id", projectId).in("analysis_id", picked.map((a) => a.id)).in("type", ["people_also_ask", "related_search", "organic"]).limit(2000);
  if (error) throw error;
  const of = (id: string, type: string) => (data ?? []).filter((i) => i.analysis_id === id && i.type === type).map((i) => i.title as string).filter(Boolean);
  return picked.map((a) => ({
    id: a.id, keyword: a.keyword, country: a.country, language: a.language, intent: a.intent?.primary ?? null, ownPosition: a.own_position ?? null,
    questions: of(a.id, "people_also_ask"), related: of(a.id, "related_search"), resultsRead: of(a.id, "organic").length, date: (a.fetched_at ?? a.created_at).slice(0, 10),
  }));
}

export async function listBriefs(projectId: string): Promise<SeoBriefRow[]> {
  const db = await createClient();
  const { data, error } = await db.from("seo_briefs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as SeoBriefRow[];
}

export async function getBrief(projectId: string, id: string): Promise<SeoBriefRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const { data, error } = await db.from("seo_briefs").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as SeoBriefRow | null;
}
