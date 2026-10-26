import { z } from "zod";
import { FUNNEL_STAGES, LANGUAGES, PLATFORMS } from "@/lib/domain/constants";
import { isIsoDate, isTime } from "@/lib/calendar/time";
import { optionalEnum, optionalText } from "./common";

const uuidOrNull = z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null);

/** Statuses a person can set from the editor. "published" needs an explicit confirmation; "failed" is set by a publisher. */
export const EDITABLE_STATUSES = ["idea", "planned", "brief_ready", "in_production", "in_review", "approved", "scheduled"] as const;

export const postSchema = z
  .object({
    title: z.string().trim().min(1, "Give the post a title").max(300),
    platform: z.enum(PLATFORMS, { message: "Choose a platform" }),
    format: optionalText(120),
    caption: optionalText(5000),
    hook: optionalText(1000),
    cta: optionalText(500),
    creative_brief: optionalText(3000),
    hashtags: z
      .union([z.array(z.string()), z.string()])
      .nullish()
      .transform((v) =>
        (Array.isArray(v) ? v : (v ?? "").split(/[\s,]+/))
          .map((t) => t.trim().replace(/^#*/, ""))
          .filter(Boolean)
          .slice(0, 30)
          .map((t) => `#${t}`),
      ),
    pillar_id: uuidOrNull,
    campaign_id: uuidOrNull,
    /** set when the post is created from a content opportunity */
    opportunity_id: uuidOrNull,
    funnel_stage: optionalEnum(FUNNEL_STAGES),
    language: optionalEnum(LANGUAGES),
    media_url: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) => v || null)
      .refine((v) => !v || /^https:\/\/\S+$/i.test(v), "Use an https:// link to the image or video"),
    date: z.string().nullish().transform((v) => v || null).refine((v) => !v || isIsoDate(v), "Invalid date"),
    time: z.string().nullish().transform((v) => v || null).refine((v) => !v || isTime(v), "Use HH:MM"),
    status: z.enum(EDITABLE_STATUSES),
  })
  .refine((p) => p.status !== "scheduled" || (p.date && p.time), { message: "A scheduled post needs a date and a time", path: ["time"] })
  .refine((p) => !p.time || p.date, { message: "Pick a date for this time", path: ["date"] });
export type PostInput = z.infer<typeof postSchema>;

export const generatePostSchema = z.object({
  platform: z.enum(PLATFORMS),
  pillar_id: uuidOrNull,
  funnel_stage: optionalEnum(FUNNEL_STAGES),
  format: optionalText(120),
  date: z.string().nullish().transform((v) => v || null),
  instruction: z.string().max(1000).optional(),
  existing: z
    .object({ title: z.string().max(300), caption: z.string().max(5000).nullable(), hook: z.string().max(1000).nullable() })
    .nullish(),
});
export type GeneratePostInput = z.infer<typeof generatePostSchema>;
