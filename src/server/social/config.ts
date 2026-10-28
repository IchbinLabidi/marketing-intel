import "server-only";
import { appUrl } from "@/server/meta/config";
import type { SocialProvider } from "@/lib/social/normalize";

// Server-side configuration for YouTube, LinkedIn and TikTok. Nothing here is exposed to the browser.

/** Tokens are encrypted with SOCIAL_TOKEN_ENCRYPTION_KEY, or the Meta key when no separate key is set. */
export const socialTokenKey = () => process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || process.env.META_TOKEN_ENCRYPTION_KEY || "";

export const redirectUri = (provider: SocialProvider) => process.env[`${provider.toUpperCase()}_REDIRECT_URI`] || `${appUrl()}/api/integrations/${provider}/callback`;

type OAuthConfig = { clientId: string; clientSecret: string; scopes: string[]; missing: string[] };

export const PROVIDER_ENV: Record<SocialProvider, { id: string; secret: string }> = {
  youtube: { id: "GOOGLE_OAUTH_CLIENT_ID", secret: "GOOGLE_OAUTH_CLIENT_SECRET" },
  linkedin: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  tiktok: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" },
};

/** Minimum read-only scopes for each provider. */
export const SCOPES: Record<SocialProvider, string[]> = {
  // Channel, videos and public statistics; YouTube Analytics for watch time, shares and subscribers gained.
  youtube: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"],
  // Community Management API: list administered pages, read their posts and page/post statistics.
  linkedin: ["r_organization_admin", "r_organization_social"],
  // Login Kit + Display API: profile, follower/like counts, public videos with their counters.
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
};

export function oauthConfig(provider: SocialProvider): OAuthConfig {
  const env = PROVIDER_ENV[provider];
  const clientId = process.env[env.id]?.trim() ?? "";
  const clientSecret = process.env[env.secret]?.trim() ?? "";
  const override = process.env[`${provider.toUpperCase()}_SCOPES`]?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    clientId, clientSecret, scopes: override?.length ? override : SCOPES[provider],
    missing: [!clientId && env.id, !clientSecret && env.secret, !socialTokenKey() && "SOCIAL_TOKEN_ENCRYPTION_KEY"].filter((x): x is string => Boolean(x)),
  };
}

export const isOAuthConfigured = (p: SocialProvider) => oauthConfig(p).missing.length === 0;
export const youtubeApiKey = () => process.env.YOUTUBE_API_KEY?.trim() || null;
