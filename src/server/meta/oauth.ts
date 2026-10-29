import "server-only";
import { META_GRAPH_VERSION, META_SCOPES, metaConfig } from "./config";
import { graphGet, graphUrl } from "./graph";

/** Official Facebook Login dialog URL. Uses a Login for Business configuration when META_LOGIN_CONFIG_ID is set. */
/** `publish` adds the two publishing permissions on top of the read-only set (asked only when publishing is enabled). */
export function buildAuthUrl(state: string, opts: { publish?: boolean } = {}) {
  const c = metaConfig();
  const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", c.appId);
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (c.configId) url.searchParams.set("config_id", c.configId);
  else url.searchParams.set("scope", [...META_SCOPES, ...(opts.publish ? ["pages_manage_posts", "instagram_content_publish"] : [])].join(","));
  url.searchParams.set("auth_type", "rerequest"); // lets people re-grant permissions they declined earlier
  return url.toString();
}

type TokenResponse = { access_token: string; token_type?: string; expires_in?: number };

/** Code → short-lived user token → long-lived user token (~60 days). The app secret is only used server-side. */
export async function exchangeCode(code: string) {
  const c = metaConfig();
  const short = await fetch(graphUrl("oauth/access_token", { client_id: c.appId, client_secret: c.appSecret, redirect_uri: c.redirectUri, code }), { cache: "no-store" });
  const shortBody = await short.json();
  if (!short.ok || shortBody.error) throw new Error(shortBody.error?.message ?? "Meta did not accept the authorization code.");
  const long = await fetch(
    graphUrl("oauth/access_token", { grant_type: "fb_exchange_token", client_id: c.appId, client_secret: c.appSecret, fb_exchange_token: (shortBody as TokenResponse).access_token }),
    { cache: "no-store" },
  );
  const longBody = await long.json();
  if (!long.ok || longBody.error) throw new Error(longBody.error?.message ?? "Could not obtain a long-lived token.");
  const t = longBody as TokenResponse;
  return { token: t.access_token, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null };
}

export async function getMetaUser(userToken: string) {
  const [me, perms] = await Promise.all([
    graphGet<{ id: string; name: string }>("me", { fields: "id,name" }, userToken),
    graphGet<{ data: { permission: string; status: "granted" | "declined" | "expired" }[] }>("me/permissions", {}, userToken),
  ]);
  return {
    id: me.id,
    name: me.name,
    granted: perms.data.filter((p) => p.status === "granted").map((p) => p.permission),
    declined: perms.data.filter((p) => p.status !== "granted").map((p) => p.permission),
  };
}

export type ManagedPage = {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string };
};

/** Pages the person manages, each with its Page token and linked Instagram professional account (if any). */
export async function listManagedPages(userToken: string): Promise<ManagedPage[]> {
  const pages: ManagedPage[] = [];
  let after: string | undefined;
  for (let k = 0; k < 10; k++) {
    const res = await graphGet<{ data: ManagedPage[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      "me/accounts",
      { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: 100, after },
      userToken,
    );
    pages.push(...res.data);
    if (!res.paging?.next) break;
    after = res.paging.cursors?.after;
  }
  return pages;
}
