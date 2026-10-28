"use server";

import { revalidatePath } from "next/cache";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { bestPublicationTimes } from "@/lib/calendar/insights";
import { isIsoDate, isTime, isValidTimeZone, utcToZoned, weekdayOf, zonedToUtc } from "@/lib/calendar/time";
import { zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { generatePostSchema, postSchema, type GeneratePostInput } from "@/lib/validation/calendar";
import { createClient } from "@/lib/supabase/server";
import type { ContentItem } from "@/types/domain";
import { describeAIError } from "@/server/ai/client";
import { buildProjectContext } from "@/server/ai/context";
import { historyDigest, performanceDigest } from "@/server/ai/history";
import { buildPostPrompt, POST_SYSTEM_PROMPT, postDraftSchema, type PostDraft } from "@/server/ai/post";
import { runStructured } from "@/server/ai/run";
import { deletePost, getPost, insertPost, postsNear, recentPostTitles, updatePost } from "@/server/services/calendar";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { linkedPosts, syncOpportunityState } from "@/server/services/opportunities";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { getMetaConnection, readMetaTokens } from "@/server/services/meta";
import { graphGet } from "@/server/meta/graph";
import { hasPermission } from "@/server/services/team";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role can't plan or edit the calendar." };
const fail = (e: unknown, fallback: string): ActionResult<never> => ({ ok: false, error: e instanceof Error ? e.message : fallback });

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  // Planning in the calendar needs the calendar permission on top of a role that can edit.
  const allowed = canEdit(role) && (await hasPermission(project.workspace_id, "calendar.edit"));
  return { user, project, allowed, tz: project.timezone || "Africa/Tunis" };
}

const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

/** Local date/time in the project zone → the three stored columns (scheduled_at in UTC). */
function scheduleFields(date: string | null, time: string | null, tz: string) {
  return {
    scheduled_date: date,
    scheduled_time: date && time ? time : null,
    scheduled_at: date && time ? zonedToUtc(date, time, tz) : null,
  };
}

export type Conflict = { id: string; title: string; time: string };
export type SaveResult = { post?: ContentItem; conflicts?: Conflict[] };

async function conflictsFor(projectId: string, tz: string, id: string | null, platform: string | null, atUtc: string | null) {
  if (!platform || !atUtc) return [];
  const near = await postsNear(projectId, platform, atUtc);
  return near.filter((n) => n.id !== id).map((n) => ({ id: n.id, title: n.title, time: utcToZoned(n.scheduled_at, tz).time }));
}

/**
 * Creates or updates a post. Same-platform posts within an hour are reported back first; the client confirms and
 * resends with `force`. Scheduling in the past is refused. Published posts keep their status and slot.
 */
