// Publishing rules per network (pure, tested). Limits are the documented ones for the APIs used.

export type PublishTarget = "facebook" | "instagram";

export const LIMITS = {
  facebook: { caption: 63_206, image: ["image/jpeg", "image/png", "image/gif", "image/webp"], video: ["video/mp4", "video/quicktime"] },
  // Instagram Content Publishing API: JPEG images only; Reels as MP4/MOV; caption ≤ 2,200 characters, ≤ 30 hashtags
  instagram: { caption: 2_200, hashtags: 30, image: ["image/jpeg"], video: ["video/mp4", "video/quicktime"] },
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
export function validateForTarget(target: PublishTarget, p: { caption: string; mime: string | null | undefined; hasMedia: boolean }): string | null {
  if (!p.caption.trim() && !p.hasMedia) return "The post has no caption and no media.";
  if (target === "instagram") {
    if (!p.hasMedia) return "Instagram needs an image or a video.";
    if (p.caption.length > LIMITS.instagram.caption) return `Instagram captions are limited to ${LIMITS.instagram.caption.toLocaleString("en")} characters (this one has ${p.caption.length.toLocaleString("en")}).`;
    const tags = (p.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (tags > LIMITS.instagram.hashtags) return `Instagram allows at most 30 hashtags (this post has ${tags}).`;
    const kind = mediaKindOf(p.mime);
    if (kind === "image" && !(LIMITS.instagram.image as readonly string[]).includes(p.mime!)) return "Instagram's publishing API only accepts JPEG images. Export the image as JPG.";
    if (kind === "video" && !(LIMITS.instagram.video as readonly string[]).includes(p.mime!)) return "Instagram Reels must be MP4 or MOV videos.";
    if (!kind) return "Instagram needs an image or a video.";
  } else {
    if (p.caption.length > LIMITS.facebook.caption) return "The caption is too long for Facebook.";
    const kind = mediaKindOf(p.mime);
    if (p.hasMedia && kind === "image" && !(LIMITS.facebook.image as readonly string[]).includes(p.mime!)) return "Facebook accepts JPEG, PNG, GIF or WebP images.";
    if (p.hasMedia && kind === "video" && !(LIMITS.facebook.video as readonly string[]).includes(p.mime!)) return "Facebook accepts MP4 or MOV videos here.";
  }
  return null;
}

export const MAX_GROUP = 10; // Instagram carousels and Facebook multi-photo posts

/** Several files in one post: only photos, at most 10 (Instagram carousel limit). Null when fine. */
export function validateGroup(target: PublishTarget, mimes: (string | null | undefined)[]): string | null {
  if (mimes.length < 2) return null;
  if (mimes.length > MAX_GROUP) return `Choose at most ${MAX_GROUP} photos for one post.`;
  if (mimes.some((m) => mediaKindOf(m) !== "image")) return "Several files in one post must all be photos. Publish a video on its own.";
  if (target === "instagram" && mimes.some((m) => !(LIMITS.instagram.image as readonly string[]).includes(m!))) return "Instagram's publishing API only accepts JPEG images. Export the photos as JPG.";
  return null;
}

/** Checks a file chosen on the computer before anything is uploaded. */
export function validateLocalFile(f: { type: string; size: number }): string | null {
  if (!mediaKindOf(f.type)) return "Choose an image or a video.";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"].includes(f.type)) return "Use JPG, PNG, WebP, GIF, MP4 or MOV.";
  if (f.size > MAX_FILE_BYTES) return `The file is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit for files kept for publishing is 50 MB.`;
  if (f.size === 0) return "The file is empty.";
  return null;
}
