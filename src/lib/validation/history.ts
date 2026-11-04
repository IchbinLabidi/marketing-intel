import { z } from "zod";
import { AUDIENCES } from "@/lib/backlog/audience";
import { FUNNEL_STAGES, METRICS, PLATFORMS } from "@/lib/domain/constants";
import { optionalDate, optionalEnum, optionalNumber, optionalText } from "./common";

const metricFields = Object.fromEntries(METRICS.map((m) => [m, optionalNumber(0, 1e12)])) as Record<(typeof METRICS)[number], ReturnType<typeof optionalNumber>>;

/** Editing one imported record. Strategy links are validated against the project's own pillars/campaigns in the action. */
export const historicalItemSchema = z.object({
  publication_date: optionalDate,
  actual_publication_date: optionalDate,
  platform: optionalEnum(PLATFORMS),
  title: optionalText(500),
  topic: optionalText(500),
  description: optionalText(5000),
  format: optionalText(120),
  pillar_id: z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null),
  campaign_id: z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null),
  caption: optionalText(5000),
  cta: optionalText(500),
  publication_status: optionalText(120),
  funnel_stage: optionalEnum(FUNNEL_STAGES),
  ...metricFields,
});

export const calendarRequestSchema = z
  .object({
    start: z.iso.date(),
    end: z.iso.date(),
    platforms: z.array(z.object({ platform: z.enum(PLATFORMS), perWeek: z.number().min(0.5).max(21) })).min(1, "v:pickPlatform"),
    instruction: z.string().max(1000).optional(),
  })
  .refine((r) => r.end >= r.start, { message: "v:endAfterStart", path: ["end"] })
  .refine((r) => (Date.parse(r.end) - Date.parse(r.start)) / 86400000 <= 92, { message: "v:maxThreeMonths", path: ["end"] });
export type CalendarRequest = z.infer<typeof calendarRequestSchema>;

export const draftItemSchema = z.object({
  scheduled_date: z.iso.date(),
  platform: z.enum(PLATFORMS),
  title: z.string().trim().min(1, "v:titleRequired").max(300),
  format: z.string().trim().max(120).nullable(),
  pillar_id: z.uuid().nullable(),
  campaign_id: z.uuid().nullable(),
  funnel_stage: z.enum(FUNNEL_STAGES).nullable(),
  hook: z.string().max(1000).nullable(),
  creative_brief: z.string().max(3000).nullable(),
  cta: z.string().max(500).nullable(),
  marketing_objective: z.string().max(1000).nullable(),
  opportunity_id: z.uuid().nullable(),
  historical_source_id: z.uuid().nullable(),
  /** audience tag from the AI draft; missing ones are classified when the calendar is saved */
  audience: z.enum(AUDIENCES).nullish(),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

export const saveCalendarSchema = z.object({
  name: z.string().trim().min(1, "v:nameRequired").max(160),
  start: z.iso.date(),
  end: z.iso.date(),
  items: z.array(draftItemSchema).min(1, "v:keepOneItem").max(200),
  settings: z.record(z.string(), z.unknown()).default({}),
});
