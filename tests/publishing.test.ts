import { afterEach, describe, expect, it, vi } from "vitest";
import { composeCaption, validateForTarget, validateGroup, validateLocalFile } from "@/lib/publishing/rules";
import { classifyMetaError, facebookScheduleError, publishFacebook, publishFacebookPhotos, publishInstagram, publishInstagramCarousel } from "@/server/publishing/meta";
import { MetaApiError } from "@/server/meta/graph";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("publishing rules", () => {
  it("builds the caption from caption, CTA and hashtags", () => {
    expect(composeCaption({ caption: "Bac revision tonight", cta: "Sign up now", hashtags: ["bac", "#tunisie"] })).toBe("Bac revision tonight\n\nSign up now\n\n#bac #tunisie");
    expect(composeCaption({ caption: "Sign up now!", cta: "Sign up now", hashtags: [] })).toBe("Sign up now!");
  });

  it("applies Instagram's documented limits", () => {
    expect(validateForTarget("instagram", { caption: "hi", mime: null, hasMedia: false })).toMatch(/needs an image or a video/);
    expect(validateForTarget("instagram", { caption: "hi", mime: "image/png", hasMedia: true })).toMatch(/only accepts JPEG/);
    expect(validateForTarget("instagram", { caption: "x".repeat(2201), mime: "image/jpeg", hasMedia: true })).toMatch(/2,200/);
    expect(validateForTarget("instagram", { caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), mime: "image/jpeg", hasMedia: true })).toMatch(/30 hashtags/);
    expect(validateForTarget("instagram", { caption: "ok", mime: "video/mp4", hasMedia: true })).toBeNull();
    expect(validateForTarget("facebook", { caption: "text only", mime: null, hasMedia: false })).toBeNull();
  });

  it("allows several photos in one post, never videos, at most 10, JPEG on Instagram", () => {
    expect(validateGroup("instagram", ["image/jpeg"])).toBeNull();
    expect(validateGroup("instagram", ["image/jpeg", "image/jpeg"])).toBeNull();
    expect(validateGroup("instagram", ["image/jpeg", "image/png"])).toMatch(/JPEG/);
    expect(validateGroup("facebook", ["image/jpeg", "image/png"])).toBeNull();
    expect(validateGroup("facebook", ["image/jpeg", "video/mp4"])).toMatch(/must all be photos/);
    expect(validateGroup("facebook", Array(11).fill("image/jpeg"))).toMatch(/at most 10/);
  });

  it("checks a computer file before any upload", () => {
    expect(validateLocalFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateLocalFile({ type: "application/pdf", size: 1000 })).toMatch(/image or a video/);
    expect(validateLocalFile({ type: "video/mp4", size: 60 * 1024 * 1024 })).toMatch(/50 MB/);
  });

  it("enforces Facebook's scheduling window", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    expect(facebookScheduleError(new Date("2026-10-29T10:05:00Z"), now)).toMatch(/10 minutes/);
    expect(facebookScheduleError(new Date("2026-12-15T10:00:00Z"), now)).toMatch(/30 days/);
    expect(facebookScheduleError(new Date("2026-10-30T10:00:00Z"), now)).toBeNull();
  });
});

