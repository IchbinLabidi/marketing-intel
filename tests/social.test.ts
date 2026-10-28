import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  externalIdFromUrl, isoDurationSeconds, normalizeLinkedInPost, normalizeTikTokVideo, normalizeYouTubeVideo, toHistoricalRow, youtubeAnalyticsByVideo,
} from "@/lib/social/normalize";
import { audienceGrowth, social, socialWeekly } from "@/lib/analytics/compute";
import { classify, requestJson, SocialApiError } from "@/server/social/http";
import { parseChannelInput, youtube } from "@/server/social/providers/youtube";
import { linkedin } from "@/server/social/providers/linkedin";
import { tiktok } from "@/server/social/providers/tiktok";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("normalization", () => {
  it("keeps unavailable metrics null and real zeros as zero (YouTube)", () => {
    const p = normalizeYouTubeVideo({ id: "abc", snippet: { title: " Hello ", publishedAt: "2026-10-01T10:00:00Z" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "120", likeCount: "0" } })!;
    expect(p.metrics.views).toBe(120);
    expect(p.metrics.likes).toBe(0);
    expect(p.metrics.comments).toBeNull(); // hidden comments: not returned
    expect(p.metrics.watch_time_minutes).toBeNull(); // public data only
    expect(p.format).toBe("YouTube Short (≤60 s)");
    expect(p.permalink).toBe("https://www.youtube.com/watch?v=abc");
  });

  it("adds Analytics API figures only when authorized", () => {
    const report = { columnHeaders: [{ name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "shares" }], rows: [["abc", 130, 55.5, 3]] };
    const a = youtubeAnalyticsByVideo(report).get("abc")!;
    const p = normalizeYouTubeVideo({ id: "abc", snippet: { publishedAt: "2026-10-01T10:00:00Z" }, contentDetails: { duration: "PT3M" }, statistics: { viewCount: "120" } }, a)!;
    expect(p.metrics.watch_time_minutes).toBe(55.5);
    expect(p.metrics.shares).toBe(3);
    expect(p.format).toBe("YouTube video");
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
  });

  it("maps LinkedIn statistics with LinkedIn's own definitions and skips drafts", () => {
    const p = normalizeLinkedInPost({ id: "urn:li:share:1", commentary: "Line one\nmore", publishedAt: 1_790_000_000_000, content: { multiImage: {} } }, { impressionCount: 900, uniqueImpressionsCount: 600, clickCount: 12, likeCount: 30, commentCount: 0, shareCount: 2 })!;
    expect(p.metrics).toMatchObject({ impressions: 900, reach: 600, clicks: 12, likes: 30, comments: 0, shares: 2, views: null });
    expect(p.title).toBe("Line one");
    expect(p.format).toBe("LinkedIn carousel");
    expect(normalizeLinkedInPost({ id: "urn:li:share:2", publishedAt: 1, lifecycleState: "DRAFT" })).toBeNull();
    expect(normalizeLinkedInPost({ id: "urn:li:share:3", publishedAt: 1 }, null)!.metrics.impressions).toBeNull();
  });

  it("maps TikTok videos", () => {
    const p = normalizeTikTokVideo({ id: "7", create_time: 1_790_000_000, share_url: "https://www.tiktok.com/@a/video/7", view_count: 50, like_count: 5, comment_count: 1, share_count: 0 })!;
    expect(p.metrics).toMatchObject({ views: 50, video_views: 50, likes: 5, comments: 1, shares: 0, reach: null });
    expect(p.published_at).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it("builds a stable storage row in the project's time zone without user-edited fields", () => {
    const p = normalizeTikTokVideo({ id: "7", create_time: Date.parse("2026-10-01T23:30:00Z") / 1000, view_count: 1 })!;
    const row = toHistoricalRow(p, { projectId: "p", connectionId: "c", tz: "Africa/Tunis", now: "2026-10-02T00:00:00Z" });
    expect(row).toMatchObject({ source: "tiktok_api", external_id: "7", publication_date: "2026-10-02", social_connection_id: "c" });
    expect(row).not.toHaveProperty("pillar_id");
    expect(row).not.toHaveProperty("funnel_stage");
  });

  it("extracts provider post ids from links for exact calendar matching", () => {
    expect(externalIdFromUrl("https://youtu.be/AbC123xyz")).toEqual({ provider: "youtube", id: "AbC123xyz" });
    expect(externalIdFromUrl("https://www.youtube.com/shorts/AbC123xyz?feature=share")).toEqual({ provider: "youtube", id: "AbC123xyz" });
    expect(externalIdFromUrl("https://www.linkedin.com/feed/update/urn:li:share:7123/")).toEqual({ provider: "linkedin", id: "urn:li:share:7123" });
    expect(externalIdFromUrl("https://www.tiktok.com/@brand/video/7300000000000000000")).toEqual({ provider: "tiktok", id: "7300000000000000000" });
    expect(externalIdFromUrl("https://example.com/watch?v=1")).toBeNull();
  });

  it("parses YouTube channel inputs", () => {
    expect(parseChannelInput("https://www.youtube.com/@elios.academy")).toEqual({ handle: "@elios.academy" });
    expect(parseChannelInput("UC1234567890123456789012")).toEqual({ id: "UC1234567890123456789012" });
    expect(parseChannelInput("https://example.com/@x")).toBeNull();
  });
});

describe("HTTP handling", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout"] }));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("classifies auth, permission and rate-limit errors", () => {
    expect(classify(401, {})).toBe("auth");
    expect(classify(200, { error: { code: "access_token_invalid" } })).toBe("auth");
    expect(classify(403, { error: { code: "scope_not_authorized" } })).toBe("permission");
    expect(classify(429, {})).toBe("rate_limit");
    expect(classify(503, {})).toBe("server");
  });

  it("retries rate limits with Retry-After, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "slow down" }, 429, { "retry-after": "2" })).mockResolvedValueOnce(json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = requestJson<{ ok: number }>("Test", "https://x.test/a");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an expired token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { message: "expired" } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestJson("Test", "https://x.test/a")).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats TikTok's error.code other than ok as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: {}, error: { code: "scope_not_authorized", message: "no scope" } })));
    await expect(requestJson("TikTok", "https://x.test", {}, undefined, (b) => (b as { error?: { code?: string } }).error?.code === "ok")).rejects.toBeInstanceOf(SocialApiError);
  });
});

