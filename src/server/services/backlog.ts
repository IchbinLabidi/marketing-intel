import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentItem } from "@/types/domain";
import type { ScoreDetails } from "@/lib/backlog/score";
import type { SuggestedSlot } from "@/lib/backlog/slots";

export type Idea = ContentItem & {
  description: string | null; tags: string[]; target_platforms: string[]; target_audience?: string | null;
  idea_score: number | null; score_details: ScoreDetails | null; suggested_slot: SuggestedSlot | null;
  archived_at: string | null; idea_source: string | null; created_at: string;
};

export type BacklogFilters = {
  q?: string; pillars?: string[]; formats?: string[]; platforms?: string[]; audience?: string;
  scoreMin?: number; scoreMax?: number; priorities?: string[]; stages?: string[];
  /** backlog = no calendar date; planned = placed on the calendar, not published; all = both */
  planning?: "backlog" | "planned" | "all"; archived?: boolean; tags?: string[];
  createdFrom?: string; createdTo?: string; suggestedFrom?: string; suggestedTo?: string;
  confidence?: string[]; slotTime?: string;
  sort?: "score" | "newest" | "oldest" | "priority" | "suggested" | "title";
};

export const BACKLOG_PAGE = 200;

/** Ideas of one brand (project), filtered on the server; paginated so thousands of ideas stay fast. */
export async function listIdeas(projectId: string, f: BacklogFilters, page = 0): Promise<{ ideas: Idea[]; total: number }> {
  const db = await createClient();
  let q = db.from("content_items").select("*", { count: "exact" }).eq("project_id", projectId);
  q = f.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const planning = f.planning ?? "backlog";
  if (planning === "backlog") q = q.is("scheduled_date", null);
  if (planning === "planned") q = q.not("scheduled_date", "is", null).neq("status", "published");
  if (planning === "all") q = q.neq("status", "published");
  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ").slice(0, 80);
    q = q.or(`title.ilike.%${term}%,description.ilike.%${term}%,hook.ilike.%${term}%`);
  }
  if (f.pillars?.length) q = f.pillars.includes("none") ? q.or(`pillar_id.is.null,pillar_id.in.(${f.pillars.filter((p) => p !== "none").join(",") || "00000000-0000-0000-0000-000000000000"})`) : q.in("pillar_id", f.pillars);
  if (f.formats?.length) q = q.in("format", f.formats);
  if (f.platforms?.length) q = q.or(`platform.in.(${f.platforms.join(",")}),target_platforms.ov.{${f.platforms.join(",")}}`);
  if (f.audience?.trim()) q = q.ilike("target_audience", `%${f.audience.trim().replace(/[%]/g, "")}%`);
  if (f.scoreMin != null) q = q.gte("idea_score", f.scoreMin);
  if (f.scoreMax != null) q = q.lte("idea_score", f.scoreMax);
  if (f.priorities?.length) q = q.in("priority", f.priorities);
  if (f.stages?.length) q = q.in("production_stage", f.stages);
  if (f.tags?.length) q = q.overlaps("tags", f.tags);
  if (f.createdFrom) q = q.gte("created_at", `${f.createdFrom}T00:00:00Z`);
  if (f.createdTo) q = q.lte("created_at", `${f.createdTo}T23:59:59Z`);
  if (f.suggestedFrom) q = q.gte("suggested_slot->>date", f.suggestedFrom);
  if (f.suggestedTo) q = q.lte("suggested_slot->>date", f.suggestedTo);
  if (f.confidence?.length) q = q.in("suggested_slot->>confidence", f.confidence);
  if (f.slotTime) q = q.eq("suggested_slot->>time", f.slotTime);
  switch (f.sort ?? "score") {
    case "newest": q = q.order("created_at", { ascending: false }); break;
    case "oldest": q = q.order("created_at", { ascending: true }); break;
    case "title": q = q.order("title"); break;
    case "suggested": q = q.order("suggested_slot->>date", { ascending: true, nullsFirst: false }); break;
    case "priority": q = q.order("priority", { ascending: true }).order("idea_score", { ascending: false, nullsFirst: false }); break;
    default: q = q.order("idea_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  }
  const { data, error, count } = await q.range(page * BACKLOG_PAGE, page * BACKLOG_PAGE + BACKLOG_PAGE - 1);
  if (error) throw error;
  return { ideas: (data ?? []) as Idea[], total: count ?? 0 };
}

/** Posts already placed per date in a range, to keep suggestions off full days. */
export async function busyDays(projectId: string, from: string, to: string): Promise<Record<string, number>> {
  const db = await createClient();
  const { data } = await db.from("content_items").select("scheduled_date").eq("project_id", projectId).gte("scheduled_date", from).lte("scheduled_date", to).is("archived_at", null);
  const out: Record<string, number> = {};
  for (const r of data ?? []) if (r.scheduled_date) out[r.scheduled_date] = (out[r.scheduled_date] ?? 0) + 1;
  return out;
}

export async function listTags(projectId: string): Promise<string[]> {
  const db = await createClient();
  const { data } = await db.from("content_items").select("tags").eq("project_id", projectId).not("tags", "eq", "{}").limit(2000);
  return [...new Set((data ?? []).flatMap((r) => (r.tags as string[]) ?? []))].sort().slice(0, 200);
}