export async function savePostAction(projectId: string, id: string | null, input: unknown, force = false): Promise<ActionResult<SaveResult>> {
  const { user, allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { date, time, opportunity_id, ...p } = parsed.data;
  try {
    const current = id ? await getPost(projectId, id) : null;
    if (id && !current) return { ok: false, error: "Post not found." };
    if (p.status === "approved" && current?.status !== "approved") return { ok: false, error: "Use Content Production to record manager approval." };
    if (p.status === "scheduled" && current?.status !== "approved" && current?.status !== "scheduled") return { ok: false, error: "Content needs final production approval before scheduling." };
    // one calendar post per opportunity: a second "Add to calendar" opens the existing post instead
    if (!id && opportunity_id) {
      const [already] = await linkedPosts(projectId, [opportunity_id]);
      if (already) return { ok: false, error: `This opportunity is already in the calendar: “${already.title}”${already.scheduled_date ? ` on ${already.scheduled_date}` : ""}.` };
    }
    const locked = current?.status === "published" || current?.status === "failed";
    const schedule: Partial<ReturnType<typeof scheduleFields>> = locked ? {} : scheduleFields(date, time, tz);
    const status = locked ? current!.status : p.status;
    if (!locked && status === "scheduled" && schedule.scheduled_at && Date.parse(schedule.scheduled_at) < Date.now()) {
      return { ok: false, error: "This time is in the past. Pick a future time to schedule, or keep it as a draft.", fieldErrors: { time: "In the past" } };
    }
    if (!force && !locked) {
      const conflicts = await conflictsFor(projectId, tz, id, p.platform, schedule.scheduled_at ?? null);
      if (conflicts.length) return { ok: true, data: { conflicts } };
    }
    // The compact calendar form does not edit language. Preserve the production language.
    const { language, ...fields } = p;
    const values = { ...fields, ...(language ? { language } : {}), status, ...schedule, ...(id ? {} : { opportunity_id }) };
    const post = id ? await updatePost(projectId, id, values) : await insertPost(projectId, user.id, values);
    await syncOpportunityState(projectId, post.opportunity_id);
    refresh(projectId);
    // the production_guard trigger sends approved content back to production when its text changes
    const lostApproval = (current?.status === "approved" || current?.status === "scheduled") && post.status !== "approved" && post.status !== "scheduled";
    if (lostApproval) {
      return { ok: true, data: { post }, message: "Saved. The text changed after approval, so the post went back to Content Production and needs approval again before it can be scheduled." };
    }
    return { ok: true, data: { post }, message: id ? "Post saved" : status === "scheduled" ? "Post scheduled" : "Draft saved" };
  } catch (e) {
    return fail(e, "Could not save the post");
  }
}

/** Drag-and-drop: moves a post to another day (keeping its time) or to a specific time slot. */
export async function reschedulePostAction(projectId: string, id: string, date: string, time: string | null, force = false): Promise<ActionResult<SaveResult>> {
  const { allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!isIsoDate(date) || (time !== null && !isTime(time))) return { ok: false, error: "Invalid date or time." };
  try {
    const post = await getPost(projectId, id);
    if (!post) return { ok: false, error: "Post not found." };
    if (post.status === "published") return { ok: false, error: "Published posts can't be moved." };
    const keepTime = time ?? post.scheduled_time?.slice(0, 5) ?? null;
    const schedule = scheduleFields(date, keepTime, tz);
    if (post.status === "scheduled" && schedule.scheduled_at && Date.parse(schedule.scheduled_at) < Date.now()) {
      return { ok: false, error: "A scheduled post can't be moved into the past." };
    }
    if (!force) {
      const conflicts = await conflictsFor(projectId, tz, id, post.platform, schedule.scheduled_at);
      if (conflicts.length) return { ok: true, data: { conflicts } };
    }
    const updated = await updatePost(projectId, id, schedule);
    await syncOpportunityState(projectId, updated.opportunity_id);
    refresh(projectId);
    return { ok: true, data: { post: updated }, message: `Moved to ${date}${keepTime ? ` ${keepTime}` : ""}` };
  } catch (e) {
    return fail(e, "Could not move the post");
  }
}

export async function duplicatePostAction(projectId: string, id: string): Promise<ActionResult<SaveResult>> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const post = await getPost(projectId, id);
    if (!post) return { ok: false, error: "Post not found." };
    // the copy is a draft on the same day, without a time, so it never silently doubles a scheduled slot
    // the copy is not linked to the opportunity: one calendar post per opportunity
    const copy = await insertPost(projectId, user.id, {
      calendar_id: post.calendar_id, opportunity_id: null, historical_source_id: post.historical_source_id,
      platform: post.platform, title: `${post.title} (copy)`.slice(0, 300), format: post.format, pillar_id: post.pillar_id,
      campaign_id: post.campaign_id, marketing_objective: post.marketing_objective, funnel_stage: post.funnel_stage, hook: post.hook,
      caption: post.caption, cta: post.cta, creative_brief: post.creative_brief, hashtags: post.hashtags, media_url: post.media_url,
      scheduled_date: post.scheduled_date, scheduled_time: null, scheduled_at: null, status: "planned",
    });
    refresh(projectId);
    return { ok: true, data: { post: copy }, message: "Post duplicated as a draft" };
  } catch (e) {
    return fail(e, "Could not duplicate");
  }
}

