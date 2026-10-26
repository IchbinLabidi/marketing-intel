import "server-only";
import { graphGet, MetaApiError, type GraphCounter } from "@/server/meta/graph";
import { num, ProviderError, type CollectedPost, type DataProvider } from "./types";

// Instagram: official Business Discovery API. The project's connected Instagram professional account reads another
// professional (business/creator) account's public profile and media, with like and comment counts when the owner
// hasn't hidden them. Personal accounts can't be read. Views, shares and saves are not exposed for other accounts.
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery

type BDMedia = {
  id: string; caption?: string; like_count?: number; comments_count?: number; timestamp?: string; media_type?: string;
  media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string;
};
type BDResponse = {
  business_discovery?: {
    id: string; username: string; name?: string; biography?: string; website?: string; followers_count?: number; media_count?: number;
    profile_picture_url?: string;
    media?: { data: BDMedia[]; paging?: { cursors?: { after?: string }; next?: string } };
  };
};

const MEDIA_FIELDS = "id,caption,like_count,comments_count,timestamp,media_type,media_product_type,media_url,thumbnail_url,permalink";
const PAGE = 50;

function igFormat(m: BDMedia) {
  if (m.media_product_type === "REELS") return "Reel";
  if (m.media_product_type === "STORY") return "Story";
  if (m.media_type === "CAROUSEL_ALBUM") return "Carousel";
  if (m.media_type === "VIDEO") return "Video";
  if (m.media_type === "IMAGE") return "Image post";
  return null;
}

function explain(e: unknown): never {
  if (e instanceof MetaApiError) {
    if (e.isTokenError) throw new ProviderError("The Meta connection expired. Reconnect Meta in Historical Intelligence.", "needs_config");
    if (e.isRateLimit) throw new ProviderError(`Meta rate limit reached (code ${e.code}: ${e.message}). Meta lifts it within about an hour; collect again later.`, "failed", true);
    if (e.code === 110 || /business|creator|user/i.test(e.message)) {
      throw new ProviderError("Instagram only exposes public Business or Creator accounts through its API. This account is personal, private or the username is wrong.");
    }
    if (e.isPermissionError) throw new ProviderError(`Meta refused access: ${e.message}`, "needs_config");
    throw new ProviderError(`Meta API: ${e.message}`);
  }
  throw e instanceof Error ? new ProviderError(e.message) : new ProviderError("Unknown Meta error");
}

export const instagramProvider: DataProvider = {
  id: "meta-business-discovery",
  label: "Meta · Instagram Business Discovery",
  platform: "instagram",
  source: "meta_api",
  availability(creds) {
    if (!creds.meta) return { ok: false, status: "needs_config", reason: "Connect Meta (Facebook Page + Instagram professional account) in Historical Intelligence." };
    if (!creds.meta.igUserId) return { ok: false, status: "needs_config", reason: "The connected Facebook Page has no linked Instagram professional account." };
    return { ok: true };
  },
  async collect(channel, { since, max }, creds) {
    const meta = creds.meta!;
    const counter: GraphCounter = { calls: 0 };
    const username = channel.handle.replace(/[^A-Za-z0-9._]/g, "");
    const posts: CollectedPost[] = [];
    let profile: NonNullable<BDResponse["business_discovery"]> | null = null;
    let after: string | undefined;
    let truncated = false;
    try {
      for (;;) {
        const mediaPart = `media${after ? `.after(${after})` : ""}.limit(${PAGE}){${MEDIA_FIELDS}}`;
        const fields = `business_discovery.username(${username}){id,username,name,biography,website,followers_count,media_count,profile_picture_url,${mediaPart}}`;
        const r = await graphGet<BDResponse>(meta.igUserId!, { fields }, meta.pageToken, counter);
        const bd = r.business_discovery;
        if (!bd) throw new ProviderError("Instagram returned no profile for this username.");
        profile ??= bd;
        const data = bd.media?.data ?? [];
        let reachedWindowStart = false;
        for (const m of data) {
          if (m.timestamp && new Date(m.timestamp) < since) { reachedWindowStart = true; break; }
          posts.push({
            external_id: m.id,
            url: m.permalink ?? null,
            published_at: m.timestamp ? new Date(m.timestamp).toISOString() : null,
            caption: m.caption ?? null,
            format: igFormat(m),
            media_type: m.media_product_type && m.media_product_type !== "FEED" ? m.media_product_type : m.media_type ?? null,
            // media_url is a short-lived CDN link; it is kept for previews and refreshed on every collection
            media_url: m.media_type === "VIDEO" ? null : m.media_url ?? null,
            thumbnail_url: m.thumbnail_url ?? (m.media_type === "VIDEO" ? null : m.media_url ?? null),
            likes: num(m.like_count),
            comments: num(m.comments_count),
            shares: null, views: null, saves: null, duration_seconds: null,
            metrics_raw: Object.fromEntries(Object.entries({ like_count: num(m.like_count), comments_count: num(m.comments_count) }).filter(([, v]) => v != null)) as Record<string, number>,
          });
          if (posts.length >= max) break;
        }
        after = bd.media?.paging?.cursors?.after;
        if (posts.length >= max) { truncated = Boolean(after) || data.length > posts.length; break; }
        if (reachedWindowStart || !after || !data.length) break;
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      explain(e);
    }
    return {
      profile: {
        external_id: profile!.id, display_name: profile!.name ?? profile!.username, bio: profile!.biography ?? null,
        followers_count: num(profile!.followers_count), media_count: num(profile!.media_count),
        profile_image_url: profile!.profile_picture_url ?? null, website: profile!.website ?? null,
      },
      posts,
      truncated,
      notes: [
        "Likes and comments as shown publicly (hidden like counts come back empty). Views, shares, saves and reach are not available for other accounts.",
        ...(posts.some((p) => p.likes == null) ? ["Some posts hide their like count."] : []),
      ],
      calls: counter.calls,
    };
  },
};

// Facebook Pages you don't manage: Meta returns public Page metadata and posts only to apps approved for the
// "Page Public Content Access" feature (App Review). Without it the API answers with a permission error, shown as is.
type FBPage = { id: string; name?: string; about?: string; fan_count?: number; followers_count?: number; website?: string; picture?: { data?: { url?: string } } };
type FBPost = {
  id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string; status_type?: string;
  shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } };
  attachments?: { data?: { media_type?: string; type?: string }[] };
};

