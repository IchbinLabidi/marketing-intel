import "server-only";
import { normalizeTikTokVideo, num, type NormalizedPost, type TikTokVideo } from "@/lib/social/normalize";
import { oauthConfig, redirectUri } from "../config";
import { form, requestJson, SocialApiError, type Counter } from "../http";
import { expiresAt, type Access, type SocialProviderClient, type TokenSet } from "../types";

// TikTok Login Kit + Display API v2 (official). The app must be approved by TikTok for these scopes; until then
// only accounts added as sandbox testers can authorize it.
const API = "https://open.tiktokapis.com/v2";
// TikTok answers HTTP 200 with error.code = "ok" on success.
const ok = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code === undefined || (body as { error?: { code?: string } }).error?.code === "ok";

const USER_FIELDS = "open_id,avatar_url,display_name,username,profile_deep_link,follower_count,following_count,likes_count,video_count";
const VIDEO_FIELDS = "id,title,video_description,create_time,share_url,duration,view_count,like_count,comment_count,share_count";

type User = { open_id: string; avatar_url?: string; display_name?: string; username?: string; profile_deep_link?: string; follower_count?: number; likes_count?: number; video_count?: number };

async function tokenRequest(data: Record<string, string>): Promise<TokenSet> {
  const body = await requestJson<{ access_token?: string; expires_in?: number; refresh_token?: string; refresh_expires_in?: number; scope?: string; error?: string; error_description?: string }>(
    "TikTok", `${API}/oauth/token/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data) },
    undefined, (b) => Boolean((b as { access_token?: string })?.access_token),
  );
  return { access: body.access_token!, refresh: body.refresh_token ?? null, expiresAt: expiresAt(body.expires_in), refreshExpiresAt: expiresAt(body.refresh_expires_in), scopes: body.scope?.split(",").filter(Boolean) ?? [] };
}

async function getUser(token: string, counter?: Counter) {
  const res = await requestJson<{ data?: { user?: User } }>("TikTok", `${API}/user/info/?fields=${USER_FIELDS}`, { headers: { Authorization: `Bearer ${token}` } }, counter, ok);
  if (!res.data?.user?.open_id) throw new SocialApiError("TikTok did not return the account.", 502, "TikTok", "server");
  return res.data.user;
}

export const tiktok: SocialProviderClient = {
  provider: "tiktok",
  label: "TikTok",
  authUrl(state) {
    const c = oauthConfig("tiktok");
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = form({ client_key: c.clientId, scope: c.scopes.join(","), response_type: "code", redirect_uri: redirectUri("tiktok"), state });
    return url.toString();
  },
  exchange(code) {
    const c = oauthConfig("tiktok");
    return tokenRequest({ client_key: c.clientId, client_secret: c.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri("tiktok") });
  },
  refresh(refreshToken) {
    const c = oauthConfig("tiktok");
    return tokenRequest({ client_key: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
  },
  async revoke(token) {
    const c = oauthConfig("tiktok");
    await requestJson("TikTok", `${API}/oauth/revoke/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_key: c.clientId, client_secret: c.clientSecret, token }) }).catch(() => undefined);
  },
  async accounts(token) {
    const u = await getUser(token);
    return [{ externalId: u.open_id, name: u.display_name ?? null, handle: u.username ? `@${u.username}` : null, url: u.profile_deep_link ?? (u.username ? `https://www.tiktok.com/@${u.username}` : null), avatar: u.avatar_url ?? null }];
  },
  async profile(_account, access: Access, counter) {
    if (!access.token) throw new SocialApiError("TikTok needs an authorized connection.", 401, "TikTok", "auth");
    const u = await getUser(access.token, counter);
    return { followers: num(u.follower_count), totalViews: null, totalPosts: num(u.video_count), raw: { likes_count: u.likes_count ?? null } };
  },
  async *posts(_account, access, { since, max, counter }) {
    if (!access.token) throw new SocialApiError("TikTok needs an authorized connection.", 401, "TikTok", "auth");
    let cursor: number | undefined;
    let seen = 0;
    for (;;) {
      const res = await requestJson<{ data?: { videos?: TikTokVideo[]; cursor?: number; has_more?: boolean } }>(
        "TikTok", `${API}/video/list/?fields=${VIDEO_FIELDS}`,
        { method: "POST", headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) },
        counter, ok,
      );
      const items = res.data?.videos ?? [];
      const fresh = since ? items.filter((v) => (v.create_time ?? 0) * 1000 >= since.getTime()) : items;
      const posts = fresh.map(normalizeTikTokVideo).filter((p): p is NormalizedPost => Boolean(p));
      if (posts.length) yield posts;
      seen += posts.length;
      if (!res.data?.has_more || fresh.length < items.length || seen >= max || !res.data.cursor) return;
      cursor = res.data.cursor;
    }
  },
};
