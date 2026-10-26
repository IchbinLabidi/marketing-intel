import type { Platform } from "@/lib/domain/constants";

// Social profile URLs → platform + handle + canonical URL. Only profile URLs are accepted (not posts or searches),
// so one competitor account maps to exactly one row and duplicates can be detected.

export type ParsedProfile = { platform: Platform; handle: string; url: string };
export type ParseResult = { ok: true; profile: ParsedProfile } | { ok: false; error: string };

const RESERVED: Record<string, string[]> = {
  instagram: ["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct"],
  facebook: ["sharer", "share", "watch", "groups", "events", "photo", "photos", "story.php", "permalink.php", "login", "marketplace", "hashtag", "reel"],
  tiktok: ["discover", "tag", "music", "search", "foryou"],
  x: ["i", "home", "search", "explore", "hashtag", "intent", "share", "settings"],
};

const clean = (s: string) => decodeURIComponent(s).trim().replace(/^@/, "");

export function parseProfileUrl(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Paste a profile link." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, error: "This is not a valid link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Use an http(s) link." };
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map(clean);
  const first = parts[0] ?? "";
  const handleOk = (h: string, re: RegExp) => Boolean(h) && re.test(h);

  if (host === "instagram.com" || host === "instagr.am") {
    if (!handleOk(first, /^[A-Za-z0-9._]{1,30}$/) || RESERVED.instagram.includes(first.toLowerCase())) return { ok: false, error: "Use an Instagram profile link, e.g. instagram.com/brand (not a post)." };
    return { ok: true, profile: { platform: "instagram", handle: first.toLowerCase(), url: `https://www.instagram.com/${first.toLowerCase()}/` } };
  }
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me") {
    if (first === "profile.php") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d+$/.test(id)) return { ok: false, error: "This Facebook link has no Page id." };
      return { ok: true, profile: { platform: "facebook", handle: id, url: `https://www.facebook.com/profile.php?id=${id}` } };
    }
    const slug = first.toLowerCase() === "pages" ? parts.at(-1) ?? "" : first;
    if (!handleOk(slug, /^[A-Za-z0-9.\-]{2,100}$/) || RESERVED.facebook.includes(slug.toLowerCase())) return { ok: false, error: "Use a Facebook Page link, e.g. facebook.com/brand." };
    return { ok: true, profile: { platform: "facebook", handle: slug.toLowerCase(), url: `https://www.facebook.com/${slug.toLowerCase()}` } };
  }
  const rawFirst = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
  if (host === "tiktok.com") {
    const h = clean(rawFirst);
    if (!rawFirst.startsWith("@") || !handleOk(h, /^[A-Za-z0-9._]{2,24}$/) || RESERVED.tiktok.includes(h.toLowerCase())) return { ok: false, error: "Use a TikTok profile link, e.g. tiktok.com/@brand." };
    return { ok: true, profile: { platform: "tiktok", handle: h.toLowerCase(), url: `https://www.tiktok.com/@${h.toLowerCase()}` } };
  }
  if (host === "youtube.com" || host === "youtu.be") {
    const seg = url.pathname.split("/").filter(Boolean);
    if (seg[0]?.startsWith("@")) {
      const h = clean(seg[0]);
      if (!handleOk(h, /^[A-Za-z0-9._\-]{3,30}$/)) return { ok: false, error: "This YouTube handle is not valid." };
      return { ok: true, profile: { platform: "youtube", handle: `@${h.toLowerCase()}`, url: `https://www.youtube.com/@${h.toLowerCase()}` } };
    }
    if (seg[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(seg[1] ?? "")) return { ok: true, profile: { platform: "youtube", handle: seg[1], url: `https://www.youtube.com/channel/${seg[1]}` } };
    if ((seg[0] === "c" || seg[0] === "user") && seg[1]) return { ok: true, profile: { platform: "youtube", handle: `${seg[0]}/${clean(seg[1]).toLowerCase()}`, url: `https://www.youtube.com/${seg[0]}/${clean(seg[1]).toLowerCase()}` } };
    return { ok: false, error: "Use a YouTube channel link, e.g. youtube.com/@brand." };
  }
  if (host === "linkedin.com") {
    if ((first === "company" || first === "school" || first === "showcase") && parts[1]) {
      return { ok: true, profile: { platform: "linkedin", handle: parts[1].toLowerCase(), url: `https://www.linkedin.com/${first}/${parts[1].toLowerCase()}/` } };
    }
    return { ok: false, error: "Use a LinkedIn company page link, e.g. linkedin.com/company/brand." };
  }
  if (host === "x.com" || host === "twitter.com") {
    if (!handleOk(first, /^[A-Za-z0-9_]{1,15}$/) || RESERVED.x.includes(first.toLowerCase())) return { ok: false, error: "Use an X profile link, e.g. x.com/brand." };
    return { ok: true, profile: { platform: "x", handle: first.toLowerCase(), url: `https://x.com/${first.toLowerCase()}` } };
  }
  if (host === "threads.net" || host === "threads.com") {
    if (!rawFirst.startsWith("@") || !handleOk(first, /^[A-Za-z0-9._]{1,30}$/)) return { ok: false, error: "Use a Threads profile link, e.g. threads.net/@brand." };
    return { ok: true, profile: { platform: "threads", handle: first.toLowerCase(), url: `https://www.threads.net/@${first.toLowerCase()}` } };
  }
  if (host === "pinterest.com" || host.endsWith(".pinterest.com")) {
    if (!handleOk(first, /^[A-Za-z0-9_]{3,30}$/)) return { ok: false, error: "Use a Pinterest profile link." };
    return { ok: true, profile: { platform: "pinterest", handle: first.toLowerCase(), url: `https://www.pinterest.com/${first.toLowerCase()}/` } };
  }
  return { ok: false, error: "Platform not recognised. Supported: Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Threads, Pinterest." };
}

/** Normalised https website, or null. */
export function normalizeWebsite(raw: string | null | undefined) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function hashtagsOf(text: string | null | undefined) {
  return [...new Set([...(text ?? "").matchAll(/#([\p{L}\p{N}_]{2,60})/gu)].map((m) => m[1].toLowerCase()))].slice(0, 40);
}
export function mentionsOf(text: string | null | undefined) {
  return [...new Set([...(text ?? "").matchAll(/(?:^|[^\w])@([A-Za-z0-9._]{2,30})/g)].map((m) => m[1].toLowerCase().replace(/\.$/, "")))].slice(0, 40);
}
