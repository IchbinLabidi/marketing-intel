import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { captionHook, facebookFormat, facebookSyncFields, instagramFormat, instagramSyncFields, parseInsights } from "@/lib/meta/normalize";
import { computePerformance, detectCtas, engagementOf, engagementRate, type PerfItem } from "@/lib/history/performance";

beforeAll(() => {
  process.env.META_APP_ID = "123";
  process.env.META_APP_SECRET = "app-secret";
  process.env.META_TOKEN_ENCRYPTION_KEY = "a-long-random-key-for-tests";
  process.env.APP_URL = "https://app.example.test";
});
afterEach(() => vi.unstubAllGlobals());

describe("Meta → historical item mapping", () => {
  it("parses insights in both response shapes and by-type objects", () => {
    expect(parseInsights({ data: [
      { name: "reach", values: [{ value: 120 }] },
      { name: "views", total_value: { value: 300 } },
      { name: "post_reactions_by_type_total", values: [{ value: { like: 3, love: 2 } }] },
      { name: "broken", values: [{ value: "n/a" }] },
    ] })).toEqual({ reach: 120, views: 300, post_reactions_by_type_total: 5 });
  });

  it("maps Instagram media and keeps raw API names", () => {
    const row = instagramSyncFields(
      { id: "1", caption: "5 astuces pour réviser 📚\nInscris-toi : lien en bio", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: "2025-03-02T10:00:00+0000", like_count: 40, comments_count: 4, permalink: "https://instagram.com/p/x" },
      { reach: 900, saved: 12, total_interactions: 60, views: 1500 },
    );
    expect(row).toMatchObject({ format: "Carousel", actual_publication_date: "2025-03-02", likes: 40, comments: 4, saves: 12, reach: 900, views: 1500, engagements: 60 });
    expect(row.metrics_raw).toEqual({ reach: 900, saved: 12, total_interactions: 60, views: 1500, likes: 40, comments: 4 });
    expect(row.shares).toBeUndefined(); // not returned → not set
  });

  it("maps Facebook posts without inventing missing metrics", () => {
    const row = facebookSyncFields(
      { id: "p_1", message: "Horaires pendant Ramadan", created_time: "2025-03-06T09:00:00+0000", attachments: { data: [{ media_type: "photo" }] }, reactions: { summary: { total_count: 25 } }, comments: { summary: { total_count: 3 } } },
      { post_media_view: 1200, post_total_media_view_unique: 700 },
    );
    expect(row).toMatchObject({ format: "Image post", likes: 25, comments: 3, shares: null, views: 1200, reach: 700 });
    expect(row.metrics_raw).not.toHaveProperty("shares");
  });

  it("derives formats and hooks", () => {
    expect(instagramFormat({ media_type: "VIDEO", media_product_type: "REELS" })).toBe("Reel");
    expect(facebookFormat({ attachments: { data: [{ media_type: "video" }] } })).toBe("Video");
    expect(facebookFormat({})).toBe("Text post");
    expect(captionHook("Tu bloques en maths ? Voici la méthode.\nDétails…")).toBe("Tu bloques en maths ?");
    expect(captionHook("")).toBeNull();
  });
});

