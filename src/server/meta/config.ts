import "server-only";

// Meta configuration. Everything here is server-side; nothing is exposed with NEXT_PUBLIC_.
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v26.0";
export const META_GRAPH_HOST = "https://graph.facebook.com";

/**
 * Permissions requested when no Facebook Login for Business configuration id is set. All are read-only;
 * publishing permissions are only requested when someone chooses "Enable publishing" (see buildAuthUrl).
 * META_SCOPES (comma-separated) overrides the list, e.g. when Meta renames a permission for your app's use cases.
 */
export const META_SCOPES = process.env.META_SCOPES?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
  "pages_show_list",          // list the Pages the person manages
  "pages_read_engagement",    // read Page posts, reactions, comments, shares
  "pages_read_user_content",  // required with pages_read_engagement to list the Page's posts (/{page}/posts)
  "read_insights",            // Page and post insights
  "instagram_basic",          // linked Instagram professional account and its media
  "instagram_manage_insights",// Instagram media insights
  "business_management",      // Pages owned through a Business portfolio
];

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function metaConfig() {
  return {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    configId: process.env.META_LOGIN_CONFIG_ID ?? "", // optional: Facebook Login for Business configuration
    redirectUri: process.env.META_REDIRECT_URI || `${appUrl()}/api/meta/callback`,
    tokenKey: process.env.META_TOKEN_ENCRYPTION_KEY ?? "",
  };
}

/** Lists what is missing so the UI can say exactly what to configure. */
export function metaMissingConfig() {
  const c = metaConfig();
  return [
    !c.appId && "META_APP_ID",
    !c.appSecret && "META_APP_SECRET",
    !c.tokenKey && "META_TOKEN_ENCRYPTION_KEY",
  ].filter((x): x is string => Boolean(x));
}

export const isMetaConfigured = () => metaMissingConfig().length === 0;

export const isBackgroundSyncConfigured = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET);
