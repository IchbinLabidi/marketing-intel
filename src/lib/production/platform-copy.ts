// Per-platform captions and descriptions (content_items.platform_captions, migration 0024). Pure and tested.
// The general caption (content_items.caption) stays as legacy copy: it is never copied into a platform automatically,
// and publishing falls back to it only when a platform has no caption of its own.
import { z } from "zod";
import type { PublishTarget } from "@/lib/publishing/rules";

export const COPY_PLATFORMS = ["tiktok", "facebook", "instagram", "youtube_shorts", "youtube", "linkedin", "x", "threads", "pinterest"] as const;
export type CopyPlatform = typeof COPY_PLATFORMS[number];
/** Always shown as tabs; the others are added per item. */
export const MAIN_COPY_PLATFORMS = ["tiktok", "facebook", "instagram", "youtube_shorts", "youtube"] as const satisfies readonly CopyPlatform[];
export const COPY_PLATFORM_LABELS: Record<CopyPlatform, string> = {
  tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", youtube_shorts: "YouTube Shorts", youtube: "YouTube", linkedin: "LinkedIn", x: "X", threads: "Threads", pinterest: "Pinterest",
};

export type CopyField = "title" | "caption" | "hashtags" | "cta" | "keywords" | "link" | "alt_text" | "chapters" | "links" | "post_type";
/** Fields each platform uses, in display order. The caption is the description on YouTube. */
export const PLATFORM_FIELDS: Record<CopyPlatform, CopyField[]> = {
  tiktok: ["caption", "hashtags", "cta", "keywords"],
  facebook: ["post_type", "caption", "hashtags", "cta", "link"],
  instagram: ["post_type", "caption", "hashtags", "cta", "alt_text"],
  youtube_shorts: ["title", "caption", "hashtags", "keywords", "cta"],
  youtube: ["title", "caption", "hashtags", "keywords", "chapters", "cta", "links"],
  linkedin: ["caption", "hashtags", "cta", "link"],
  x: ["caption", "hashtags", "cta", "link"],
  threads: ["caption", "hashtags", "cta"],
  pinterest: ["title", "caption", "hashtags", "link"],
};
export const POST_TYPES: Partial<Record<CopyPlatform, { value: string; label: string }[]>> = {
  facebook: [{ value: "reel", label: "Reel" }, { value: "post", label: "Regular post" }],
  instagram: [{ value: "reel", label: "Reel" }, { value: "carousel", label: "Carousel" }, { value: "post", label: "Regular post" }],
};
/** Documented limits of each network, used for counters and checks (YouTube title 100, description 5,000). */
export const COPY_LIMITS: Record<CopyPlatform, { caption: number; title?: number; hashtags?: number }> = {
  tiktok: { caption: 2_200 }, facebook: { caption: 63_206 }, instagram: { caption: 2_200, hashtags: 30 },
  youtube_shorts: { caption: 5_000, title: 100 }, youtube: { caption: 5_000, title: 100 },
  linkedin: { caption: 3_000 }, x: { caption: 280 }, threads: { caption: 500 }, pinterest: { caption: 500, title: 100 },
};

export const TONES = ["auto", "professional", "friendly", "funny", "educational", "motivational", "persuasive"] as const;
export const COPY_LANGUAGES = ["auto", "ar_tn", "ar", "fr", "en"] as const;
export const OBJECTIVES = ["auto", "engagement", "awareness", "traffic", "leads", "conversion", "community"] as const;
export const LENGTHS = ["auto", "short", "medium", "long"] as const;
export const TONE_LABELS: Record<typeof TONES[number], string> = { auto: "Automatic", professional: "Professional", friendly: "Friendly", funny: "Funny", educational: "Educational", motivational: "Motivational", persuasive: "Persuasive" };
export const COPY_LANGUAGE_LABELS: Record<typeof COPY_LANGUAGES[number], string> = { auto: "Automatic", ar_tn: "Tunisian Darija", ar: "Arabic", fr: "French", en: "English" };
export const OBJECTIVE_LABELS: Record<typeof OBJECTIVES[number], string> = { auto: "Automatic", engagement: "Engagement", awareness: "Awareness", traffic: "Website traffic", leads: "Lead generation", conversion: "Conversion", community: "Community participation" };
export const LENGTH_LABELS: Record<typeof LENGTHS[number], string> = { auto: "Automatic", short: "Short", medium: "Medium", long: "Long" };

export const copySettingsSchema = z.object({ tone: z.enum(TONES), language: z.enum(COPY_LANGUAGES), objective: z.enum(OBJECTIVES), length: z.enum(LENGTHS) });
export type CopySettings = z.infer<typeof copySettingsSchema>;
export const AUTO_SETTINGS: CopySettings = { tone: "auto", language: "auto", objective: "auto", length: "auto" };

const text = (max: number) => z.string().max(max).default("");
const list = z.array(z.string().trim().max(100)).max(50).default([]);
export const platformCopySchema = z.object({
  title: text(300), caption: text(63_206), hashtags: list, cta: text(1000), keywords: list, link: text(2000), alt_text: text(1000),
  chapters: text(5000), links: text(5000), post_type: text(30),
  /** "approved": locked as final by a person; regenerating all platforms leaves it untouched. */
  status: z.enum(["draft", "approved"]).default("draft"),
  /** Generation settings that override the global ones for this platform only. */
  settings: copySettingsSchema.partial().default({}),
  updated_at: z.string().max(40).optional(),
});
export type PlatformCopy = z.infer<typeof platformCopySchema>;
export const platformCaptionsSchema = z.partialRecord(z.enum(COPY_PLATFORMS), platformCopySchema).default({});
export type PlatformCaptions = Partial<Record<CopyPlatform, PlatformCopy>>;