describe("provider pagination", () => {
  afterEach(() => vi.unstubAllGlobals());
  const collect = async <T,>(g: AsyncGenerator<T[]>) => { const out: T[] = []; for await (const page of g) out.push(...page); return out; };

  it("YouTube (public data): pages through uploads and stops at the incremental boundary", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      expect(u.searchParams.get("key")).toBe("test-key");
      if (u.pathname.endsWith("/playlistItems")) {
        return u.searchParams.get("pageToken")
          ? json({ items: [{ contentDetails: { videoId: "v3", videoPublishedAt: "2026-08-01T00:00:00Z" } }], nextPageToken: "p3" })
          : json({ items: [{ contentDetails: { videoId: "v1", videoPublishedAt: "2026-10-10T00:00:00Z" } }, { contentDetails: { videoId: "v2", videoPublishedAt: "2026-10-01T00:00:00Z" } }], nextPageToken: "p2" });
      }
      const ids = u.searchParams.get("id")!.split(",");
      return json({ items: ids.map((id) => ({ id, snippet: { title: id, publishedAt: id === "v3" ? "2026-08-01T00:00:00Z" : "2026-10-05T00:00:00Z" }, contentDetails: { duration: "PT5M" }, statistics: { viewCount: "10" } })) });
    }));
    const account = { externalId: "UC1234567890123456789012", name: null, handle: null, url: null, avatar: null };
    const posts = await collect(youtube.posts(account, { token: null, scopes: [] }, { since: new Date("2026-09-01T00:00:00Z"), max: 100 }));
    expect(posts.map((p) => p.external_id)).toEqual(["v1", "v2"]); // v3 is older than `since`: not fetched
    expect(calls.some((c) => c.includes("UU1234567890123456789012"))).toBe(true);
    expect(calls.some((c) => c.includes("youtubeanalytics"))).toBe(false); // no OAuth → no analytics call
  });

  it("LinkedIn: requests statistics for the page's posts and keeps posts when statistics are refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["LinkedIn-Version"]).toMatch(/^\d{6}$/);
      if (url.includes("/posts?")) return json({ elements: [{ id: "urn:li:share:1", commentary: "A", publishedAt: Date.parse("2026-10-02T00:00:00Z") }], paging: { total: 1 } });
      return json({ message: "Not enough permissions" }, 403);
    }));
    const posts = await collect(linkedin.posts({ externalId: "urn:li:organization:5", name: null, handle: null, url: null, avatar: null }, { token: "t", scopes: [] }, { since: null, max: 100 }));
    expect(posts).toHaveLength(1);
    expect(posts[0].metrics.impressions).toBeNull();
  });

  it("TikTok: follows the cursor until has_more is false", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      n++;
      return body.cursor
        ? json({ data: { videos: [{ id: "2", create_time: 1_790_000_000, view_count: 1 }], has_more: false }, error: { code: "ok" } })
        : json({ data: { videos: [{ id: "1", create_time: 1_790_100_000, view_count: 2 }], cursor: 123, has_more: true }, error: { code: "ok" } });
    }));
    const posts = await collect(tiktok.posts({ externalId: "o", name: null, handle: null, url: null, avatar: null }, { token: "t", scopes: [] }, { since: null, max: 100 }));
    expect(posts.map((p) => p.external_id)).toEqual(["1", "2"]);
    expect(n).toBe(2);
  });
});

