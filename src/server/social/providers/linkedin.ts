import "server-only";
import { normalizeLinkedInPost, num, type LinkedInPost, type LinkedInShareStats, type NormalizedPost } from "@/lib/social/normalize";
import { oauthConfig, redirectUri } from "../config";
import { form, requestJson, SocialApiError, type Counter } from "../http";
import { expiresAt, type Account, type SocialProviderClient, type TokenSet } from "../types";

// LinkedIn Community Management API (official, versioned REST). Requires a LinkedIn app with the Community
// Management API product approved, and a member who is an ADMINISTRATOR of the organization page.
const REST = "https://api.linkedin.com/rest";
// LinkedIn supports each monthly version for about a year; LINKEDIN_API_VERSION overrides it (format YYYYMM).
const VERSION = process.env.LINKEDIN_API_VERSION || "202509";

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, "LinkedIn-Version": VERSION, "X-Restli-Protocol-Version": "2.0.0" });
const enc = encodeURIComponent;
const orgId = (urn: string) => urn.split(":").pop()!;

function rest<T>(path: string, token: string, counter?: Counter) {
  return requestJson<T>("LinkedIn", `${REST}/${path}`, { headers: headers(token) }, counter);
}

async function tokenRequest(data: Record<string, string>): Promise<TokenSet> {
  const body = await requestJson<{ access_token: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string }>(
    "LinkedIn", "https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data) },
  );
  return {
    access: body.access_token, refresh: body.refresh_token ?? null, expiresAt: expiresAt(body.expires_in),
    refreshExpiresAt: expiresAt(body.refresh_token_expires_in), scopes: body.scope?.split(/[ ,]/).filter(Boolean) ?? [],
  };
}

export const linkedin: SocialProviderClient = {
  provider: "linkedin",
  label: "LinkedIn",
  authUrl(state) {
    const c = oauthConfig("linkedin");
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = form({ response_type: "code", client_id: c.clientId, redirect_uri: redirectUri("linkedin"), state, scope: c.scopes.join(" ") });
    return url.toString();
  },
  exchange(code) {
    const c = oauthConfig("linkedin");
    return tokenRequest({ grant_type: "authorization_code", code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri("linkedin") });
  },
  refresh(refreshToken) {
    // Only apps LinkedIn enabled for programmatic refresh receive refresh tokens; others reconnect every 60 days.
    const c = oauthConfig("linkedin");
    return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  },
  async revoke(token) {
    const c = oauthConfig("linkedin");
    await requestJson("LinkedIn", "https://www.linkedin.com/oauth/v2/revoke", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token, client_id: c.clientId, client_secret: c.clientSecret }),
    }).catch(() => undefined);
  },
  async accounts(token) {
    // Organization pages where the member is an approved administrator.
    const acls = await rest<{ elements?: { organization?: string; organizationTarget?: string }[] }>("organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100", token);
    const urns = [...new Set((acls.elements ?? []).map((e) => e.organization ?? e.organizationTarget).filter((x): x is string => Boolean(x)))];
    const out: Account[] = [];
    for (const urn of urns) {
      const o = await rest<{ localizedName?: string; vanityName?: string }>(`organizations/${orgId(urn)}`, token).catch(() => null);
      out.push({ externalId: urn, name: o?.localizedName ?? null, handle: o?.vanityName ?? null, url: o?.vanityName ? `https://www.linkedin.com/company/${o.vanityName}/` : null, avatar: null });
    }
    return out;
  },
  async profile(account, access, counter) {
    if (!access.token) throw new SocialApiError("LinkedIn needs an authorized connection.", 401, "LinkedIn", "auth");
    const size = await rest<{ firstDegreeSize?: number }>(`networkSizes/${enc(account.externalId)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, access.token, counter).catch((e) => {
      if (e instanceof SocialApiError && (e.isPermission || e.kind === "not_found")) return null;
      throw e;
    });
    return { followers: num(size?.firstDegreeSize), totalViews: null, totalPosts: null, raw: size ? { networkSize: size } : {} };
  },
  async *posts(account, access, { since, max, counter }) {
    if (!access.token) throw new SocialApiError("LinkedIn needs an authorized connection.", 401, "LinkedIn", "auth");
    let start = 0;
    let seen = 0;
    for (;;) {
      const page = await rest<{ elements?: LinkedInPost[]; paging?: { total?: number } }>(
        `posts?author=${enc(account.externalId)}&q=author&count=50&start=${start}&sortBy=CREATED`, access.token, counter,
      );
      const items = page.elements ?? [];
      const fresh = since ? items.filter((p) => (p.publishedAt ?? p.createdAt ?? 0) >= since.getTime()) : items;
      if (fresh.length) {
        // Lifetime statistics for this batch of posts, keyed by share or ugcPost URN.
        const shares = fresh.filter((p) => p.id.startsWith("urn:li:share:")).map((p) => enc(p.id));
        const ugc = fresh.filter((p) => p.id.startsWith("urn:li:ugcPost:")).map((p) => enc(p.id));
        const params = [`q=organizationalEntity`, `organizationalEntity=${enc(account.externalId)}`, shares.length && `shares=List(${shares.join(",")})`, ugc.length && `ugcPosts=List(${ugc.join(",")})`].filter(Boolean).join("&");
        const stats = await rest<{ elements?: { share?: string; ugcPost?: string; totalShareStatistics?: LinkedInShareStats }[] }>(`organizationalEntityShareStatistics?${params}`, access.token, counter).catch((e) => {
          if (e instanceof SocialApiError && e.isPermission) return null; // posts still stored, metrics unavailable
          throw e;
        });
        const byUrn = new Map((stats?.elements ?? []).map((s) => [s.share ?? s.ugcPost ?? "", s.totalShareStatistics ?? null]));
        const posts = fresh.map((p) => normalizeLinkedInPost(p, stats ? byUrn.get(p.id) ?? null : null)).filter((p): p is NormalizedPost => Boolean(p));
        seen += posts.length;
        yield posts;
      }
      start += items.length;
      if (!items.length || fresh.length < items.length || seen >= max || (page.paging?.total != null && start >= page.paging.total)) return;
    }
  },
};
