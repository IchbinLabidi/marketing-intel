"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { canWriteItem, type ContentTemplate, type ProductionItem, type ProductionStage } from "@/lib/production/model";
import { productionAISchema, productionSchema, stageSchema, workflowSchema } from "@/lib/validation/production";
import { type ActionResult, zodErrorToResult } from "@/lib/validation/common";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { getPost, insertPost } from "@/server/services/calendar";
import { getOpportunity, linkedPosts } from "@/server/services/opportunities";
import { productionDetails, type ProductionDetails } from "@/server/services/production";
import { getPermissions, listItemTasks } from "@/server/services/team";
import { buildProjectContext } from "@/server/ai/context";
import { describeAIError } from "@/server/ai/client";
import { performanceDigest } from "@/server/ai/history";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { recentPostTitles } from "@/server/services/calendar";
import { isIsoDate, isTime, utcToZoned, zonedToUtc } from "@/lib/calendar/time";
import { runStructured } from "@/server/ai/run";
import { deleteMediaAction } from "@/server/actions/media";
import { PRODUCTION_SYSTEM, productionDraftSchema, productionPrompt, type ProductionDraft } from "@/server/ai/production";

const refresh = (id: string) => revalidatePath(`/p/${id}`, "layout");
export async function scheduleProductionAction(projectId: string, id: string, revision: number, date: string, time: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { db, project, item } = await editable(projectId, id);
    if (item.production_stage !== "ready") throw new Error("Content must receive final approval before scheduling.");
    if (!isIsoDate(date) || !isTime(time)) throw new Error("Enter a valid publication date and time.");
    const tz = project.timezone || "Africa/Tunis";
    const at = zonedToUtc(date, time, tz);
    const roundtrip = utcToZoned(at, tz);
    if (roundtrip.date !== date || roundtrip.time !== time) throw new Error("This local time does not exist because of a daylight-saving change.");
    if (Date.parse(at) <= Date.now()) throw new Error("Choose a future publication time.");
    const { data, error } = await db.from("content_items").update({ scheduled_date: date, scheduled_time: time, scheduled_at: at, status: "scheduled" }).eq("project_id", projectId).eq("id", id).eq("revision", revision).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Content changed in another session. Reload before scheduling.");
    refresh(projectId); return { ok: true, data, message: "Scheduled internally. Publish through the platform when ready." };
  } catch (e) { return failure(e); }
}
function failure(e: unknown): ActionResult<never> {
  const message = e && typeof e === "object" && "message" in e ? String(e.message) : "The request could not be completed. Please try again.";
  return { ok: false, error: /schema cache|does not exist/.test(message) ? "Content Production needs database migration 0007. Ask your administrator to apply it." : message };
}
async function access(projectId: string, write = true) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  if (write && !canEdit(role)) throw new Error("Your workspace role is read-only.");
  return { user, project, role, db: await createClient() };
}
async function editable(projectId: string, id: string) {
  const ctx = await access(projectId);
  const item = await getPost(projectId, id) as ProductionItem | null;
  const [perms, tasks] = item ? await Promise.all([getPermissions(ctx.project.workspace_id), listItemTasks(projectId, id)]) : [new Set<string>(), []];
  const collaborator = tasks.some((t) => t.user_id === ctx.user.id && t.status !== "approved" && t.status !== "completed");
  if (!item || !canWriteItem(ctx.role, ctx.user.id, item, { editAny: perms.has("content.edit_any"), collaborator })) throw new Error("Content not found or not assigned to you.");
  if (item.status === "published") throw new Error("Published content is locked.");
  return { ...ctx, item };
}
export async function saveProductionAction(projectId: string, id: string | null, revision: number | null, input: unknown): Promise<ActionResult<ProductionItem>> {
  const parsed = productionSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db } = await access(projectId);
    const { data, error } = await db.rpc("save_production", { p_project: projectId, p_id: id, p_revision: revision, p_values: parsed.data });
    if (error) throw error;
    refresh(projectId); return { ok: true, data: data as ProductionItem, message: "Content saved" };
  } catch (e) { return failure(e); }
}
export async function transitionProductionAction(projectId: string, id: string, revision: number, stage: ProductionStage, decision?: "approve" | "reject" | "changes", comment = ""): Promise<ActionResult<ProductionItem>> {
  if (!stageSchema.safeParse(stage).success || !Number.isInteger(revision) || comment.length > 5000) return { ok: false, error: "Invalid workflow request." };
  try {
    const { db } = await access(projectId);
    const { data, error } = await db.rpc("production_transition", { p_project: projectId, p_id: id, p_revision: revision, p_stage: stage, p_decision: decision ?? null, p_comment: comment });
    if (error) throw error;
    refresh(projectId); return { ok: true, data: data as ProductionItem, message: decision ? "Review decision recorded" : "Stage updated" };
  } catch (e) { return failure(e); }
}
export async function productionDetailsAction(projectId: string, id: string): Promise<ActionResult<ProductionDetails>> {
  try { await access(projectId, false); return { ok: true, data: await productionDetails(projectId, id) }; } catch (e) { return failure(e); }
}
export async function commentProductionAction(projectId: string, id: string, body: string, mentions: string[]): Promise<ActionResult> {
  const parsed = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.uuid()).max(50) }).safeParse({ body, mentions });
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db } = await access(projectId);
    const { error } = await db.rpc("production_comment", { p_project: projectId, p_id: id, p_body: parsed.data.body, p_mentions: parsed.data.mentions });
    if (error) throw error;
    refresh(projectId); return { ok: true, message: "Comment added" };
  } catch (e) { return failure(e); }
}
export async function restoreProductionAction(projectId: string, id: string, revision: number, versionId: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { db } = await access(projectId);
    const { data, error } = await db.rpc("restore_production", { p_project: projectId, p_id: id, p_revision: revision, p_version: versionId });
    if (error) throw error;
    refresh(projectId); return { ok: true, data, message: "Revision restored as a new version" };
  } catch (e) { return failure(e); }
}
/** One line per distinct fact with its post count; older recommendations store one entry per post with the same note. */
function evidenceLines(evidence: { type: string; note: string; ref_id?: string | null; ref_ids?: string[] }[]) {
  const byNote = new Map<string, Set<string>>();
  for (const e of evidence) {
    const ids = byNote.get(e.note) ?? new Set<string>();
    for (const id of e.ref_ids ?? (e.ref_id ? [e.ref_id] : [])) ids.add(id);
    byNote.set(e.note, ids);
  }
  return [...byNote].map(([note, ids]) => `- ${note}${ids.size ? ` (${ids.size} post${ids.size > 1 ? "s" : ""})` : ""}`);
}

