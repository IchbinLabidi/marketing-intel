// What each integration connects, which metrics it really provides, and what it takes to enable it.
// Shown on the integrations page; kept in one place so the UI and the docs say the same thing.

export type ProviderKey = "meta" | "youtube" | "linkedin" | "tiktok";

export type ProviderInfo = {
  key: ProviderKey;
  name: string;
  connects: string;
  metrics: string[];
  extraWithOAuth?: string[];
  notAvailable: string[];
  permissions: string[];
  requirements: string[];
  env: string[];
  setup: string[];
};

export const CATALOG: Record<ProviderKey, ProviderInfo> = {
  meta: {
    key: "meta", name: "Meta", connects: "One Facebook Page and its linked Instagram professional account per project",
    metrics: ["Posts and reels with publication time", "Reactions/likes, comments, shares, saves", "Reach, views and impressions where Meta allows them for the post type"],
    notAvailable: ["Follower history", "Paid (ads) results: organic only"],
    permissions: ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "read_insights", "instagram_basic", "instagram_manage_insights", "business_management"],
    requirements: ["A Meta developer app with Facebook Login for Business", "App Review for the permissions above before people outside the app's roles can connect", "Instagram must be a Business or Creator account linked to the Page"],
    env: ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"],
    setup: ["developers.facebook.com → your app → Facebook Login for Business", "Valid OAuth redirect URI: {APP_URL}/api/meta/callback", "Data deletion callback: {APP_URL}/api/meta/data-deletion; deauthorize: {APP_URL}/api/meta/deauthorize"],
  },
  youtube: {
    key: "youtube", name: "YouTube", connects: "YouTube channels (several per project)",
    metrics: ["Videos with publication time and duration", "Views, likes, comments (public counters)", "Subscribers (when the channel shows them) and total channel views, recorded daily"],
    extraWithOAuth: ["Watch time (minutes)", "Shares", "Subscribers gained per video"],
    notAvailable: ["Impressions and click-through rate (not exposed per video by the APIs used)", "Paid (ads) results: organic only"],
    permissions: ["youtube.readonly", "yt-analytics.readonly"],
    requirements: ["Public data: only YOUTUBE_API_KEY (already used by Competitors)", "Full data: a Google Cloud OAuth client; the consent screen must be verified by Google before people outside your test users can connect"],
    env: ["YOUTUBE_API_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    setup: ["console.cloud.google.com → APIs & Services → enable YouTube Data API v3 and YouTube Analytics API", "Credentials → OAuth client ID → Web application", "Authorized redirect URI: {APP_URL}/api/integrations/youtube/callback", "OAuth consent screen: add the two read-only scopes; add test users until the app is verified"],
  },
  linkedin: {
    key: "linkedin", name: "LinkedIn", connects: "LinkedIn company pages you administer (several per project)",
    metrics: ["Page posts with publication time and type", "Impressions, unique impressions (people reached), clicks", "Likes (reactions), comments, reposts", "Page followers, recorded daily"],
    notAvailable: ["Video watch time", "Personal profiles (LinkedIn only exposes organization analytics)", "Paid (ads) results: organic only"],
    permissions: ["r_organization_admin", "r_organization_social"],
    requirements: ["A LinkedIn developer app verified by the company page", "The Community Management API product, which LinkedIn must approve (application and review)", "The person connecting must be an administrator of the page"],
    env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    setup: ["linkedin.com/developers → Create app → verify it with the company page", "Products → request Community Management API", "Auth → Authorized redirect URL: {APP_URL}/api/integrations/linkedin/callback"],
  },
  tiktok: {
    key: "tiktok", name: "TikTok", connects: "TikTok accounts (one per authorization; connect again with another account to add more)",
    metrics: ["Public videos with publication time", "Views, likes, comments, shares", "Followers, recorded daily"],
    notAvailable: ["Reach, watch time and traffic sources (not in the Display API)", "Paid (ads) results: organic only"],
    permissions: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
    requirements: ["A TikTok for Developers app with Login Kit and the Display API", "TikTok must review and approve the app; until then only sandbox test accounts can connect"],
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    setup: ["developers.tiktok.com → Manage apps → Create app → add Login Kit and Display API (Web)", "Redirect URI: {APP_URL}/api/integrations/tiktok/callback", "Add the four scopes, submit for review; add sandbox test users meanwhile"],
  },
};

export type IntegrationState = "not_configured" | "ready" | "awaiting" | "connected" | "syncing" | "needs_attention" | "permission_denied" | "disconnected";

export const STATE_INFO: Record<IntegrationState, { label: string; meaning: string; next: string; tone: "secondary" | "outline" | "info" | "success" | "warning" | "destructive" }> = {
  not_configured: { label: "Not configured", meaning: "The server doesn't have this provider's developer app credentials yet.", next: "An administrator adds the settings listed below, then you can connect.", tone: "outline" },
  ready: { label: "Ready to connect", meaning: "Everything is set up on the server. No account is connected to this project yet.", next: "Connect an account you manage.", tone: "secondary" },
  awaiting: { label: "Awaiting authorization", meaning: "The sign-in was started but not completed, or a page still has to be chosen.", next: "Finish the connection.", tone: "info" },
  connected: { label: "Connected", meaning: "Access works and data is synchronized.", next: "Nothing to do. Data refreshes daily; sync now for the latest figures.", tone: "success" },
  syncing: { label: "Synchronizing", meaning: "Data is being imported right now.", next: "Wait a moment; this page updates by itself.", tone: "info" },
  needs_attention: { label: "Needs attention", meaning: "Access expired or the last sync failed.", next: "Reconnect the account, or retry the sync.", tone: "warning" },
  permission_denied: { label: "Permission denied", meaning: "The account was connected without a permission the import needs.", next: "Reconnect and accept every requested permission, or check that the app's products are approved.", tone: "destructive" },
  disconnected: { label: "Disconnected", meaning: "Access was removed. Previously imported posts are kept unless you deleted them.", next: "Connect again to resume.", tone: "outline" },
};
