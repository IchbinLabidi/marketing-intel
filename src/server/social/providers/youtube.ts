import "server-only";
import { normalizeYouTubeVideo, num, youtubeAnalyticsByVideo, type NormalizedPost, type YouTubeAnalyticsRow, type YouTubeVideo } from "@/lib/social/normalize";
import { oauthConfig, redirectUri, youtubeApiKey } from "../config";
import { form, requestJson, SocialApiError, type Counter } from "../http";
import { expiresAt, type Access, type Account, type SocialProviderClient, type TokenSet } from "../types";

// YouTube Data API v3 + YouTube Analytics API v2 (official). Two ways in:
//  - public: a channel id/handle read with YOUTUBE_API_KEY (views, likes, comments, subscribers when public);
//  - OAuth (Google): the channel owner authorizes read-only access, which adds watch time, shares and subscribers gained.
const API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

type Channel = {
  id: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

function get<T>(path: string, params: Record<string, string>, access: Access, counter?: Counter) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (access.token) headers.Authorization = `Bearer ${access.token}`;
  else {
    const key = youtubeApiKey();
    if (!key) throw new SocialApiError("YOUTUBE_API_KEY is not set.", 0, "YouTube", "other");
    url.searchParams.set("key", key);
  }
  return requestJson<T>("YouTube", url.toString(), { headers }, counter);
}

const toAccount = (c: Channel): Account => ({
  externalId: c.id,
  name: c.snippet?.title ?? null,
  handle: c.snippet?.customUrl ?? null,
  url: c.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
  avatar: c.snippet?.thumbnails?.default?.url ?? null,
});

/** Accepts a channel URL, an @handle or a channel id (UC…). */
export function parseChannelInput(input: string): { id: string } | { handle: string } | null {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if (/^@[\w.-]{3,}$/.test(s)) return { handle: s };
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const ch = u.pathname.match(/^\/channel\/(UC[\w-]{22})/);
    if (ch) return { id: ch[1] };
    const h = u.pathname.match(/^\/(@[\w.-]{3,})/);
    if (h) return { handle: h[1] };
  } catch {
    return null;
  }
  return null;
}

/** Public lookup with the API key (no OAuth). */
export async function findPublicChannel(input: string): Promise<Account | null> {
  const q = parseChannelInput(input);
  if (!q) return null;
  const res = await get<{ items?: Channel[] }>("channels", { part: "snippet", ...("id" in q ? { id: q.id } : { forHandle: q.handle }) }, { token: null, scopes: [] });
  return res.items?.[0] ? toAccount(res.items[0]) : null;
}

async function tokenRequest(data: Record<string, string>): Promise<TokenSet> {
  const body = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
    "Google", "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data) },
  );
  return { access: body.access_token, refresh: body.refresh_token ?? null, expiresAt: expiresAt(body.expires_in), refreshExpiresAt: null, scopes: body.scope?.split(" ") ?? [] };
}

export const youtube: SocialProviderClient = {
  provider: "youtube",
  label: "YouTube",
  authUrl(state, codeChallenge) {
    const c = oauthConfig("youtube");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = form({
      client_id: c.clientId, redirect_uri: redirectUri("youtube"), response_type: "code", scope: c.scopes.join(" "),
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    return url.toString();
  },
  exchange(code, codeVerifier) {
    const c = oauthConfig("youtube");
    return tokenRequest({ grant_type: "authorization_code", code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri("youtube"), code_verifier: codeVerifier });
  },
  refresh(refreshToken) {
    const c = oauthConfig("youtube");
    return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  },
  async revoke(token) {
    await requestJson("Google", "https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token }) }).catch(() => undefined);
  },
  async accounts(token) {
    const res = await get<{ items?: Channel[] }>("channels", { part: "snippet", mine: "true", maxResults: "50" }, { token, scopes: [] });
    return (res.items ?? []).map(toAccount);
  },
  async profile(account, access, counter) {
    const res = await get<{ items?: Channel[] }>("channels", { part: "statistics,contentDetails", id: account.externalId }, access, counter);
    const s = res.items?.[0]?.statistics;
    if (!res.items?.[0]) throw new SocialApiError("The channel was not found. It may have been deleted or made private.", 404, "YouTube", "not_found");
    return {
      followers: s?.hiddenSubscriberCount ? null : num(s?.subscriberCount),
      totalViews: num(s?.viewCount),
      totalPosts: num(s?.videoCount),
      raw: { statistics: s ?? {}, uploads: res.items[0].contentDetails?.relatedPlaylists?.uploads ?? null },
    };
  },
  async *posts(account, access, { since, max, counter }) {
    // The uploads playlist lists every public video, newest first (UC… → UU…).
    const uploads = `UU${account.externalId.slice(2)}`;
    const withAnalytics = Boolean(access.token && access.scopes.includes(ANALYTICS_SCOPE));
    let pageToken: string | undefined;
    let seen = 0;
    for (;;) {
      const page = await get<{ items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[]; nextPageToken?: string }>(
        "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}) }, access, counter,
      );
      const items = (page.items ?? []).filter((i) => i.contentDetails?.videoId);
      const fresh = since ? items.filter((i) => !i.contentDetails?.videoPublishedAt || new Date(i.contentDetails.videoPublishedAt) >= since) : items;
      if (fresh.length) {
        const ids = fresh.map((i) => i.contentDetails!.videoId!);
        const videos = await get<{ items?: YouTubeVideo[] }>("videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: "50" }, access, counter);
        let analytics = new Map<string, YouTubeAnalyticsRow>();
        if (withAnalytics) {
          // Lifetime per-video figures. A refused analytics call doesn't stop the sync; the public counters stay.
          const url = new URL(ANALYTICS);
          url.search = form({
            ids: "channel==MINE", startDate: "2005-02-14", endDate: new Date().toISOString().slice(0, 10),
            metrics: "views,estimatedMinutesWatched,likes,comments,shares,subscribersGained", dimensions: "video", filters: `video==${ids.join(",")}`, maxResults: "50",
          });
          const report = await requestJson<{ columnHeaders?: { name: string }[]; rows?: (string | number)[][] }>("YouTube Analytics", url.toString(), { headers: { Authorization: `Bearer ${access.token}` } }, counter).catch((e) => {
            if (e instanceof SocialApiError && (e.isPermission || e.kind === "other")) return null;
            throw e;
          });
          analytics = youtubeAnalyticsByVideo(report);
        }
        const posts = (videos.items ?? []).map((v) => normalizeYouTubeVideo(v, withAnalytics ? analytics.get(v.id) ?? null : null)).filter((p): p is NormalizedPost => Boolean(p));
        seen += posts.length;
        yield posts;
      }
      if (!page.nextPageToken || fresh.length < items.length || seen >= max) return;
      pageToken = page.nextPageToken;
    }
  },
};
