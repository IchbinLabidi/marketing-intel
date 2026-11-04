// Publishing rules per network (pure, tested). Limits are the documented ones for the APIs used.
import { createTranslator, type MessageTree } from "@/i18n/core";
import { createFormatter } from "@/i18n/format";
import type { KeysOf, TFor } from "@/i18n/messages";
import enCalendar from "@/i18n/locales/en/calendar";

/** Messages come from the "calendar" namespace; callers pass the viewer's translator (English when omitted). */
let english: TFor<"calendar"> | null = null;
const fallback = () => (english ??= createTranslator<KeysOf["calendar"]>("en", "calendar", enCalendar as unknown as MessageTree));

export type PublishTarget = "facebook" | "instagram" | "tiktok" | "youtube";

export const LIMITS = {
  facebook: { caption: 63_206, image: ["image/jpeg", "image/png", "image/gif", "image/webp"], video: ["video/mp4", "video/quicktime"] },
  // Instagram Content Publishing API: JPEG images only (stored and Drive photos in other formats are converted to JPEG
  // before sending); Reels as MP4/MOV; caption ≤ 2,200 characters, ≤ 30 hashtags
  // TikTok Content Posting API (Direct Post): one video (MP4/MOV/WebM, caption ≤ 2,200 characters) or a photo post
  // (photos sent as JPEG from a verified link, description ≤ 4,000 characters)
  tiktok: { caption: 2_200, photoCaption: 4_000, image: ["image/jpeg", "image/png", "image/webp"], video: ["video/mp4", "video/quicktime", "video/webm"] },
  // YouTube Data API (videos.insert): one video, description ≤ 5,000 characters (the title comes from the post title)
  youtube: { caption: 5_000, video: ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/mpeg"] },
  instagram: { caption: 2_200, hashtags: 30, image: ["image/jpeg", "image/png", "image/webp", "image/gif"], video: ["video/mp4", "video/quicktime"] },
} as const;

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // storage limit for files kept for publishing

export function mediaKindOf(mime: string | null | undefined): "image" | "video" | null {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/** Caption, CTA and hashtags as one text, the way the post is written in the calendar. */
export function composeCaption(post: { caption: string | null; cta?: string | null; hashtags?: string[] | null }) {
  const tags = (post.hashtags ?? []).map((h) => `#${h.replace(/^#+/, "")}`).filter((h) => h.length > 1);
  const body = [post.caption?.trim(), post.cta && !(post.caption ?? "").includes(post.cta) ? post.cta.trim() : null].filter(Boolean).join("\n\n");
  return [body, tags.join(" ")].filter(Boolean).join("\n\n");
}

/** Returns a readable problem, or null when the post can be sent to that network. */
export function validateForTarget(target: PublishTarget, p: { caption: string; mime: string | null | undefined; hasMedia: boolean }, t: TFor<"calendar"> = fallback()): string | null {
  if (!p.caption.trim() && !p.hasMedia) return t("rules.empty");
  if (target === "youtube") {
    if (!p.hasMedia || mediaKindOf(p.mime) !== "video") return t("rules.youtubeNeedsVideo");
    if (!(LIMITS.youtube.video as readonly string[]).includes(p.mime!)) return t("rules.youtubeFormats");
    if (p.caption.length > LIMITS.youtube.caption) return t("rules.youtubeLength", { max: LIMITS.youtube.caption });
    return null;
  }
  if (target === "tiktok") {
    const kind = p.hasMedia ? mediaKindOf(p.mime) : null;
    if (kind === "image") {
      if (!(LIMITS.tiktok.image as readonly string[]).includes(p.mime!)) return t("rules.tiktokPhotoFormats");
      if (p.caption.length > LIMITS.tiktok.photoCaption) return t("rules.tiktokPhotoLength", { max: LIMITS.tiktok.photoCaption });
      return null;
    }
    if (kind !== "video") return t("rules.tiktokNeedsMedia");
    if (!(LIMITS.tiktok.video as readonly string[]).includes(p.mime!)) return t("rules.tiktokFormats");
    if (p.caption.length > LIMITS.tiktok.caption) return t("rules.tiktokLength", { max: LIMITS.tiktok.caption });
    return null;
  }
  if (target === "instagram") {
    if (!p.hasMedia) return t("rules.instagramNeedsMedia");
    if (p.caption.length > LIMITS.instagram.caption) return t("rules.instagramLength", { max: LIMITS.instagram.caption, count: p.caption.length });
    const tags = (p.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (tags > LIMITS.instagram.hashtags) return t("rules.instagramHashtags", { count: tags });
    const kind = mediaKindOf(p.mime);
    if (kind === "image" && !(LIMITS.instagram.image as readonly string[]).includes(p.mime!)) return t("rules.instagramPhotoFormats");
    if (kind === "video" && !(LIMITS.instagram.video as readonly string[]).includes(p.mime!)) return t("rules.instagramVideoFormats");
    if (!kind) return t("rules.instagramNeedsMedia");
  } else {
    if (p.caption.length > LIMITS.facebook.caption) return t("rules.facebookLength");
    const kind = mediaKindOf(p.mime);
    if (p.hasMedia && kind === "image" && !(LIMITS.facebook.image as readonly string[]).includes(p.mime!)) return t("rules.facebookImageFormats");
    if (p.hasMedia && kind === "video" && !(LIMITS.facebook.video as readonly string[]).includes(p.mime!)) return t("rules.facebookVideoFormats");
  }
  return null;
}

export const MAX_GROUP = 10; // Instagram carousels and Facebook multi-photo posts

/** Several files in one post: only photos, at most 10 (Instagram carousel limit). Null when fine. */
export function validateGroup(target: PublishTarget, mimes: (string | null | undefined)[], t: TFor<"calendar"> = fallback()): string | null {
  if (mimes.length < 2) return null;
  if (target === "youtube") return t("rules.youtubeSingle");
  if (mimes.length > MAX_GROUP) return t("rules.groupMax", { max: MAX_GROUP });
  if (mimes.some((m) => mediaKindOf(m) !== "image")) return t("rules.groupPhotosOnly");
  if (target === "instagram" && mimes.some((m) => !(LIMITS.instagram.image as readonly string[]).includes(m!))) return t("rules.instagramPhotoFormats");
  if (target === "tiktok" && mimes.some((m) => !(LIMITS.tiktok.image as readonly string[]).includes(m!))) return t("rules.tiktokPhotoFormats");
  return null;
}

/** Checks a file chosen on the computer before anything is uploaded. */
export function validateLocalFile(f: { type: string; size: number }, t: TFor<"calendar">): string | null {
  if (!mediaKindOf(f.type)) return t("rules.localKind");
  if (!["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"].includes(f.type)) return t("rules.localFormats");
  if (f.size > MAX_FILE_BYTES) return t("rules.localTooLarge", { size: createFormatter(t.locale).number(f.size / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  if (f.size === 0) return t("rules.localEmpty");
  return null;
}
