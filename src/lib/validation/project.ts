import { z } from "zod";
import { LANGUAGES, PLATFORMS } from "@/lib/domain/constants";
import { optionalNumber, optionalText, optionalUrl, requiredText } from "./common";

export const projectSchema = z.object({
  name: requiredText(120),
  description: optionalText(1000),
  industry: optionalText(120),
  website: optionalUrl,
  default_language: z.enum(LANGUAGES).default("fr"),
});
export type ProjectInput = z.infer<typeof projectSchema>;

const lines = (max = 2000) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) =>
      (v ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );

export const brandProfileSchema = z.object({
  brand_name: optionalText(120),
  mission: optionalText(2000),
  vision: optionalText(2000),
  values: lines(),
  personality: optionalText(2000),
  visual_identity: optionalText(2000),
  target_audience: optionalText(3000),
  products_services: lines(5000).transform((rows) =>
    rows.map((row) => {
      const [name, ...rest] = row.split(/\s[—–-]\s/);
      return { name: name.trim(), description: rest.join(" - ").trim() || undefined };
    }),
  ),
  differentiators: optionalText(3000),
});
export type BrandProfileInput = z.infer<typeof brandProfileSchema>;

export const channelSchema = z.object({
  platform: z.enum(PLATFORMS),
  handle: optionalText(120),
  url: optionalUrl,
  target_posts_per_week: optionalNumber(0, 100),
});
export type ChannelInput = z.infer<typeof channelSchema>;
