import "server-only";
import type { Platform } from "@/lib/domain/constants";
import { facebookProvider, instagramProvider } from "./meta";
import type { Availability, DataProvider, ProviderCredentials } from "./types";
import { xProvider } from "./x";
import { youtubeProvider } from "./youtube";

/** Registered providers. Adding a source = one more DataProvider here (e.g. an approved third-party data vendor). */
export const PROVIDERS: DataProvider[] = [instagramProvider, facebookProvider, youtubeProvider, xProvider];

/**
 * Platforms with no official way to read other accounts' public posts. Their profiles are stored and their posts
 * can be added by hand (with the original link) until an approved data provider is configured.
 */
export const UNSUPPORTED_REASON: Partial<Record<Platform, string>> = {
  tiktok: "TikTok's official APIs don't expose other accounts' posts to business apps (the Research API is limited to approved academic research). Add posts manually, or connect an approved data provider.",
  linkedin: "LinkedIn's APIs only return posts of organizations you administer. Add posts manually.",
  threads: "The Threads API only reads your own account. Add posts manually.",
  pinterest: "The Pinterest API only reads boards of the connected account. Add posts manually.",
  snapchat: "No public content API. Add posts manually.",
};

export function providerFor(platform: Platform) {
  return PROVIDERS.find((p) => p.platform === platform) ?? null;
}

export function availabilityFor(platform: Platform, creds: ProviderCredentials): Availability & { provider: string | null } {
  const p = providerFor(platform);
  if (!p) return { ok: false, status: "unsupported", reason: UNSUPPORTED_REASON[platform] ?? "No data provider for this platform yet. Add posts manually.", provider: null };
  return { ...p.availability(creds), provider: p.label };
}

export function envCredentials() {
  return { youtubeKey: process.env.YOUTUBE_API_KEY?.trim() || null, xBearer: process.env.X_BEARER_TOKEN?.trim() || null };
}
