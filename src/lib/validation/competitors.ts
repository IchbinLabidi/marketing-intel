import { z } from "zod";
import { FUNNEL_STAGES, PLATFORMS } from "@/lib/domain/constants";
import { optionalText } from "./common";

export const competitorSchema = z.object({
  name: z.string().trim().min(1, "Enter the competitor's name").max(200),
  website: optionalText(500),
  description: optionalText(2000),
  industry: optionalText(200),
  target_audience: optionalText(2000),
  monitoring: z.enum(["manual", "daily", "weekly"]),
  history_days: z.coerce.number().int().refine((n) => [30, 90, 180, 365].includes(n), "Choose a period"),
  max_posts: z.coerce.number().int().min(10).max(1000),
  profiles: z.array(z.string().trim().max(500)).max(20),
});
export type CompetitorInput = z.input<typeof competitorSchema>;

const count = z.union([z.coerce.number().int().min(0).max(1e12), z.literal("")]).nullish().transform((v) => (v === "" || v == null ? null : v));
export const manualPostSchema = z.object({
  channel_id: z.uuid(),
  url: z.string().trim().url("Paste the post's link").max(1000).refine((v) => v.startsWith("https://"), "Use an https:// link"),
  published_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter the publication date"),
  caption: optionalText(5000),
  format: optionalText(120),
  likes: count, comments: count, shares: count, views: count,
});

export const ideaEditSchema = z.object({
  title: z.string().trim().min(1).max(300),
  rationale: z.string().trim().min(1).max(5000),
  creative_angle: optionalText(2000),
  hook: optionalText(1000),
  cta: optionalText(500),
  format: optionalText(120),
  platform: z.enum(PLATFORMS),
  pillar_id: z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null),
  funnel_stage: z.enum(FUNNEL_STAGES).nullish(),
});