describe("Meta adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads a Facebook photo as bytes (no public link) and schedules natively", async () => {
    const calls: { url: string; body: FormData | URLSearchParams }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => { calls.push({ url: String(url), body: init.body as FormData }); return json({ id: "photo1", post_id: "123_456" }); }));
    const at = new Date(Date.now() + 86_400_000);
    const r = await publishFacebook({ pageId: "123", pageToken: "t", message: "hello", media: { kind: "image", bytes: new Blob(["x"], { type: "image/jpeg" }), filename: "a.jpg", mime: "image/jpeg" }, scheduleAt: at });
    expect(calls[0].url).toContain("/123/photos");
    const body = calls[0].body as FormData;
    expect(body.get("source")).toBeInstanceOf(Blob);
    expect(body.get("url")).toBeNull();
    expect(body.get("published")).toBe("false");
    expect(body.get("scheduled_publish_time")).toBe(String(Math.floor(at.getTime() / 1000)));
    expect(r).toMatchObject({ postId: "123_456", url: null, scheduledFor: at.toISOString() });
  });

  it("publishes an Instagram image: container, status, publish, permalink", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      const u = String(url); seen.push(u);
      if (u.includes("/ig1/media_publish")) return json({ id: "m1" });
      if (u.includes("/ig1/media")) return json({ id: "c1" });
      if (u.includes("/c1?")) return json({ status_code: "FINISHED" });
      if (u.includes("/m1?")) return json({ permalink: "https://www.instagram.com/p/abc/" });
      return json({ error: { message: "unexpected" } }, 400);
    }));
    const r = await publishInstagram({ igUserId: "ig1", pageToken: "t", caption: "hi", media: { kind: "image", url: "https://x.test/a.jpg", mime: "image/jpeg" } });
    expect(r).toMatchObject({ postId: "m1", url: "https://www.instagram.com/p/abc/" });
    expect(seen.filter((u) => u.includes("media_publish"))).toHaveLength(1);
  });

  it("posts several photos on Facebook: unpublished uploads attached to one feed post", async () => {
    const calls: { url: string; body: FormData | URLSearchParams }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => { calls.push({ url: String(url), body: init.body as FormData }); return json({ id: String(url).includes("/feed") ? "123_789" : `p${++n}` }); }));
    const photo = { kind: "image" as const, bytes: new Blob(["x"], { type: "image/jpeg" }), filename: "a.jpg", mime: "image/jpeg" };
    const at = new Date(Date.now() + 86_400_000);
    const r = await publishFacebookPhotos({ pageId: "123", pageToken: "t", message: "hello", photos: [photo, photo], scheduleAt: at });
    expect(calls.map((c) => c.url.split("?")[0].split("/").slice(-1)[0])).toEqual(["photos", "photos", "feed"]);
    expect((calls[0].body as FormData).get("published")).toBe("false");
    expect((calls[0].body as FormData).get("temporary")).toBe("true");
    const feed = calls[2].body as URLSearchParams;
    expect(feed.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "p1" }));
    expect(feed.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "p2" }));
    expect(feed.get("scheduled_publish_time")).toBe(String(Math.floor(at.getTime() / 1000)));
    expect(r).toMatchObject({ postId: "123_789", scheduledFor: at.toISOString() });
  });

  it("publishes an Instagram carousel: one container per photo, a carousel container, then publish", async () => {
    const posts: { url: string; body: URLSearchParams }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") posts.push({ url: u, body: init.body as URLSearchParams });
      if (u.includes("/ig1/media_publish")) return json({ id: "m9" });
      if (u.includes("/ig1/media")) return json({ id: `c${++n}` });
      if (u.includes("/c3?")) return json({ status_code: "FINISHED" });
      if (u.includes("/m9?")) return json({ permalink: "https://www.instagram.com/p/car/" });
      return json({ error: { message: "unexpected" } }, 400);
    }));
    const img = (k: string) => ({ kind: "image" as const, url: `https://x.test/${k}.jpg`, mime: "image/jpeg" });
    const r = await publishInstagramCarousel({ igUserId: "ig1", pageToken: "t", caption: "hi", items: [img("a"), img("b")] });
    expect(posts[0].body.get("is_carousel_item")).toBe("true");
    expect(posts[2].body.get("media_type")).toBe("CAROUSEL");
    expect(posts[2].body.get("children")).toBe("c1,c2");
    expect(posts[3].body.get("creation_id")).toBe("c3");
    expect(r).toMatchObject({ postId: "m9", url: "https://www.instagram.com/p/car/" });
  });

  it("reports a video still processing instead of blocking past the wait time", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => (String(url).includes("/ig1/media") ? json({ id: "c2" }) : json({ status_code: "IN_PROGRESS" }))));
    const r = await publishInstagram({ igUserId: "ig1", pageToken: "t", caption: "hi", media: { kind: "video", url: "https://x.test/v.mp4", mime: "video/mp4" }, waitMs: 0 });
    expect(r).toMatchObject({ processing: true, containerId: "c2" });
  });

  it("classifies errors so permanent ones aren't retried", () => {
    expect(classifyMetaError(new MetaApiError("expired", 190, 463, 401)).kind).toBe("auth");
    expect(classifyMetaError(new MetaApiError("no perm", 200, undefined, 403)).kind).toBe("auth");
    expect(classifyMetaError(new MetaApiError("limit", 4, undefined, 400)).kind).toBe("transient");
    expect(classifyMetaError(new MetaApiError("bad image", 100, undefined, 400)).kind).toBe("validation");
  });
});