export function emptyCopy(platform?: CopyPlatform): PlatformCopy {
  return { title: "", caption: "", hashtags: [], cta: "", keywords: [], link: "", alt_text: "", chapters: "", links: "", post_type: platform ? POST_TYPES[platform]?.[0]?.value ?? "" : "", status: "draft", settings: {} };
}
/** Reads stored JSON leniently: unknown platforms and malformed entries are dropped, missing fields filled. */
export function readCaptions(value: unknown): PlatformCaptions {
  if (!value || typeof value !== "object") return {};
  const out: PlatformCaptions = {};
  for (const p of COPY_PLATFORMS) {
    const raw = (value as Record<string, unknown>)[p];
    if (!raw) continue;
    const parsed = platformCopySchema.safeParse(raw);
    if (parsed.success) out[p] = parsed.data;
  }
  return out;
}
export const tagsOf = (value: string) => value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
export const hashtagText = (tags: string[]) => tags.map((h) => `#${h.replace(/^#+/, "")}`).filter((h) => h.length > 1).join(" ");
/** True when the platform has any copy worth keeping (a draft with only a post type is empty). */
export function hasCopy(c: PlatformCopy | undefined) {
  return Boolean(c && (c.title.trim() || c.caption.trim() || c.cta.trim() || c.hashtags.length || c.keywords.length || c.alt_text.trim() || c.chapters.trim() || c.links.trim() || c.link.trim()));
}

/** Settings sent for one platform: its own overrides win over the global ones. */
export function effectiveSettings(global: CopySettings, copy: PlatformCopy | undefined): CopySettings {
  return { ...global, ...Object.fromEntries(Object.entries(copy?.settings ?? {}).filter(([, v]) => v && v !== "auto")) } as CopySettings;
}

/**
 * Applies generated copy to the stored captions. Only the listed platforms change; approved platforms are kept unless
 * `force` lists them; per-platform settings are preserved.
 */
export function applyGenerated(current: PlatformCaptions, generated: Partial<Record<CopyPlatform, Partial<PlatformCopy>>>, platforms: CopyPlatform[], now: string, force: CopyPlatform[] = []): PlatformCaptions {
  const next: PlatformCaptions = { ...current };
  for (const p of platforms) {
    const g = generated[p];
    if (!g) continue;
    const before = current[p];
    if (before?.status === "approved" && !force.includes(p)) continue;
    const fields = PLATFORM_FIELDS[p];
    const base = before ?? emptyCopy(p);
    const merged: PlatformCopy = { ...base, status: "draft", updated_at: now };
    for (const f of fields) if (g[f] !== undefined) (merged as Record<string, unknown>)[f] = g[f];
    next[p] = merged;
  }
  return next;
}

/** Platforms whose current copy would be replaced by an "all platforms" generation (approved ones are skipped). */
export function replacedBy(current: PlatformCaptions, platforms: CopyPlatform[]) {
  return { replaced: platforms.filter((p) => hasCopy(current[p]) && current[p]?.status !== "approved"), kept: platforms.filter((p) => current[p]?.status === "approved") };
}

/** Which stored platform a publication uses. YouTube uses Shorts copy for a Short and the long-form copy otherwise. */
export function copyPlatformFor(target: PublishTarget, youtube: "shorts" | "video" = "video"): CopyPlatform {
  return target === "youtube" ? (youtube === "shorts" ? "youtube_shorts" : "youtube") : target;
}
/** Default YouTube variant: Shorts when only the Shorts copy is written, or when the content is a Reel/Short. */
export function defaultYouTubeVariant(captions: PlatformCaptions, format: string | null | undefined): "shorts" | "video" {
  if (hasCopy(captions.youtube_shorts) && !hasCopy(captions.youtube)) return "shorts";
  if (hasCopy(captions.youtube) && !hasCopy(captions.youtube_shorts)) return "video";
  return /reel|short|story|tiktok/i.test(format ?? "") ? "shorts" : "video";
}

/** Text published for one platform: its caption, CTA (when not already in the text), hashtags and, on YouTube, chapters and links. */
export function composePlatformText(c: PlatformCopy, platform: CopyPlatform) {
  const fields = PLATFORM_FIELDS[platform];
  const caption = c.caption.trim();
  const parts = [caption, c.cta.trim() && !caption.includes(c.cta.trim()) ? c.cta.trim() : ""];
  if (fields.includes("link") && c.link.trim() && !caption.includes(c.link.trim())) parts.push(c.link.trim());
  if (fields.includes("chapters") && c.chapters.trim()) parts.push(c.chapters.trim());
  if (fields.includes("links") && c.links.trim()) parts.push(c.links.trim());
  parts.push(hashtagText(c.hashtags));
  return parts.filter(Boolean).join("\n\n");
}

/** The copy a publication sends: the platform's own copy when written, otherwise the general (legacy) caption. */
export function publicationCopy(item: { title: string | null; caption: string | null; cta?: string | null; hashtags?: string[] | null; platform_captions?: unknown },
  target: PublishTarget, legacy: (item: { caption: string | null; cta?: string | null; hashtags?: string[] | null }) => string, youtube: "shorts" | "video" = "video") {
  const platform = copyPlatformFor(target, youtube);
  const own = readCaptions(item.platform_captions)[platform];
  if (own && (own.caption.trim() || own.title.trim())) return { platform, source: "platform" as const, text: composePlatformText(own, platform), title: own.title.trim() || null };
  return { platform, source: "general" as const, text: legacy(item), title: null };
}
