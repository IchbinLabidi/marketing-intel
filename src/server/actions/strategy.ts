"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit } from "@/lib/domain/constants";
import { formToObject, zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import {
  brandVoiceSchema,
  foundationsSchema,
  funnelSchema,
  journeySchema,
  STRATEGY_ENTITIES,
  type StrategyEntity,
} from "@/lib/validation/strategy";
import { requireUser } from "@/server/services/session";
import { getBrandProfile, getProjectContext, listChannels } from "@/server/services/projects";
import {
  deleteStrategyEntity,
  getStrategyBundle,
  saveStrategyFields,
  upsertStrategyEntity,
} from "@/server/services/strategy";
import { describeAIError } from "@/server/ai/client";
import { buildProjectContext } from "@/server/ai/context";
import { runStructured } from "@/server/ai/run";
import {
  buildStrategyPrompt,
  STRATEGY_SECTIONS,
  STRATEGY_SYSTEM_PROMPT,
  type StrategySection,
} from "@/server/ai/strategy";

const NO_EDIT: ActionResult = { ok: false, error: "Your role in this workspace is read-only." };
const fail = (e: unknown, fallback: string): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : fallback });

async function guard(projectId: string) {
  const user = await requireUser();
  const ctx = await getProjectContext(projectId);
  return { user, ...ctx, allowed: canEdit(ctx.role) };
}

const done = (projectId: string, message: string): ActionResult => {
  revalidatePath(`/p/${projectId}`, "layout");
  return { ok: true, message };
};

export async function saveFoundationsAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = foundationsSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveStrategyFields(projectId, user.id, parsed.data);
    return done(projectId, "Foundations saved");
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveBrandVoiceAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = brandVoiceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveStrategyFields(projectId, user.id, { brand_voice: parsed.data as Record<string, string> });
    return done(projectId, "Brand voice saved");
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveFunnelAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = funnelSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveStrategyFields(projectId, user.id, { funnel: parsed.data as Record<string, string> });
    return done(projectId, "Funnel saved");
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveJourneyAction(projectId: string, stages: unknown): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = journeySchema.safeParse(stages);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveStrategyFields(projectId, user.id, { customer_journey: parsed.data });
    return done(projectId, "Customer journey saved");
  } catch (e) {
    return fail(e, "Could not save");
  }
}

const entitySchema = z.enum(Object.keys(STRATEGY_ENTITIES) as [StrategyEntity, ...StrategyEntity[]]);

export async function upsertEntityAction(
  entity: StrategyEntity,
  projectId: string,
  id: string | null,
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const kind = entitySchema.parse(entity);
  const parsed = STRATEGY_ENTITIES[kind].safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await upsertStrategyEntity(kind, projectId, id, parsed.data);
    return done(projectId, id ? "Saved" : "Added");
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function deleteEntityAction(entity: StrategyEntity, projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    await deleteStrategyEntity(entitySchema.parse(entity), projectId, id);
    return done(projectId, "Deleted");
  } catch (e) {
    return fail(e, "Could not delete");
  }
}

/** Adds AI-suggested items (after the user selected them) to a list section. */
export async function addEntitiesAction(entity: StrategyEntity, projectId: string, items: unknown[]): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const kind = entitySchema.parse(entity);
  try {
    for (const item of items) {
      const parsed = STRATEGY_ENTITIES[kind].safeParse(item);
      if (!parsed.success) return zodErrorToResult(parsed.error);
      await upsertStrategyEntity(kind, projectId, null, parsed.data);
    }
    return done(projectId, `${items.length} item${items.length === 1 ? "" : "s"} added`);
  } catch (e) {
    return fail(e, "Could not add items");
  }
}

const SECTION_TO_CURRENT: Record<StrategySection, (b: Awaited<ReturnType<typeof getStrategyBundle>>) => unknown> = {
  foundations: (b) =>
    b.strategy && {
      business_objectives: b.strategy.business_objectives,
      marketing_objectives: b.strategy.marketing_objectives,
      brand_positioning: b.strategy.brand_positioning,
      value_proposition: b.strategy.value_proposition,
    },
  brand_voice: (b) => b.strategy?.brand_voice,
  personas: (b) => b.personas,
  content_pillars: (b) => b.pillars,
  customer_journey: (b) => b.strategy?.customer_journey,
  funnel: (b) => b.strategy?.funnel,
  campaigns: (b) => b.campaigns,
  kpis: (b) => b.kpis,
};

export async function suggestStrategyAction(
  projectId: string,
  section: StrategySection,
  instruction?: string,
): Promise<ActionResult<unknown>> {
  const { user, project, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  if (!(section in STRATEGY_SECTIONS)) return { ok: false, error: "Unknown section" };
  try {
    const [brand, channels, bundle] = await Promise.all([
      getBrandProfile(projectId),
      listChannels(projectId),
      getStrategyBundle(projectId),
    ]);
    const context = buildProjectContext({ project, brand, channels, strategy: bundle });
    const result = await runStructured({
      feature: `strategy.${section}`,
      workspaceId: project.workspace_id,
      projectId,
      userId: user.id,
      system: STRATEGY_SYSTEM_PROMPT,
      prompt: buildStrategyPrompt(section, context, SECTION_TO_CURRENT[section](bundle), instruction?.slice(0, 1000)),
      schema: STRATEGY_SECTIONS[section].schema,
    });
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}