export async function deletePostAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const post = await getPost(projectId, id);
    await deletePost(projectId, id);
    await syncOpportunityState(projectId, post?.opportunity_id);
    refresh(projectId);
    return { ok: true, message: "Post deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}

/**
 * Confirms an already-published Meta post by querying the connected platform, using a synced record as the link.
 */
export async function confirmPublishedAction(projectId: string, id: string, input: { date: string; time: string; url: string | null }): Promise<ActionResult<SaveResult>> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!input.url || !/^https:\/\/\S+$/i.test(input.url)) return { ok: false, error: "Provide the HTTPS link to the live post." };
  try {
    const current = await getPost(projectId, id);
    if (!current || !["facebook", "instagram"].includes(current.platform || "")) throw new Error("Publication verification supports connected Facebook and Instagram accounts.");
    const connection = await getMetaConnection(projectId);
    if (!connection || connection.status !== "active") throw new Error("Connect or reconnect Meta in Historical Intelligence first.");
    const canonical = (value: string) => { const url = new URL(value); return `${url.origin}${url.pathname.replace(/\/$/, "")}`; };
    const link = canonical(input.url);
    const db = await createClient();
    const { data: synced, error } = await db.from("historical_content_items").select("id, external_id, published_at, permalink")
      .eq("project_id", projectId).eq("source", "meta_api").eq("platform", current.platform!).eq("meta_connection_id", connection.id)
      .in("permalink", [input.url, link, `${link}/`]).limit(1).maybeSingle();
    if (error) throw error;
    if (!synced?.external_id) throw new Error("This link is not in the connected account's synced posts. Run Sync now in Historical Intelligence, then try again.");
    const token = (await readMetaTokens(connection.id)).page;
    if (!token) throw new Error("Reconnect Meta to verify this post.");
    const live = await graphGet<{ id: string; created_time?: string; timestamp?: string; permalink_url?: string; permalink?: string }>(synced.external_id, { fields: current.platform === "facebook" ? "id,created_time,permalink_url" : "id,timestamp,permalink" }, token);
    const liveUrl = live.permalink_url || live.permalink;
    const liveTime = live.created_time || live.timestamp;
    if (!liveUrl || !liveTime || canonical(liveUrl) !== link) throw new Error("The connected platform could not confirm this publication.");
    const publishedAt = new Date(liveTime).toISOString();
    if (Date.parse(publishedAt) > Date.now()) throw new Error("The platform publication time is in the future.");
    const verified = await db.from("historical_content_items").update({ published_at: publishedAt, permalink: liveUrl }).eq("project_id", projectId).eq("id", synced.id);
    if (verified.error) throw verified.error;
    const post = await updatePost(projectId, id, { status: "published", historical_source_id: synced.id, published_at: publishedAt, published_url: liveUrl, publish_error: null });
    await syncOpportunityState(projectId, post.opportunity_id);
    refresh(projectId);
    return { ok: true, data: { post }, message: "Publication verified with the connected platform" };
  } catch (e) {
    return fail(e, "Could not update");
  }
}

export async function setProjectTimezoneAction(projectId: string, timezone: string): Promise<ActionResult> {
  const { allowed, tz: previous } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!isValidTimeZone(timezone)) return { ok: false, error: "Unknown time zone." };
  if (timezone === previous) return { ok: true };
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update({ timezone }).eq("id", projectId);
    if (error) throw error;
    // Exact slots stay the same instants; their local date/time columns are recomputed for the new zone.
    const { data: timed } = await supabase.from("content_items").select("id, scheduled_at").eq("project_id", projectId).not("scheduled_at", "is", null);
    for (const t of timed ?? []) {
      const z = utcToZoned(t.scheduled_at as string, timezone);
      await supabase.from("content_items").update({ scheduled_date: z.date, scheduled_time: z.time }).eq("id", t.id).eq("project_id", projectId);
    }
    refresh(projectId);
    return { ok: true, message: `Times are now shown in ${timezone}` };
  } catch (e) {
    return fail(e, "Could not change the time zone");
  }
}

