"use server";

import { tagUntagged } from "@/server/ai/audience";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { canWriteItem, type ContentTemplate, type ProductionItem, type ProductionStage } from "@/lib/production/model";
import { captionAISchema, productionAISchema, productionSchema, stageSchema, workflowSchema } from "@/lib/validation/production";
import { type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
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
import { isIsoDate, isTime, slotFields, utcToZoned, zonedToUtc } from "@/lib/calendar/time";
import { runStructured } from "@/server/ai/run";
import { deleteMediaAction } from "@/server/actions/media";
import { PRODUCTION_SYSTEM, productionDraftSchema, productionPrompt, type ProductionDraft } from "@/server/ai/production";
import { CAPTION_SYSTEM, captionDraftSchema, captionPrompt, sanitizeDraft, type CaptionDraft } from "@/server/ai/captions";
import { getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";

const refresh = (id: string) => revalidatePath(`/p/${id}`, "layout");
/**
 * Saves the planned publication date/time of content still in production (no approval needed; nothing is scheduled
 * or published). Scheduled content changes its slot with scheduleProductionAction instead.
 */
export async function planProductionSlotAction(projectId: string, id: string, revision: number, date: string | null, time: string | null): Promise<ActionResult<ProductionItem>> {
  try {
    const { db, project, item, t } = await editable(projectId, id);
    if (item.status === "scheduled") throw new Error(t("actions.scheduledUseSlot"));
    const slot = slotFields(date || null, time || null, project.timezone || "Africa/Tunis");
    if (!slot.ok) throw new Error(slot.error);
    const { data, error } = await db.from("content_items").update(slot.fields).eq("project_id", projectId).eq("id", id).eq("revision", revision).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(t("actions.changedReloadDate"));
    refresh(projectId); return { ok: true, data, message: date ? t("actions.dateSaved") : t("actions.dateRemoved") };
  } catch (e) { return failure(e); }
}
export async function scheduleProductionAction(projectId: string, id: string, revision: number, date: string, time: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { db, project, item, t } = await editable(projectId, id);
    if (item.production_stage !== "ready") throw new Error(t("actions.needApproval"));
    if (!isIsoDate(date) || !isTime(time)) throw new Error(t("actions.invalidDateTime"));
    const tz = project.timezone || "Africa/Tunis";
    const at = zonedToUtc(date, time, tz);
    const roundtrip = utcToZoned(at, tz);
    if (roundtrip.date !== date || roundtrip.time !== time) throw new Error(t("actions.dstGap"));
    if (Date.parse(at) <= Date.now()) throw new Error(t("actions.futureTime"));
    const { data, error } = await db.from("content_items").update({ scheduled_date: date, scheduled_time: time, scheduled_at: at, status: "scheduled" }).eq("project_id", projectId).eq("id", id).eq("revision", revision).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(t("actions.changedReloadSchedule"));
    refresh(projectId); return { ok: true, data, message: t("actions.scheduled") };
  } catch (e) { return failure(e); }
}
async function failure(e: unknown): Promise<ActionResult<never>> {
  const t = await getT("production");
  const message = e && typeof e === "object" && "message" in e ? String(e.message) : t("actions.generic");
  return { ok: false, error: /schema cache|does not exist/.test(message) ? t("actions.migration") : message };
}
async function access(projectId: string, write = true) {
  const t = await getT("production");
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  if (write && !canEdit(role)) throw new Error(t("actions.readOnly"));
  return { user, project, role, db: await createClient(), t };
}
async function editable(projectId: string, id: string) {
  const ctx = await access(projectId);
  const item = await getPost(projectId, id) as ProductionItem | null;
  const [perms, tasks] = item ? await Promise.all([getPermissions(ctx.project.workspace_id), listItemTasks(projectId, id)]) : [new Set<string>(), []];
  const collaborator = tasks.some((t) => t.user_id === ctx.user.id && t.status !== "approved" && t.status !== "completed");
  if (!item || !canWriteItem(ctx.role, ctx.user.id, item, { editAny: perms.has("content.edit_any"), collaborator })) throw new Error(ctx.t("actions.notAssigned"));
  if (item.status === "published") throw new Error(ctx.t("actions.locked"));
  return { ...ctx, item };
}
export async function saveProductionAction(projectId: string, id: string | null, revision: number | null, input: unknown): Promise<ActionResult<ProductionItem>> {
  const parsed = productionSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db, user, t } = await access(projectId);
    let { data, error } = await db.rpc("save_production", { p_project: projectId, p_id: id, p_revision: revision, p_values: parsed.data });
    if (error) throw error;
    if (!id && (data as ProductionItem)?.id) {
      const created = data as ProductionItem;
      ({ data, error } = await db.rpc("production_transition", { p_project: projectId, p_id: created.id, p_revision: created.revision, p_stage: "brief", p_decision: null, p_comment: "" }));
      if (error) throw error;
    }
    // new content gets its audience tag (classified from its text) before it is shown
    if (!id && (data as ProductionItem)?.id) {
      await tagUntagged(projectId, user.id, [(data as ProductionItem).id]);
      const { data: fresh } = await db.from("content_items").select("*").eq("id", (data as ProductionItem).id).single();
      if (fresh) { refresh(projectId); return { ok: true, data: fresh as ProductionItem, message: t("actions.saved") }; }
    }
    refresh(projectId); return { ok: true, data: data as ProductionItem, message: t("actions.saved") };
  } catch (e) { return failure(e); }
}
export async function transitionProductionAction(projectId: string, id: string, revision: number, stage: ProductionStage, decision?: "approve" | "reject" | "changes", comment = ""): Promise<ActionResult<ProductionItem>> {
  if (!stageSchema.safeParse(stage).success || !Number.isInteger(revision) || comment.length > 5000) return { ok: false, error: (await getT("production"))("actions.invalidWorkflow") };
  try {
    const { db, t } = await access(projectId);
    const { data, error } = await db.rpc("production_transition", { p_project: projectId, p_id: id, p_revision: revision, p_stage: stage, p_decision: decision ?? null, p_comment: comment });
    if (error) throw error;
    refresh(projectId); return { ok: true, data: data as ProductionItem, message: decision ? t("actions.decisionRecorded") : t("actions.stageUpdated") };
  } catch (e) { return failure(e); }
}
export async function productionDetailsAction(projectId: string, id: string): Promise<ActionResult<ProductionDetails>> {
  try { await access(projectId, false); return { ok: true, data: await productionDetails(projectId, id) }; } catch (e) { return failure(e); }
}
export async function commentProductionAction(projectId: string, id: string, body: string, mentions: string[]): Promise<ActionResult> {
  const parsed = z.object({ body: z.string().trim().min(1).max(5000), mentions: z.array(z.uuid()).max(50) }).safeParse({ body, mentions });
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db, t } = await access(projectId);
    const { error } = await db.rpc("production_comment", { p_project: projectId, p_id: id, p_body: parsed.data.body, p_mentions: parsed.data.mentions });
    if (error) throw error;
    refresh(projectId); return { ok: true, message: t("actions.commentAdded") };
  } catch (e) { return failure(e); }
}
export async function restoreProductionAction(projectId: string, id: string, revision: number, versionId: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { db, t } = await access(projectId);
    const { data, error } = await db.rpc("restore_production", { p_project: projectId, p_id: id, p_revision: revision, p_version: versionId });
    if (error) throw error;
    refresh(projectId); return { ok: true, data, message: t("actions.restored") };
  } catch (e) { return failure(e); }
}
/** One line per distinct fact with its post count; older recommendations store one entry per post with the same note. */
function evidenceLines(t: TFor<"production">, evidence: { type: string; note: string; ref_id?: string | null; ref_ids?: string[] }[]) {
  const byNote = new Map<string, Set<string>>();
  for (const e of evidence) {
    const ids = byNote.get(e.note) ?? new Set<string>();
    for (const id of e.ref_ids ?? (e.ref_id ? [e.ref_id] : [])) ids.add(id);
    byNote.set(e.note, ids);
  }
  return [...byNote].map(([note, ids]) => `- ${note}${ids.size ? ` ${t("opportunityBrief.posts", { count: ids.size })}` : ""}`);
}

