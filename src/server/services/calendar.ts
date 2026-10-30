import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentItem, EditorialCalendar } from "@/types/domain";

export async function listCalendars(projectId: string): Promise<(EditorialCalendar & { item_count: number })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_calendars")
    .select("*, content_items(count)")
    .eq("project_id", projectId)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...(c as EditorialCalendar), item_count: (c.content_items as { count: number }[])?.[0]?.count ?? 0 }));
}

export async function listCalendarItems(projectId: string, calendarId: string): Promise<ContentItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("project_id", projectId)
    .eq("calendar_id", calendarId)
    .order("scheduled_date")
    .order("position");
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

/** Creates the calendar and its items. Items are inserted as "planned": nothing is scheduled or published. */
export async function createCalendarWithItems(
  projectId: string,
  userId: string,
  calendar: { name: string; starts_on: string; ends_on: string; settings: object },
  items: Partial<Omit<ContentItem, "id" | "project_id" | "calendar_id" | "status">>[],
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_calendars")
    .insert({ ...calendar, project_id: projectId, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  const rows = items.map((i, position) => ({ ...i, project_id: projectId, calendar_id: data.id, status: "planned", position, created_by: userId }));
  const ins = await supabase.from("content_items").insert(rows);
  if (ins.error) {
    await supabase.from("editorial_calendars").delete().eq("id", data.id);
    throw ins.error;
  }
  return data.id as string;
}

// --- Calendar posts (content_items) -----------------------------------------------------------------------

export type PostFilters = {
  platforms?: string[];
  pillars?: string[];        // pillar ids, or "none"
  funnel?: string[];
  statuses?: string[];       // content_status values
  campaign?: string | null;
  plan?: string | null;      // editorial_calendars.id
  assignee?: string | null;  // user id, or "none" for unassigned
  priorities?: string[];
  formats?: string[];
  search?: string | null;
  /** restrict to these content ids (e.g. "my work"); an empty array matches nothing */
  ids?: string[] | null;
  /** internal deadline before this date and not yet approved/scheduled/published */
  overdueBefore?: string | null;
};

function applyFilters<Q extends { in: (c: string, v: string[]) => Q; eq: (c: string, v: string) => Q; or: (f: string) => Q; is: (c: string, v: null) => Q; ilike: (c: string, v: string) => Q; lt: (c: string, v: string) => Q; not: (c: string, op: string, v: string) => Q }>(q: Q, f: PostFilters) {
  if (f.platforms?.length) q = q.in("platform", f.platforms);
  if (f.pillars?.length) {
    const ids = f.pillars.filter((p) => p !== "none");
    q = f.pillars.includes("none") ? q.or([...ids.map((id) => `pillar_id.eq.${id}`), "pillar_id.is.null"].join(",")) : q.in("pillar_id", ids);
  }
  if (f.funnel?.length) q = q.in("funnel_stage", f.funnel);
  if (f.statuses?.length) q = q.in("status", f.statuses);
  if (f.campaign) q = q.eq("campaign_id", f.campaign);
  if (f.plan) q = q.eq("calendar_id", f.plan);
  if (f.assignee === "none") q = q.is("assignee_id", null);
  else if (f.assignee) q = q.eq("assignee_id", f.assignee);
  if (f.priorities?.length) q = q.in("priority", f.priorities);
  if (f.formats?.length) q = q.in("format", f.formats);
  // PostgREST filter values: strip characters that would break the expression
  if (f.search) q = q.ilike("title", `%${f.search.replace(/[%_,()]/g, " ").trim()}%`);
  if (f.ids) q = q.in("id", f.ids.length ? f.ids : ["00000000-0000-0000-0000-000000000000"]);
  if (f.overdueBefore) q = q.lt("due_date", f.overdueBefore).not("status", "in", "(approved,scheduled,published)");
  return q;
}

/**
 * Posts in [fromUtc, toUtc) by exact slot, plus date-only posts (no time yet) whose local date is in [fromDate, toDate].
 */
export async function listPostsInRange(projectId: string, range: { fromUtc: string; toUtc: string; fromDate: string; toDate: string }, filters: PostFilters) {
  const supabase = await createClient();
  let q = supabase
    .from("content_items")
    .select("*")
    .eq("project_id", projectId)
    .or(`and(scheduled_at.gte.${range.fromUtc},scheduled_at.lt.${range.toUtc}),and(scheduled_at.is.null,scheduled_date.gte.${range.fromDate},scheduled_date.lte.${range.toDate})`);
  q = applyFilters(q, filters);
  const { data, error } = await q.order("scheduled_at", { ascending: true, nullsFirst: false }).order("position").limit(2000);
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

/** Content whose internal deadline (due_date) falls in [fromDate, toDate], whatever its publication date. */
export async function listDeadlinesInRange(projectId: string, fromDate: string, toDate: string, filters: PostFilters) {
  const supabase = await createClient();
  let q = supabase.from("content_items").select("*").eq("project_id", projectId).gte("due_date", fromDate).lte("due_date", toDate);
  q = applyFilters(q, filters);
  const { data, error } = await q.order("due_date").limit(1000);
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

/** Ids of content the user leads or collaborates on (for the "My work" filter). */
export async function myContentIds(projectId: string, userId: string) {
  const supabase = await createClient();
  const [lead, tasks] = await Promise.all([
    supabase.from("content_items").select("id").eq("project_id", projectId).eq("assignee_id", userId).limit(2000),
    supabase.from("content_assignments").select("content_item_id").eq("project_id", projectId).eq("user_id", userId).limit(2000),
  ]);
  return [...new Set([...(lead.data ?? []).map((r) => r.id as string), ...(tasks.data ?? []).map((r) => r.content_item_id as string)])];
}

/** Posts with no date yet (the "unscheduled" tray). */
export async function listUndatedPosts(projectId: string, filters: PostFilters) {
  const supabase = await createClient();
  // the Ideas Backlog: undated, not archived, best-scored first
  let q = supabase.from("content_items").select("*").eq("project_id", projectId).is("scheduled_date", null).is("archived_at", null);
  q = applyFilters(q, filters);
  const { data, error } = await q.order("idea_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

export async function getPost(projectId: string, id: string): Promise<ContentItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_items").select("*").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as ContentItem | null;
}

/** Same-platform posts scheduled within ±windowMinutes of a slot (for conflict warnings). */
export async function postsNear(projectId: string, platform: string, atUtc: string, windowMinutes = 60) {
  const supabase = await createClient();
  const t = Date.parse(atUtc);
  const { data, error } = await supabase
    .from("content_items")
    .select("id, platform, scheduled_at, title")
    .eq("project_id", projectId)
    .eq("platform", platform)
    .gte("scheduled_at", new Date(t - windowMinutes * 60000).toISOString())
    .lte("scheduled_at", new Date(t + windowMinutes * 60000).toISOString());
  if (error) throw error;
  return (data ?? []) as { id: string; platform: string; scheduled_at: string; title: string }[];
}

export async function insertPost(projectId: string, userId: string, values: Partial<ContentItem>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .insert({ ...values, project_id: projectId, created_by: userId })
    .select("*")
    .single();
  if (error) throw error;
  return data as ContentItem;
}

export async function updatePost(projectId: string, id: string, values: Partial<ContentItem>) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_items").update(values).eq("id", id).eq("project_id", projectId).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Post not found or read-only.");
  return data as ContentItem;
}

export async function deletePost(projectId: string, id: string) {
  const supabase = await createClient();
  const { error, count } = await supabase.from("content_items").delete({ count: "exact" }).eq("id", id).eq("project_id", projectId);
  if (error) throw error;
  if (!count) throw new Error("Post not found or read-only.");
}

/** Recent post titles in the project, so AI generation avoids repeating them. */
export async function recentPostTitles(projectId: string, limit = 60) {
  const supabase = await createClient();
  const { data } = await supabase.from("content_items").select("title, scheduled_date, platform").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(limit);
  return (data ?? []) as { title: string; scheduled_date: string | null; platform: string | null }[];
}

export async function deleteCalendar(projectId: string, calendarId: string) {
  const supabase = await createClient();
  // content_items.calendar_id is "on delete set null"; a deleted calendar takes its planned items with it.
  const items = await supabase.from("content_items").delete().eq("project_id", projectId).eq("calendar_id", calendarId);
  if (items.error) throw items.error;
  const { error, count } = await supabase.from("editorial_calendars").delete({ count: "exact" }).eq("id", calendarId).eq("project_id", projectId);
  if (error) throw error;
  if (!count) throw new Error("Calendar not found or read-only.");
}
