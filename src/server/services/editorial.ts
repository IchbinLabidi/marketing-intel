import "server-only";
import { cache } from "react";
import { METRICS, type Platform } from "@/lib/domain/constants";
import { evaluatePublished, learningsFrom } from "@/lib/editorial/feedback";
import type { Plan } from "@/lib/editorial/plan";
import type { Check } from "@/lib/editorial/optimizer";
import type { Source } from "@/lib/editorial/sources";
import { createClient } from "@/lib/supabase/server";
import type { ContentItem, EditorialCalendar, HistoricalItem } from "@/types/domain";

export type EngineCalendar = EditorialCalendar & {
  status: "draft" | "planned" | "generated" | "approved" | "saved";
  objective: string | null; plan: Plan | null; sources: Source[] | null; optimizer: { checks: Check[]; at: string } | null;
  approved_at: string | null;
};
export type EngineItem = ContentItem & {
  locked: boolean; topic: string | null; content_angle: string | null; rationale: string | null; visual_direction: string | null;
  format_details: Record<string, unknown> | null; objective_kpi: string | null; repetition: { with: string; with_title: string; kind: "exact" | "semantic"; similarity: number; note: string }[] | null;
};

export async function getEngineCalendar(projectId: string, id: string): Promise<EngineCalendar | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createClient();
  const { data, error } = await db.from("editorial_calendars").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as EngineCalendar | null;
}

export async function listEngineCalendars(projectId: string) {
  const db = await createClient();
  const { data, error } = await db.from("editorial_calendars").select("id, name, starts_on, ends_on, status, objective, created_at, approved_at, content_items(count)").eq("project_id", projectId).neq("status", "saved").order("starts_on", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, item_count: (c.content_items as { count: number }[])?.[0]?.count ?? 0 })) as (Pick<EngineCalendar, "id" | "name" | "starts_on" | "ends_on" | "status" | "objective" | "created_at" | "approved_at"> & { item_count: number })[];
}

export async function engineItems(projectId: string, calendarId: string): Promise<EngineItem[]> {
  const db = await createClient();
  const { data, error } = await db.from("content_items").select("*").eq("project_id", projectId).eq("calendar_id", calendarId).order("scheduled_date").order("position");
  if (error) throw error;
  return (data ?? []) as EngineItem[];
}

/** Estimated AI cost and tokens of everything done for one calendar (from the AI request log). */
export async function calendarAICost(calendarId: string) {
  const db = await createClient();
  const { data, error } = await db.from("ai_runs").select("feature, status, input_tokens, cached_input_tokens, output_tokens, cost_usd").eq("calendar_id", calendarId).limit(500);
  if (error) throw error;
  const rows = data ?? [];
  return {
    requests: rows.length,
    failed: rows.filter((r) => r.status === "failed").length,
    tokens: rows.reduce((t, r) => t + (r.input_tokens ?? 0) + (r.cached_input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
    cost: rows.reduce((t, r) => t + Number(r.cost_usd ?? 0), 0),
    unpriced: rows.filter((r) => r.cost_usd == null && r.status !== "running").length,
  };
}

/** Recent content for repetition checks: planned/published calendar posts and synced/imported posts (last ~6 months). */
export async function recentContent(projectId: string, sinceDate: string, excludeCalendarId?: string) {
  const db = await createClient();
  let q = db.from("content_items").select("id, title, topic, hook, content_angle, caption, platform, format, scheduled_date, calendar_id").eq("project_id", projectId).gte("scheduled_date", sinceDate).limit(600);
  if (excludeCalendarId) q = q.or(`calendar_id.is.null,calendar_id.neq.${excludeCalendarId}`);
  const [{ data: posts, error }, { data: hist, error: e2 }] = await Promise.all([
    q,
    db.from("historical_content_items").select("id, title, topic, caption, platform, format, publication_date, actual_publication_date").eq("project_id", projectId).gte("publication_date", sinceDate).limit(600),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  return [
    ...(posts ?? []).map((p) => ({ id: p.id as string, date: p.scheduled_date as string | null, platform: p.platform as string | null, title: p.title as string, topic: p.topic, hook: p.hook, angle: p.content_angle, caption: p.caption, format: p.format })),
    ...(hist ?? []).map((h) => ({ id: h.id as string, date: (h.actual_publication_date ?? h.publication_date) as string | null, platform: h.platform as string | null, title: (h.title ?? h.topic ?? (h.caption ?? "").slice(0, 120)) as string, topic: h.topic, hook: null, angle: null, caption: h.caption, format: h.format })),
  ];
}

/**
 * Feedback loop: published calendar posts (verified against the synced platform post, which carries the real metrics)
 * judged on their objective's KPI vs the platform's own history. Learnings need ≥2 posts with the same platform,
 * format and objective.
 */
export const publishedResults = cache(async (projectId: string, history: HistoricalItem[]) => {
  const db = await createClient();
  const { data, error } = await db.from("content_items").select("id, title, platform, format, pillar_id, funnel_stage, historical_source_id, calendar_id, published_at")
    .eq("project_id", projectId).eq("status", "published").not("historical_source_id", "is", null).order("published_at", { ascending: false }).limit(300);
  if (error) throw error;
  const byId = new Map(history.map((h) => [h.id, h]));
  const posts = (data ?? []).filter((p) => p.platform).map((p) => {
    const h = byId.get(p.historical_source_id as string);
    const metrics = h ? Object.fromEntries(METRICS.map((m) => [m, h[m as keyof HistoricalItem] as number | null])) : null;
    return { id: p.id as string, title: p.title as string, platform: p.platform as Platform, format: p.format, pillar_id: p.pillar_id, funnel_stage: p.funnel_stage, calendar_id: p.calendar_id as string | null, metrics };
  });
  // the baseline excludes the evaluated posts themselves
  const linked = new Set((data ?? []).map((d) => d.historical_source_id as string));
  const results = evaluatePublished(posts, history.filter((h) => !linked.has(h.id)));
  return { results: results.map((r) => ({ ...r, calendar_id: posts.find((p) => p.id === r.id)?.calendar_id ?? null })), learnings: learningsFrom(results) };
});

/** Counts behind the data-source report. */
export async function sourceCounts(projectId: string) {
  const db = await createClient();
  const head = { count: "exact" as const, head: true };
  const [comp, compPosts, compCounts, serp, cals, verified] = await Promise.all([
    db.from("competitors").select("id", head).eq("project_id", projectId),
    db.from("competitor_content_items").select("id", head).eq("project_id", projectId),
    db.from("competitor_content_items").select("id", head).eq("project_id", projectId).not("likes", "is", null),
    db.from("serp_analyses").select("keyword_normalized, fetched_at").eq("project_id", projectId).eq("status", "completed").order("fetched_at", { ascending: false }).limit(300),
    db.from("editorial_calendars").select("id", head).eq("project_id", projectId),
    db.from("content_items").select("id", head).eq("project_id", projectId).eq("status", "published").not("historical_source_id", "is", null),
  ]);
  return {
    competitors: { competitors: comp.count ?? 0, posts: compPosts.count ?? 0, withCounts: compCounts.count ?? 0 },
    serp: { analyses: serp.data?.length ?? 0, keywords: new Set((serp.data ?? []).map((s) => s.keyword_normalized)).size, lastDate: serp.data?.[0]?.fetched_at?.slice(0, 10) ?? null },
    calendars: cals.count ?? 0,
    verified: verified.count ?? 0,
  };
}
