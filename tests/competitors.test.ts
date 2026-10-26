import { describe, expect, it } from "vitest";
import { hashtagsOf, mentionsOf, normalizeWebsite, parseProfileUrl } from "@/lib/competitors/urls";
import { engagementOfPost, summarize, topicGaps, type AnalysisPost } from "@/lib/competitors/analysis";

const ok = (raw: string) => {
  const r = parseProfileUrl(raw);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
};

describe("profile URLs", () => {
  it("detects the platform and normalises the handle", () => {
    expect(ok("https://www.instagram.com/Elios.Academy/?hl=fr")).toEqual({ platform: "instagram", handle: "elios.academy", url: "https://www.instagram.com/elios.academy/" });
    expect(ok("instagram.com/brand")).toMatchObject({ platform: "instagram", handle: "brand" });
    expect(ok("https://m.facebook.com/EliosAcademy")).toMatchObject({ platform: "facebook", handle: "eliosacademy" });
    expect(ok("https://www.facebook.com/profile.php?id=106379684098845")).toMatchObject({ platform: "facebook", handle: "106379684098845" });
    expect(ok("https://www.tiktok.com/@brand.tn?lang=fr")).toMatchObject({ platform: "tiktok", handle: "brand.tn" });
    expect(ok("https://youtube.com/@Brand")).toMatchObject({ platform: "youtube", handle: "@brand" });
    expect(ok("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw")).toMatchObject({ platform: "youtube", handle: "UC_x5XG1OV2P6uZZ5FSM9Ttw" });
    expect(ok("https://www.linkedin.com/company/brand-sa/about/")).toMatchObject({ platform: "linkedin", handle: "brand-sa" });
    expect(ok("https://twitter.com/Brand")).toEqual({ platform: "x", handle: "brand", url: "https://x.com/brand" });
    expect(ok("https://www.threads.net/@brand")).toMatchObject({ platform: "threads", handle: "brand" });
  });
  it("rejects posts, reserved paths and unknown sites", () => {
    expect(parseProfileUrl("https://www.instagram.com/p/Cx123/").ok).toBe(false);
    expect(parseProfileUrl("https://www.instagram.com/reel/Cx123/").ok).toBe(false);
    expect(parseProfileUrl("https://www.facebook.com/watch/?v=1").ok).toBe(false);
    expect(parseProfileUrl("https://www.tiktok.com/discover").ok).toBe(false);
    expect(parseProfileUrl("https://x.com/i/status/1").ok).toBe(false);
    expect(parseProfileUrl("https://example.com/brand").ok).toBe(false);
    expect(parseProfileUrl("not a url at all").ok).toBe(false);
  });
  it("normalises websites and extracts hashtags and mentions", () => {
    expect(normalizeWebsite("Brand.tn/")).toBe("https://brand.tn");
    expect(normalizeWebsite("nope")).toBeNull();
    expect(hashtagsOf("Bac 2026 #Bac #bac #مراجعة go")).toEqual(["bac", "مراجعة"]);
    expect(mentionsOf("merci @prof.ali et @Elios_Academy. mail a@b.com")).toEqual(["prof.ali", "elios_academy"]);
  });
});

describe("Arabic text", () => {
  it("keeps words with hamza whole and ignores brand names as topics", async () => {
    const { normalizeText, contentTokens } = await import("@/lib/history/text");
    expect(normalizeText("إليوس أكاديمي")).toBe("اليوس اكاديمي");
    expect(contentTokens("مراجعة البكالوريا مع إليوس")).toEqual(["مراجعة", "البكالوريا", "اليوس"]);
    const p = (k: number): AnalysisPost => ({ id: `a${k}`, account: "own", platform: "facebook", published_at: null, format: null, caption: `إليوس أكاديمي مراجعة ${k}`, likes: 1, comments: 0, shares: null, saves: null, views: null, followers: null });
    const s = summarize([1, 2, 3].map(p), { tz: "UTC", periodDays: 30, ignore: ["إليوس أكاديمي"] });
    expect(s.topics.map((t) => t.key)).toEqual(["مراجعة"]);
  });
});

describe("competitor analytics", () => {
  const post = (k: number, over: Partial<AnalysisPost>): AnalysisPost => ({
    id: `p${k}`, account: "big", platform: "instagram", published_at: new Date(Date.now() - k * 86400_000).toISOString(),
    format: "Image post", caption: `Révision maths ${k}`, hashtags: ["bac"], likes: 1000, comments: 0, shares: null, saves: null, views: null, followers: 100_000, ...over,
  });
  // a big account (1,000 per post) and a small one (50 per post) where carousels do 3× their own baseline
  const posts = [
    ...Array.from({ length: 10 }, (_, k) => post(k, {})),
    ...Array.from({ length: 10 }, (_, k) => post(100 + k, { account: "small", likes: 50, followers: 2_000 })),
    ...Array.from({ length: 4 }, (_, k) => post(200 + k, { account: "small", likes: 150, followers: 2_000, format: "Carousel", caption: `Quiz physique ${k}` })),
  ];
  const s = summarize(posts, { tz: "Africa/Tunis", periodDays: 90 });

  it("sums only the metrics the platform returned", () => {
    expect(engagementOfPost({ likes: 3, comments: 2, shares: null, saves: null })).toBe(5);
    expect(engagementOfPost({ likes: null, comments: null, shares: null, saves: null })).toBeNull();
  });
  it("normalises by each account's own baseline, not raw likes", () => {
    const carousel = s.byFormat.find((g) => g.key === "Carousel")!;
    expect(carousel.medianLift).toBe(3);
    expect(carousel.medianEngagement).toBe(150); // far below the big account's raw 1,000, yet the strongest format
    expect(s.best[0].account).toBe("small");
  });
  it("reports per-follower rates only when the follower count is known", () => {
    expect(s.byFormat.find((g) => g.key === "Image post")!.medianRate).toBe(1.75); // median of 1% (big) and 2.5% (small)
    const noFollowers = summarize(posts.map((p) => ({ ...p, followers: null })), { tz: "UTC", periodDays: 90 });
    expect(noFollowers.byFormat.every((g) => g.medianRate === null)).toBe(true);
  });
  it("reports public metric coverage and frequency", () => {
    expect(s.metrics.find((m) => m.metric === "likes")!.posts).toBe(24);
    expect(s.metrics.find((m) => m.metric === "views")!.posts).toBe(0);
    expect(s.perWeek).toBeGreaterThan(0);
  });
  it("finds topics covered by one side only", () => {
    const ours = summarize(posts.filter((p) => p.account === "big"), { tz: "UTC", periodDays: 90 });
    const theirs = summarize(posts.filter((p) => p.account === "small"), { tz: "UTC", periodDays: 90 });
    expect(topicGaps(theirs, ours).theyCoverWeDont.map((t) => t.key)).toContain("quiz");
  });
});
