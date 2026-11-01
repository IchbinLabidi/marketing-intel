import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/server/meta/config";
import { socialTokenKey } from "@/server/social/config";

// TikTok photo posts are pulled by TikTok from a link on a URL prefix verified for the app. Photos are served under
// `${APP_URL}/tiktok-media/` through short-lived signed names: a name opens one stored file, only until it expires,
// and can't be guessed or changed (HMAC). Nothing else in storage is reachable there.
export const TIKTOK_MEDIA_PREFIX = "/tiktok-media/";
const TTL_MS = 2 * 3600_000;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string) => b64(createHmac("sha256", `tiktok-media:${socialTokenKey()}`).update(payload).digest()).slice(0, 32);

/** A public, expiring link to one stored photo, for TikTok to download. */
export function tiktokMediaUrl(storagePath: string, now = Date.now()) {
  const payload = b64(JSON.stringify({ p: storagePath, e: now + TTL_MS }));
  return `${appUrl()}${TIKTOK_MEDIA_PREFIX}${payload}.${sign(payload)}.jpg`;
}

/** The stored path a signed name opens, or null when it is forged or expired. */
export function readTikTokMediaName(name: string, now = Date.now()): string | null {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{32})\.jpg$/.exec(name);
  if (!m || !socialTokenKey()) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { p: string; e: number };
    return typeof p === "string" && typeof e === "number" && e > now && p.includes("/publish-tmp-") ? p : null;
  } catch {
    return null;
  }
}