/** AI: a new post, or a rewrite of an existing one, using the brand, strategy and real performance data. Not saved. */
export async function generatePostAction(projectId: string, input: GeneratePostInput): Promise<ActionResult<PostDraft & { pillar_id: string | null }>> {
  const parsed = generatePostSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { user, project, allowed, tz } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const g = parsed.data;
  try {
    const { items, bundle, channels, brand, performance, citedIds, pillarName } = await loadHistoryAnalysis(projectId);
    const pillar = bundle.pillars.find((p) => p.id === g.pillar_id) ?? null;
    const timing = bestPublicationTimes(items, tz).find((t) => t.platform === g.platform);
    const digest = historyDigest(items, pillarName, citedIds);
    const refOf = new Map([...digest.refs.entries()].map(([ref, id]) => [id, ref]));
    const draft = await runStructured({
      feature: g.existing ? "calendar.regenerate_post" : "calendar.generate_post",
      workspaceId: project.workspace_id,
      projectId,
      userId: user.id,
      system: POST_SYSTEM_PROMPT,
      prompt: buildPostPrompt({
        context: buildProjectContext({ project, brand, channels, strategy: bundle }),
        performance: performanceDigest(performance.filter((p) => p.platform === g.platform), (id) => refOf.get(id)),
        timing,
        platform: g.platform as Platform,
        pillar: pillar ? { name: pillar.name, description: pillar.description } : null,
        funnel: g.funnel_stage,
        format: g.format,
        date: g.date && isIsoDate(g.date) ? g.date : null,
        weekday: g.date && isIsoDate(g.date) ? weekdayOf(g.date) : null,
        recent: await recentPostTitles(projectId),
        existing: g.existing ?? null,
        instruction: g.instruction?.slice(0, 1000),
      }),
      schema: postDraftSchema,
      effort: "low",
    });
    return {
      ok: true,
      data: {
        ...draft,
        suggested_time: draft.suggested_time && isTime(draft.suggested_time) ? draft.suggested_time : null,
        hashtags: draft.hashtags.map((h) => h.replace(/^#*/, "")).filter(Boolean),
        pillar_id: pillar?.id ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/**
 * Quick planning edits from the calendar: internal deadline, priority and lead assignee.
 * Publication date is not touched here. The database checks who may change each field
 * (production_guard: assignee changes need "content.assign").
 */
export async function updatePlanningAction(
  projectId: string,
  id: string,
  input: { due_date?: string | null; priority?: string; assignee_id?: string | null },
): Promise<ActionResult<SaveResult>> {
  const { project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const values: Partial<ContentItem> = {};
  if ("due_date" in input) {
    if (input.due_date !== null && !isIsoDate(input.due_date)) return { ok: false, error: "Invalid deadline." };
    values.due_date = input.due_date ?? null;
  }
  if ("priority" in input) {
    if (!["low", "medium", "high", "urgent"].includes(input.priority ?? "")) return { ok: false, error: "Invalid priority." };
    values.priority = input.priority as ContentItem["priority"];
  }
  if ("assignee_id" in input) {
    if (input.assignee_id !== null && !/^[0-9a-f-]{36}$/i.test(input.assignee_id ?? "")) return { ok: false, error: "Invalid assignee." };
    values.assignee_id = input.assignee_id ?? null;
  }
  try {
    if (("priority" in input || "assignee_id" in input) && !(await hasPermission(project.workspace_id, "content.assign"))) {
      return { ok: false, error: "Only managers can change the priority or the assignee." };
    }
    const post = await updatePost(projectId, id, values);
    refresh(projectId);
    return { ok: true, data: { post }, message: "Planning updated" };
  } catch (e) {
    return fail(e, "Could not update planning");
  }
}