describe("token security", () => {
  it("encrypts tokens with authenticated encryption", async () => {
    const { encryptToken, decryptToken } = await import("@/server/meta/crypto");
    const enc = encryptToken("EAAG-secret-token", "k1");
    expect(enc).not.toContain("EAAG");
    expect(decryptToken(enc, "k1")).toBe("EAAG-secret-token");
    expect(() => decryptToken(enc, "wrong-key")).toThrow();
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(() => decryptToken(tampered, "k1")).toThrow();
  });

  it("verifies Meta signed requests", async () => {
    const { parseSignedRequest } = await import("@/server/meta/crypto");
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "42" })).toString("base64url");
    const sig = createHmac("sha256", "app-secret").update(payload).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payload}`, "app-secret")?.user_id).toBe("42");
    expect(parseSignedRequest(`${sig}.${payload}`, "other-secret")).toBeNull();
    expect(parseSignedRequest("garbage", "app-secret")).toBeNull();
  });

  it("builds the official login URL with read-only scopes and a state", async () => {
    const { buildAuthUrl } = await import("@/server/meta/oauth");
    const url = new URL(buildAuthUrl("STATE123"));
    expect(url.host).toBe("www.facebook.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.test/api/meta/callback");
    expect(url.searchParams.get("state")).toBe("STATE123");
    expect(url.searchParams.get("scope")?.split(",")).toEqual(expect.arrayContaining(["pages_read_engagement", "pages_read_user_content", "read_insights", "instagram_manage_insights"]));
    expect(url.searchParams.get("scope")).not.toMatch(/publish|manage_posts|ads_management/);
  });
});

describe("Graph API client", () => {
  it("classifies errors and signs calls with appsecret_proof", async () => {
    const { graphGet, MetaApiError } = await import("@/server/meta/graph");
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ error: { message: "Session expired", code: 190, error_subcode: 463 } }), { status: 400 });
    }));
    const err = (await graphGet("me", {}, "TOKEN").catch((e: unknown) => e)) as InstanceType<typeof MetaApiError>;
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.isTokenError).toBe(true);
    expect(new MetaApiError("x", 17, undefined, 400).isRateLimit).toBe(true);
    expect(new URL(seen[0]).searchParams.get("appsecret_proof")).toBe(createHmac("sha256", "app-secret").update("TOKEN").digest("hex"));
  });

  it("paginates and reports truncation", async () => {
    const { graphPaginate } = await import("@/server/meta/graph");
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      const after = new URL(url).searchParams.get("after");
      const page = after ? [{ id: "3" }, { id: "4" }] : [{ id: "1" }, { id: "2" }];
      const next = after ? undefined : "https://graph.facebook.com/v26.0/x/posts?after=c2";
      return new Response(JSON.stringify({ data: page, paging: { next } }));
    }));
    expect((await graphPaginate<{ id: string }>("x/posts", {}, "T", { max: 10 })).items.map((i) => i.id)).toEqual(["1", "2", "3", "4"]);
    const capped = await graphPaginate<{ id: string }>("x/posts", {}, "T", { max: 3 });
    expect(capped).toMatchObject({ truncated: true });
    expect(capped.items).toHaveLength(3);
  });

  it("learns which insight metrics an account rejects and still reads the rest", async () => {
    const { fetchInsights } = await import("@/server/meta/sync");
    // Simulated Graph batch endpoint: "views" is not available for this account; every other metric works.
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      const batch = JSON.parse(new URLSearchParams(String(init?.body)).get("batch")!) as { relative_url: string }[];
      return new Response(JSON.stringify(batch.map((b) => {
        const metrics = new URL(`https://x/${b.relative_url}`).searchParams.get("metric")!.split(",");
        if (metrics.includes("views")) return { code: 400, body: JSON.stringify({ error: { code: 100, message: "(#100) metric[0] must be one of the following values" } }) };
        return { code: 200, body: JSON.stringify({ data: metrics.map((m, k) => ({ name: m, values: [{ value: 10 + k }] })) }) };
      })));
    }));
    const supported = {};
    const counter = { calls: 0 };
    const out = await fetchInsights("instagram", [
      { id: "m1", media_product_type: "FEED", timestamp: "2025-01-01" },
      { id: "m2", media_product_type: "FEED", timestamp: "2025-01-02" },
    ], "TOKEN", supported, counter);
    expect(supported).toMatchObject({ instagram_FEED: { rejected: ["views"] } });
    expect(out.get("m1")).toMatchObject({ reach: 10, likes: 11 });
    expect(out.get("m1")).not.toHaveProperty("views");
    expect(counter.calls).toBe(3); // first batch, one probe batch, retry batch

    const again = { ...supported } as Record<string, { ok: string[]; rejected: string[] }>;
    await fetchInsights("instagram", [{ id: "m3", media_product_type: "FEED", timestamp: "2025-01-03" }], "TOKEN", again, counter);
    expect(counter.calls).toBe(4); // learned: no probing the second time
  });
});

const post = (id: string, platform: "instagram" | "facebook", m: Partial<PerfItem>): PerfItem => ({
  id, platform, format: "Reel", title: `Post ${id}`, topic: null, caption: null, pillar_id: null, content_pillar: null, publication_date: "2025-01-10",
  actual_publication_date: null, likes: null, comments: null, shares: null, saves: null, reach: null, views: null, engagements: null, permalink: null,
  source: "meta_api", pillar_assigned_by: null, ...m,
});

describe("performance analytics", () => {
  it("calculates engagement only from returned counts", () => {
    expect(engagementOf({ likes: 10, comments: 2, shares: null, saves: 3 })).toBe(15);
    expect(engagementOf({ likes: null, comments: null, shares: null, saves: null })).toBeNull();
    expect(engagementRate({ likes: 10, comments: 0, shares: 0, saves: 0, reach: 200 })).toBe(5);
    expect(engagementRate({ likes: 10, comments: 0, shares: 0, saves: 0, reach: null })).toBeNull();
    // real case from a synced account: reach 44 with 253 likes is truncated data, not a 670% rate
    expect(engagementRate({ likes: 253, comments: 0, shares: 0, saves: 42, reach: 44 })).toBeNull();
  });

  it("ranks per platform by engagement rate and groups formats with n ≥ 3", () => {
    const items = [
      ...[1, 2, 3].map((k) => post(`r${k}`, "instagram", { format: "Reel", likes: 90, comments: 10, reach: 1000, caption: "Tu veux réussir ? Inscris-toi, lien en bio" })),
      ...[1, 2, 3].map((k) => post(`c${k}`, "instagram", { format: "Carousel", likes: 20, comments: 0, reach: 1000, caption: "Notre méthode" })),
      ...[1, 2, 3].map((k) => post(`f${k}`, "facebook", { format: "Image post", likes: 500, comments: 50 })),
      post("x", "instagram", { format: "Story" }), // no counts: excluded
    ];
    const perf = computePerformance(items, () => undefined);
    const ig = perf.find((p) => p.platform === "instagram")!;
    expect(ig.metric).toBe("engagement_rate");
    expect(ig.top[0].id).toMatch(/^r/);
    expect(ig.byFormat.map((g) => g.key)).toEqual(["Short video", "Carousel"]);
    expect(ig.ctas.find((c) => c.label === "Link / bio")?.n).toBe(3);
    expect(ig.hooks.patterns.find((h) => h.label === "Question")?.n).toBe(3);
    const fb = perf.find((p) => p.platform === "facebook")!;
    expect(fb.metric).toBe("engagement"); // no reach → raw engagement, never compared with Instagram
  });

  it("detects CTA families in fr/en", () => {
    expect(detectCtas("Réserve ta séance ! Lien en bio")).toEqual(["Link / bio", "Sign up / book"]);
    expect(detectCtas("Partage avec un ami et commente")).toEqual(["Comment", "Share / tag"]);
    expect(detectCtas(null)).toEqual([]);
  });
});