export async function opportunityToProductionAction(projectId: string, opportunityId: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { user, project } = await access(projectId);
    const [existing] = await linkedPosts(projectId, [opportunityId]);
    if (existing) return { ok: true, data: await getPost(projectId, existing.id) as ProductionItem };
    const opp = await getOpportunity(projectId, opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    const item = await insertPost(projectId, user.id, {
      title: (opp.title || opp.idea).slice(0, 300), platform: opp.platform ?? "instagram", format: opp.format ?? "Social caption",
      pillar_id: opp.pillar_id, funnel_stage: opp.funnel_stage, hook: opp.hook, cta: opp.cta, opportunity_id: opp.id,
      marketing_objective: opp.marketing_objective, status: "idea",
      creative_brief: [`Rationale: ${opp.rationale}`, `Angle: ${opp.creative_angle ?? ""}`, `Audience: ${opp.target_audience ?? ""}`, "Evidence (supporting posts: View evidence in Content Opportunities):", ...evidenceLines(opp.evidence)].join("\n").slice(0, 10000),
      ...{ target_audience: opp.target_audience, language: project.default_language, assignee_id: user.id },
    });
    refresh(projectId); return { ok: true, data: item as ProductionItem, message: "Production task created" };
  } catch (e) {
    // Another request may have won the row lock: return the single existing task.
    try { const [existing] = await linkedPosts(projectId, [opportunityId]); if (existing) return { ok: true, data: await getPost(projectId, existing.id) as ProductionItem }; } catch { /* use original error */ }
    return failure(e);
  }
}
export async function generateProductionAction(projectId: string, input: unknown): Promise<ActionResult<ProductionDraft>> {
  const parsed = productionAISchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { project, user } = await access(projectId);
    const { bundle, brand, channels, performance } = await loadHistoryAnalysis(projectId);
    const recent = await recentPostTitles(projectId);
    const data = await runStructured({ feature: `production.${parsed.data.operation}`, projectId, workspaceId: project.workspace_id, userId: user.id,
      system: PRODUCTION_SYSTEM, schema: productionDraftSchema, effort: "low",
      prompt: productionPrompt(parsed.data, buildProjectContext({ project, brand, channels, strategy: bundle }), performanceDigest(performance, () => undefined), recent.map((r) => r.title).join("\n")) });
    return { ok: true, data };
  } catch (e) { return { ok: false, error: describeAIError(e) }; }
}
export async function saveTemplateAction(projectId: string, name: string, description: string, input: unknown): Promise<ActionResult<ContentTemplate>> {
  const parsed = productionSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  if (!name.trim() || name.length > 120 || description.length > 1000) return { ok: false, error: "Enter a template name (up to 120 characters)." };
  try {
    const { db, user } = await access(projectId);
    const { data, error } = await db.from("content_templates").insert({ project_id: projectId, name: name.trim(), description, body: { ...parsed.data, assignee_id: null, due_date: null }, created_by: user.id }).select("*").single();
    if (error) throw error;
    refresh(projectId); return { ok: true, data, message: "Template saved" };
  } catch (e) { return failure(e); }
}
export async function deleteTemplateAction(projectId: string, id: string): Promise<ActionResult> {
  try {
    const { db } = await access(projectId);
    const { error, count } = await db.from("content_templates").delete({ count: "exact" }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    if (!count) throw new Error("Template not found or you don't have permission to delete it.");
    refresh(projectId); return { ok: true };
  } catch (e) { return failure(e); }
}
export async function configureWorkflowAction(projectId: string, input: unknown): Promise<ActionResult> {
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db, role } = await access(projectId);
    if (!canAdmin(role)) throw new Error("Only administrators can configure workflow.");
    const { error } = await db.from("projects").update({ production_workflow: parsed.data }).eq("id", projectId);
    if (error) throw error;
    refresh(projectId); return { ok: true, message: "Workflow saved" };
  } catch (e) { return failure(e); }
}

