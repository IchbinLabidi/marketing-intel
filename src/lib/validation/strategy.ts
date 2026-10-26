import { z } from "zod";
import { FUNNEL_STAGES, PLATFORMS } from "@/lib/domain/constants";
import { optionalDate, optionalEnum, optionalNumber, optionalText, requiredText } from "./common";

export const foundationsSchema = z.object({
  business_objectives: optionalText(),
  marketing_objectives: optionalText(),
  brand_positioning: optionalText(),
  value_proposition: optionalText(),
});

export const brandVoiceSchema = z.object({
  tone: optionalText(1000),
  do: optionalText(2000),
  dont: optionalText(2000),
  vocabulary: optionalText(2000),
  examples: optionalText(4000),
});

export const journeyStageSchema = z.object({
  stage: requiredText(80),
  goal: optionalText(1000),
  touchpoints: optionalText(1000),
  content_needs: optionalText(1000),
});
export const journeySchema = z.array(journeyStageSchema).max(12);

export const funnelSchema = z.object(
  Object.fromEntries(FUNNEL_STAGES.map((s) => [s, optionalText(1000)])) as Record<
    (typeof FUNNEL_STAGES)[number],
    ReturnType<typeof optionalText>
  >,
);

export const personaSchema = z.object({
  name: requiredText(120),
  description: optionalText(2000),
  demographics: optionalText(1000),
  goals: optionalText(2000),
  pain_points: optionalText(2000),
  objections: optionalText(2000),
  preferred_platforms: z.array(z.enum(PLATFORMS)).default([]),
});

export const pillarSchema = z.object({
  name: requiredText(120),
  description: optionalText(2000),
  target_share: optionalNumber(0, 100),
  color: optionalText(20),
});

export const campaignSchema = z
  .object({
    name: requiredText(160),
    objective: optionalText(1000),
    description: optionalText(3000),
    starts_on: optionalDate,
    ends_on: optionalDate,
    funnel_focus: optionalEnum(FUNNEL_STAGES),
  })
  .refine((c) => !c.starts_on || !c.ends_on || c.ends_on >= c.starts_on, {
    message: "End date must be after start date",
    path: ["ends_on"],
  });

export const kpiSchema = z.object({
  name: requiredText(160),
  target_value: optionalText(80),
  unit: optionalText(40),
  period: optionalText(80),
  funnel_stage: optionalEnum(FUNNEL_STAGES),
});

export const STRATEGY_ENTITIES = {
  personas: personaSchema,
  content_pillars: pillarSchema,
  campaigns: campaignSchema,
  kpis: kpiSchema,
} as const;
export type StrategyEntity = keyof typeof STRATEGY_ENTITIES;
