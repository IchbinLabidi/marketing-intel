import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentItem, Opportunity, OpportunityFeedback, OpportunityState } from "@/types/domain";

export async function listOpportunities(projectId: string): Promise<Opportunity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Opportunity[];
}

export async function getOpportunity(projectId: string, id: string): Promise<Opportunity | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").select("*").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as Opportunity | null;
}

export async function insertOpportunities(projectId: string, rows: Partial<Opportunity>[]) {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").insert(rows.map((r) => ({ ...r, project_id: projectId }))).select("*");
  if (error) throw error;
  return (data ?? []) as Opportunity[];
}

export async function updateOpportunity(projectId: string, id: string, values: Partial<Opportunity>) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunities").update(values).eq("id", id).eq("project_id", projectId).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Opportunity not found or read-only.");
  return data as Opportunity;
}

export async function setOpportunitiesState(projectId: string, ids: string[], state: OpportunityState) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("opportunities").update({ state, status_changed_at: new Date().toISOString() }).eq("project_id", projectId).in("id", ids);
  if (error) throw error;
}

export async function listFeedback(projectId: string, limit = 300): Promise<OpportunityFeedback[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("opportunity_feedback").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as OpportunityFeedback[];
}

export async function insertFeedback(projectId: string, values: Pick<OpportunityFeedback, "opportunity_id" | "user_id" | "kind" | "note">) {
  const supabase = await createClient();
  const { error } = await supabase.from("opportunity_feedback").insert({ ...values, project_id: projectId });
  if (error) throw error;
}

/** Calendar posts created from opportunities (to show links, prevent duplicates and track outcomes). */
export async function linkedPosts(projectId: string, opportunityIds?: string[]) {
  const supabase = await createClient();
  let q = supabase
    .from("content_items")
    .select("id, opportunity_id, title, status, scheduled_date, scheduled_time, platform, published_at, likes, comments, shares, saves, reach")
    .eq("project_id", projectId)
    .not("opportunity_id", "is", null);
  if (opportunityIds) q = q.in("opportunity_id", opportunityIds);
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return (data ?? []) as Pick<ContentItem, "id" | "opportunity_id" | "title" | "status" | "scheduled_date" | "scheduled_time" | "platform" | "published_at">[] &
    { likes: number | null; comments: number | null; shares: number | null; saves: number | null; reach: number | null }[];
}

/**
 * Keeps an opportunity's status in line with its content: any published → published, any scheduled → scheduled,
 * otherwise in progress (same rule as the production_audit trigger, which also applies it on database writes).
 * A dismissed opportunity stays dismissed unless it gets content.
 */
export async function syncOpportunityState(projectId: string, opportunityId: string | null | undefined) {
  if (!opportunityId) return;
  const opp = await getOpportunity(projectId, opportunityId);
  if (!opp) return;
  const posts = await linkedPosts(projectId, [opportunityId]);
  const next: OpportunityState =
    posts.some((p) => p.status === "published") ? "published"
    : posts.some((p) => p.status === "scheduled") ? "scheduled"
    : posts.length ? "in_progress"
    : opp.state === "scheduled" || opp.state === "published" ? "in_progress"
    : opp.state;
  if (next !== opp.state) await setOpportunitiesState(projectId, [opportunityId], next);
}

/** Historical posts by id (for "View evidence"): only the fields shown, for one project. */
export async function evidencePosts(projectId: string, ids: string[]) {
  const clean = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 60);
  if (!clean.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("historical_content_items")
    .select("id, platform, title, topic, caption, format, publication_date, actual_publication_date, published_at, permalink, likes, comments, shares, saves, reach, views, pillar_id")
    .eq("project_id", projectId)
    .in("id", clean);
  if (error) throw error;
  return data ?? [];
}

export async function competitorPostsForSignals(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitor_content_items")
    .select("id, platform, title, topic, caption, likes, comments, shares, published_at, competitors(name)")
    .eq("project_id", projectId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id as string, platform: c.platform, title: c.title, topic: c.topic, caption: c.caption, likes: c.likes, comments: c.comments, shares: c.shares,
    published_at: c.published_at, competitor: ((c.competitors as unknown as { name: string } | null)?.name) ?? "Competitor",
  }));
}

export async function setProjectWeights(projectId: string, weights: object) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ opportunity_weights: weights }).eq("id", projectId);
  if (error) throw error;
}