export const facebookProvider: DataProvider = {
  id: "meta-page-public-content",
  label: "Meta · Page Public Content Access",
  platform: "facebook",
  source: "meta_api",
  availability(creds) {
    if (!creds.meta) return { ok: false, status: "needs_config", reason: "Connect Meta in Historical Intelligence." };
    // Without the App Review feature every request is refused, so it is only attempted once the approval is declared
    if (process.env.META_PAGE_PUBLIC_CONTENT_ACCESS !== "true") {
      return { ok: false, status: "needs_config", reason: "Meta only shares other Pages' posts with apps approved for “Page Public Content Access” (Meta app → App Review → Permissions and Features). Once approved, set META_PAGE_PUBLIC_CONTENT_ACCESS=true in .env.local." };
    }
    return { ok: true };
  },
  async collect(channel, { since, max }, creds) {
    const token = creds.meta!.pageToken;
    const counter: GraphCounter = { calls: 0 };
    let page: FBPage;
    try {
      page = await graphGet<FBPage>(channel.external_id ?? channel.handle, { fields: "id,name,about,fan_count,followers_count,website,picture{url}" }, token, counter);
    } catch (e) {
      if (e instanceof MetaApiError && (e.isPermissionError || e.code === 100)) {
        throw new ProviderError(
          "Meta only shares other Pages' content with apps approved for “Page Public Content Access”. Request it in App Review (Meta app → App Review → Permissions and Features), then collect again.",
          "needs_config",
        );
      }
      explain(e);
    }
    const posts: CollectedPost[] = [];
    let truncated = false;
    try {
      let url: string | undefined;
      let path = `${page.id}/posts`;
      let params: Record<string, string | number | undefined> = {
        fields: "id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{media_type,type}",
        since: Math.floor(since.getTime() / 1000), limit: 50,
      };
      for (;;) {
        const r: { data: FBPost[]; paging?: { next?: string } } = await graphGet(url ?? path, url ? {} : params, token, counter);
        for (const p of r.data ?? []) {
          const type = p.attachments?.data?.[0]?.media_type ?? p.attachments?.data?.[0]?.type ?? null;
          posts.push({
            external_id: p.id, url: p.permalink_url ?? null, published_at: p.created_time ? new Date(p.created_time).toISOString() : null,
            caption: p.message ?? null,
            format: type === "video" ? "Video" : type === "album" ? "Carousel" : type === "photo" ? "Image post" : p.message ? "Text post" : null,
            media_type: type, media_url: p.full_picture ?? null, thumbnail_url: p.full_picture ?? null,
            likes: num(p.reactions?.summary?.total_count), comments: num(p.comments?.summary?.total_count), shares: num(p.shares?.count) ?? (p.shares ? null : 0),
            views: null, saves: null, duration_seconds: null,
            metrics_raw: Object.fromEntries(Object.entries({ reactions: num(p.reactions?.summary?.total_count), comments: num(p.comments?.summary?.total_count), shares: num(p.shares?.count) }).filter(([, v]) => v != null)) as Record<string, number>,
          });
          if (posts.length >= max) break;
        }
        if (posts.length >= max) { truncated = Boolean(r.paging?.next); break; }
        const next = r.paging?.next;
        if (!next || new URL(next).host !== "graph.facebook.com") break;
        url = next; path = next; params = {};
      }
    } catch (e) {
      if (e instanceof MetaApiError && e.isPermissionError) {
        throw new ProviderError("Meta returned the Page profile but not its posts: “Page Public Content Access” (App Review) is required.", "needs_config");
      }
      explain(e);
    }
    return {
      profile: {
        external_id: page.id, display_name: page.name ?? null, bio: page.about ?? null,
        followers_count: num(page.followers_count) ?? num(page.fan_count), media_count: null,
        profile_image_url: page.picture?.data?.url ?? null, website: page.website ?? null,
      },
      posts, truncated, notes: ["Reactions (likes), comments and shares as reported by Meta. Views and reach are not available for other Pages."], calls: counter.calls,
    };
  },
};