describe("analytics on synced data", () => {
  const P = { from: "2026-10-01", to: "2026-10-14" };
  const row = (over: Record<string, unknown>) => ({ id: String(Math.random()), title: null, platform: "youtube", format: null, pillar_id: null, campaign_id: null, permalink: null, date: "2026-10-02", reach: null, impressions: null, views: 10, video_views: 10, clicks: null, likes: 1, comments: 0, shares: null, saves: null, conversions: null, leads: null, source: "youtube_api", ...over });

  it("sums watch time only when reported and compares platforms", () => {
    const s = social([row({ watch_time_minutes: 30 }), row({ watch_time_minutes: null }), row({ platform: "tiktok", views: 5, video_views: 5 })], P);
    expect(s.watchTime).toBe(30);
    expect(s.available.watch_time_minutes).toBe(1);
    expect(s.byPlatform.find((r) => r.key === "youtube")).toMatchObject({ posts: 2, views: 20 });
  });

  it("groups interactions per week and platform", () => {
    const w = socialWeekly([row({ date: "2026-10-02", likes: 3 }), row({ date: "2026-10-09", platform: "tiktok", likes: 4 })], P);
    expect(w.weeks).toHaveLength(2);
    expect(w.weeks[0].youtube).toBe(3);
    expect(w.weeks[1].tiktok).toBe(4);
  });

  it("measures audience growth only with two snapshots or more", () => {
    const g = audienceGrowth([
      { connection_id: "a", snapshot_date: "2026-10-01", followers: 100 }, { connection_id: "a", snapshot_date: "2026-10-10", followers: 130 },
      { connection_id: "b", snapshot_date: "2026-10-05", followers: 40 }, { connection_id: "c", snapshot_date: "2026-10-05", followers: null },
    ], P);
    expect(g.find((x) => x.connection_id === "a")).toMatchObject({ start: 100, end: 130, change: 30 });
    expect(g.find((x) => x.connection_id === "b")!.change).toBeNull();
    expect(g.some((x) => x.connection_id === "c")).toBe(false);
  });
});
