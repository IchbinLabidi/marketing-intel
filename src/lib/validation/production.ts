import { z } from "zod";
import { FUNNEL_STAGES, LANGUAGES, PLATFORMS } from "@/lib/domain/constants";
import { STAGES } from "@/lib/production/model";
import { optionalDate, optionalEnum, optionalText } from "./common";

const uuid = z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null);
export const writingSchema = z.object({
  title: z.string().trim().max(300), hook: z.string().max(1000), caption: z.string().max(10000),
  main_content: z.string().max(30000), cta: z.string().max(1000), hashtags: z.array(z.string().max(100)).max(30),
  creative_brief: z.string().max(10000), visual_direction: z.string().max(10000),
});
export const productionSchema = writingSchema.extend({
  title: z.string().trim().min(1, "Give this content a title").max(300),
  platform: z.enum(PLATFORMS), format: z.string().trim().min(1).max(120), language: z.enum(LANGUAGES),
  target_audience: optionalText(3000), pillar_id: uuid, funnel_stage: optionalEnum(FUNNEL_STAGES),
  assignee_id: uuid, due_date: optionalDate,
  language_variants: z.object({ fr: writingSchema.optional(), en: writingSchema.optional(), ar: writingSchema.optional(), ar_tn: writingSchema.optional() }),
});
export type ProductionInput = z.infer<typeof productionSchema>;
export const AI_OPERATIONS = ["generate", "rewrite", "improve_hook", "alternative_hooks", "tone", "shorten", "expand", "improve_cta", "hashtags", "translate", "adapt_platform", "reel", "carousel", "stories"] as const;
export const AI_LABELS: Record<typeof AI_OPERATIONS[number], string> = { generate: "Generate content", rewrite: "Rewrite content", improve_hook: "Improve the hook", alternative_hooks: "Alternative hooks", tone: "Change tone", shorten: "Shorten", expand: "Expand", improve_cta: "Improve the CTA", hashtags: "Generate hashtags", translate: "Translate", adapt_platform: "Adapt to another platform", reel: "Caption → Reel script", carousel: "Idea → Carousel", stories: "Post → Story sequence" };
export const productionAISchema = z.object({ operation: z.enum(AI_OPERATIONS), content: productionSchema, instruction: z.string().max(2000), target_language: z.enum(LANGUAGES), target_platform: z.enum(PLATFORMS) });
export const stageSchema = z.enum(STAGES);
export const workflowSchema = z.object({ require_internal_review: z.boolean(), labels: z.object(Object.fromEntries(STAGES.map((s) => [s, z.string().trim().min(1).max(45).optional()])) as Record<typeof STAGES[number], z.ZodOptional<z.ZodString>>) });
