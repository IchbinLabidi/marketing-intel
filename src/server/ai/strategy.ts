import "server-only";
import { z } from "zod";
import { FUNNEL_STAGES, PLATFORMS } from "@/lib/domain/constants";

// Output schemas use only plain types (no transforms) so they translate cleanly to JSON Schema.
const notes = z.object({
  assumptions: z.array(z.string()).describe("Assumptions made because the user did not provide the information"),
  questions: z.array(z.string()).describe("Questions whose answers would most improve this section"),
});

export const STRATEGY_SECTIONS = {
  foundations: {
    label: "Foundations",
    instructions:
      "Draft or improve business objectives, marketing objectives (SMART where possible), brand positioning (for whom, category, key benefit, reason to believe) and the value proposition.",
    schema: z.object({
      business_objectives: z.string(),
      marketing_objectives: z.string(),
      brand_positioning: z.string(),
      value_proposition: z.string(),
      notes,
    }),
  },
  brand_voice: {
    label: "Brand voice",
    instructions:
      "Define the brand voice: tone, do's, don'ts, signature vocabulary, and 2-3 short example lines. Make it usable by a copywriter and adapted to the default content language.",
    schema: z.object({
      tone: z.string(),
      do: z.string(),
      dont: z.string(),
      vocabulary: z.string(),
      examples: z.string(),
      notes,
    }),
  },
  personas: {
    label: "Personas",
    instructions: "Propose 2-4 distinct target personas. Avoid overlap. Base them on the audience, products and positioning.",
    schema: z.object({
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          demographics: z.string(),
          goals: z.string(),
          pain_points: z.string(),
          objections: z.string(),
          preferred_platforms: z.array(z.enum(PLATFORMS)),
        }),
      ),
      notes,
    }),
  },
  content_pillars: {
    label: "Content pillars",
    instructions:
      "Propose 3-6 content pillars with a short description and a target share of total content (shares must sum to 100). Each pillar must connect to an objective or persona need.",
    schema: z.object({
      items: z.array(z.object({ name: z.string(), description: z.string(), target_share: z.number() })),
      notes,
    }),
  },
  customer_journey: {
    label: "Customer journey",
    instructions: "Map the customer journey in 4-6 stages, each with the customer's goal, main touchpoints and the content they need.",
    schema: z.object({
      stages: z.array(z.object({ stage: z.string(), goal: z.string(), touchpoints: z.string(), content_needs: z.string() })),
      notes,
    }),
  },
  funnel: {
    label: "Marketing funnel",
    instructions:
      "For each funnel stage, describe the role of content, the formats that fit and the target share of the editorial mix.",
    schema: z.object({
      ...(Object.fromEntries(FUNNEL_STAGES.map((s) => [s, z.string()])) as Record<(typeof FUNNEL_STAGES)[number], z.ZodString>),
      notes,
    }),
  },
  campaigns: {
    label: "Campaigns",
    instructions:
      "Propose 2-4 marketing campaigns for the next 6 months. Use ISO dates (YYYY-MM-DD) only when a timing is justified by the business (season, launch); otherwise leave dates empty.",
    schema: z.object({
      items: z.array(
        z.object({
          name: z.string(),
          objective: z.string(),
          description: z.string(),
          starts_on: z.string().nullable(),
          ends_on: z.string().nullable(),
          funnel_focus: z.enum(FUNNEL_STAGES).nullable(),
        }),
      ),
      notes,
    }),
  },
  kpis: {
    label: "KPIs",
    instructions:
      "Propose 4-8 KPIs tied to the objectives and funnel. Targets must be clearly marked as proposals to validate, not benchmarks.",
    schema: z.object({
      items: z.array(
        z.object({
          name: z.string(),
          target_value: z.string(),
          unit: z.string(),
          period: z.string(),
          funnel_stage: z.enum(FUNNEL_STAGES).nullable(),
        }),
      ),
      notes,
    }),
  },
} as const;

export type StrategySection = keyof typeof STRATEGY_SECTIONS;
export type StrategySuggestion<S extends StrategySection> = z.infer<(typeof STRATEGY_SECTIONS)[S]["schema"]>;

export const STRATEGY_SYSTEM_PROMPT = `You are a senior marketing strategist helping a marketing team build a content strategy inside a SaaS tool.

Rules:
- Use only the information in the project context. Where information is missing, make a reasonable, clearly stated assumption and list it in notes.assumptions.
- Never invent statistics, market sizes, benchmarks, performance numbers or competitor facts.
- Be specific to this business. Avoid generic marketing filler.
- If existing content is provided for the section, improve it rather than discarding it, unless it contradicts the rest of the strategy.
- Write in the project's default content language. For Tunisian Arabic (Derja) projects, write strategy text in French unless the user asks otherwise, since strategy documents are rarely written in Derja.`;

export function buildStrategyPrompt(section: StrategySection, context: string, currentSection: unknown, instruction?: string) {
  const def = STRATEGY_SECTIONS[section];
  return [
    `# Task: ${def.label}`,
    def.instructions,
    instruction ? `\nAdditional instruction from the user: ${instruction}` : "",
    "\n# Project context",
    context,
    "\n# Current content of this section",
    currentSection ? JSON.stringify(currentSection, null, 2) : "(empty)",
  ].join("\n");
}
