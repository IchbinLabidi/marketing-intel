import { afterEach, describe, expect, it, vi } from "vitest";
import { composeCaption, validateForTarget, validateLocalFile } from "@/lib/publishing/rules";
import { classifyMetaError, facebookScheduleError, publishFacebook, publishInstagram } from "@/server/publishing/meta";
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