export async function opportunityToProductionAction(projectId: string, opportunityId: string): Promise<ActionResult<ProductionItem>> {
  try {
    const { user, project, t } = await access(projectId);
    const [existing] = await linkedPosts(projectId, [opportunityId]);
    if (existing) return { ok: true, data: await getPost(projectId, existing.id) as ProductionItem };
    const opp = await getOpportunity(projectId, opportunityId);
    if (!opp) throw new Error(t("actions.opportunityNotFound"));
    const item = await insertPost(projectId, user.id, {
      title: (opp.title || opp.idea).slice(0, 300), platform: opp.platform ?? "instagram", format: opp.format ?? "Social caption",
      pillar_id: opp.pillar_id, funnel_stage: opp.funnel_stage, hook: opp.hook, cta: opp.cta, opportunity_id: opp.id,
      marketing_objective: opp.marketing_objective, status: "idea", idea_source: "opportunity",
      creative_brief: [t("opportunityBrief.rationale", { text: opp.rationale }), t("opportunityBrief.angle", { text: opp.creative_angle ?? "" }), t("opportunityBrief.audience", { text: opp.target_audience ?? "" }), t("opportunityBrief.evidence"), ...evidenceLines(t, opp.evidence)].join("\n").slice(0, 10000),
      ...{ target_audience: opp.target_audience, language: project.default_language, assignee_id: user.id },
    });
    refresh(projectId); return { ok: true, data: item as ProductionItem, message: t("actions.taskCreated") };
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
/**
 * Platform captions for the current item: one platform, all requested platforms, or a rewrite of one platform's copy.
 * Uses the item's own project (brand, strategy, pillars, history) and returns a proposal; nothing is saved here.
 */
export async function generateCaptionsAction(projectId: string, input: unknown): Promise<ActionResult<CaptionDraft>> {
  const parsed = captionAISchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const { operation, content } = parsed.data;
  const platforms = [...new Set(parsed.data.platforms)];
  if (operation !== "generate_all" && platforms.length !== 1) return { ok: false, error: (await getT("production"))("actions.onePlatform") };
  try {
    const { project, user, t } = await access(projectId);
    const { bundle, brand, channels, performance } = await loadHistoryAnalysis(projectId);
    const recent = await recentPostTitles(projectId);
    const pillar = bundle.pillars.find((p) => p.id === content.pillar_id)?.name ?? null;
    const context = buildProjectContext({ project, brand, channels, strategy: bundle });
    const raw = await runStructured({ feature: `production.captions_${operation}`, projectId, workspaceId: project.workspace_id, userId: user.id,
      system: CAPTION_SYSTEM, schema: captionDraftSchema, effort: "low",
      prompt: captionPrompt(parsed.data, platforms, context, { pillar, performance: performanceDigest(performance, () => undefined), recent: recent.map((r) => r.title).join("\n") }) });
    const data = sanitizeDraft(raw, { operation, platforms, current: content.platform_captions ?? {}, known: `${context}\n${JSON.stringify(content)}`, script: `${content.main_content}\n${content.creative_brief}`, t });
    if (!data.variants.length) return { ok: false, error: t("actions.noCopy") };
    return { ok: true, data };
  } catch (e) { return { ok: false, error: describeAIError(e) }; }
}
export async function saveTemplateAction(projectId: string, name: string, description: string, input: unknown): Promise<ActionResult<ContentTemplate>> {
  const parsed = productionSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  if (!name.trim() || name.length > 120 || description.length > 1000) return { ok: false, error: (await getT("production"))("actions.templateName") };
  try {
    const { db, user, t } = await access(projectId);
    const { data, error } = await db.from("content_templates").insert({ project_id: projectId, name: name.trim(), description, body: { ...parsed.data, assignee_id: null, due_date: null }, created_by: user.id }).select("*").single();
    if (error) throw error;
    refresh(projectId); return { ok: true, data, message: t("actions.templateSaved") };
  } catch (e) { return failure(e); }
}
export async function deleteTemplateAction(projectId: string, id: string): Promise<ActionResult> {
  try {
    const { db, t } = await access(projectId);
    const { error, count } = await db.from("content_templates").delete({ count: "exact" }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    if (!count) throw new Error(t("actions.templateNotFound"));
    refresh(projectId); return { ok: true };
  } catch (e) { return failure(e); }
}
export async function configureWorkflowAction(projectId: string, input: unknown): Promise<ActionResult> {
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const { db, role, t } = await access(projectId);
    if (!canAdmin(role)) throw new Error(t("actions.adminOnly"));
    const { error } = await db.from("projects").update({ production_workflow: parsed.data }).eq("id", projectId);
    if (error) throw error;
    refresh(projectId); return { ok: true, message: t("actions.workflowSaved") };
  } catch (e) { return failure(e); }
}

export async function addMediaLinkAction(projectId: string, id: string, name: string, url: string): Promise<ActionResult> {
  if (!name.trim() || name.length > 200 || !z.url().safeParse(url).success || !url.startsWith("https://") || url.length > 2000) return { ok: false, error: (await getT("production"))("actions.mediaLink") };
  try {
    const { db, item, user, t } = await editable(projectId, id);
    const { error } = await db.from("content_assets").insert({ project_id: projectId, content_item_id: id, kind: "media", language: item.language || "fr", body: { name, url }, created_by: user.id });
    if (error) throw error;
    refresh(projectId); return { ok: true, message: t("actions.mediaAttached") };
  } catch (e) { return failure(e); }
}
export async function mediaUploadTicketAction(projectId: string, id: string, name: string, mime: string, size: number): Promise<ActionResult<{ path: string; token: string }>> {
  if (!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf'].includes(mime) || size <= 0 || size > 50 * 1024 * 1024) return { ok: false, error: (await getT("production"))("actions.fileTypes") };
  try {
    const { db } = await editable(projectId, id);
    const path = `${projectId}/${id}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100)}`;
    const { data, error } = await db.storage.from("production-media").createSignedUploadUrl(path);
    if (error) throw error;
    return { ok: true, data: { path, token: data.token } };
  } catch (e) { return failure(e); }
}
export async function finishMediaUploadAction(projectId: string, id: string, path: string, name: string, mime: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { db, item, user, t } = await editable(projectId, id);
    if (!path.startsWith(`${projectId}/${id}/`) || name.length > 200) throw new Error(t("actions.invalidUpload"));
    const { data: files, error: listError } = await db.storage.from("production-media").list(`${projectId}/${id}`, { search: path.split("/").pop() });
    if (listError || !files?.some((file) => file.name === path.split("/").pop())) throw new Error(t("actions.uploadIncomplete"));
    const { data: row, error } = await db.from("content_assets").insert({ project_id: projectId, content_item_id: id, kind: "media", language: item.language || "fr", body: { path, name, mime }, created_by: user.id }).select("id").single();
    if (error) { await db.storage.from("production-media").remove([path]); throw error; }
    refresh(projectId); return { ok: true, data: { id: row.id as string }, message: t("actions.fileAttached") };
  } catch (e) { return failure(e); }
}
export async function removeMediaAction(projectId: string, id: string, assetId: string): Promise<ActionResult> {
  try {
    const { t } = await editable(projectId, id);
    // Permanent: the stored file is deleted from storage, then the record (Drive files only lose their reference)
    const r = await deleteMediaAction(projectId, id, assetId);
    if (!r.ok) throw new Error(r.error);
    refresh(projectId); return { ok: true, message: r.message ?? t("actions.attachmentDeleted") };
  } catch (e) { return failure(e); }
}