export async function addMediaLinkAction(projectId: string, id: string, name: string, url: string): Promise<ActionResult> {
  if (!name.trim() || name.length > 200 || !z.url().safeParse(url).success || !url.startsWith("https://") || url.length > 2000) return { ok: false, error: "Provide a name and a valid HTTPS media link." };
  try {
    const { db, item, user } = await editable(projectId, id);
    const { error } = await db.from("content_assets").insert({ project_id: projectId, content_item_id: id, kind: "media", language: item.language || "fr", body: { name, url }, created_by: user.id });
    if (error) throw error;
    refresh(projectId); return { ok: true, message: "Media attached" };
  } catch (e) { return failure(e); }
}
export async function mediaUploadTicketAction(projectId: string, id: string, name: string, mime: string, size: number): Promise<ActionResult<{ path: string; token: string }>> {
  if (!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf'].includes(mime) || size <= 0 || size > 50 * 1024 * 1024) return { ok: false, error: "Use JPG, PNG, WebP, GIF, MP4, MOV or PDF up to 50 MB." };
  try {
    const { db } = await editable(projectId, id);
    const path = `${projectId}/${id}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`;
    const { data, error } = await db.storage.from("production-media").createSignedUploadUrl(path);
    if (error) throw error;
    return { ok: true, data: { path, token: data.token } };
  } catch (e) { return failure(e); }
}
export async function finishMediaUploadAction(projectId: string, id: string, path: string, name: string, mime: string): Promise<ActionResult> {
  try {
    const { db, item, user } = await editable(projectId, id);
    if (!path.startsWith(`${projectId}/${id}/`) || name.length > 200) throw new Error("Invalid upload.");
    const { data: files, error: listError } = await db.storage.from("production-media").list(`${projectId}/${id}`, { search: path.split("/").pop() });
    if (listError || !files?.some((file) => file.name === path.split("/").pop())) throw new Error("Upload has not completed.");
    const { error } = await db.from("content_assets").insert({ project_id: projectId, content_item_id: id, kind: "media", language: item.language || "fr", body: { path, name, mime }, created_by: user.id });
    if (error) { await db.storage.from("production-media").remove([path]); throw error; }
    refresh(projectId); return { ok: true, message: "File attached" };
  } catch (e) { return failure(e); }
}
export async function removeMediaAction(projectId: string, id: string, assetId: string): Promise<ActionResult> {
  try {
    await editable(projectId, id);
    // Permanent: the stored file is deleted from storage, then the record (Drive files only lose their reference)
    const r = await deleteMediaAction(projectId, id, assetId);
    if (!r.ok) throw new Error(r.error);
    refresh(projectId); return { ok: true, message: r.message ?? "Attachment deleted" };
  } catch (e) { return failure(e); }
}

