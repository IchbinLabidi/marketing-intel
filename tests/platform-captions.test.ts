import { describe, expect, it } from "vitest";
import { captionAISchema, productionSchema } from "@/lib/validation/production";
import { writingOf, changedFields } from "@/lib/production/model";
import { composeCaption } from "@/lib/publishing/rules";
import {
  applyGenerated, AUTO_SETTINGS, composePlatformText, defaultYouTubeVariant, effectiveSettings, emptyCopy, hasCopy, publicationCopy, readCaptions, replacedBy, type PlatformCaptions,
} from "@/lib/production/platform-copy";
import { CAPTION_SYSTEM, captionPrompt, hasTimings, sanitizeDraft, type CaptionVariant } from "@/server/ai/captions";

const base = { ...writingOf({ title: "Bac maths: 3 erreurs", hook: "3 erreurs qui coûtent des points", caption: "Old general caption", main_content: "Scene 1 (0:00) intro\nScene 2 (0:12) erreur 1" }), platform: "instagram" as const, format: "Instagram Reel", language: "fr" as const, pillar_id: null, funnel_stage: null, target_audience: "Bac students", assignee_id: null, due_date: null, language_variants: {} };
const copy = (over: Partial<ReturnType<typeof emptyCopy>> = {}) => ({ ...emptyCopy(), ...over });
const variant = (platform: CaptionVariant["platform"], over: Partial<CaptionVariant> = {}): CaptionVariant => ({ platform, title: "", caption: `${platform} text`, hashtags: ["bac"], cta: "Follow", keywords: [], link: "", alt_text: "", chapters: "", links: "", post_type: "", ...over });

describe("platform captions storage", () => {
  it("keeps an item without platform captions valid and leaves its general caption alone", () => {
    const v = productionSchema.parse(base);
    expect(v.platform_captions).toEqual({});
    expect(v.caption).toBe("Old general caption");
  });
  it("stores each platform independently and reads stored JSON leniently", () => {
    const v = productionSchema.parse({ ...base, platform_captions: { tiktok: { caption: "TT" }, facebook: { caption: "FB", link: "https://sosprof.net" } } });
    expect(v.platform_captions.tiktok?.caption).toBe("TT");
    expect(v.platform_captions.facebook?.link).toBe("https://sosprof.net");
    expect(readCaptions({ tiktok: { caption: "x" }, myspace: { caption: "?" }, instagram: "broken" })).toEqual({ tiktok: { ...emptyCopy(), caption: "x" } });
    expect(readCaptions(null)).toEqual({});
  });
  it("shows platform copy in the revision comparison", () => {
    expect(changedFields({ platform_captions: {} }, { platform_captions: { tiktok: copy({ caption: "a" }) } })).toContain("platform_captions");
  });
});

describe("applying generated copy", () => {
  const current: PlatformCaptions = { facebook: copy({ caption: "Facebook written by hand" }), instagram: copy({ caption: "IG v1", settings: { tone: "funny" } }), tiktok: copy({ caption: "Final TikTok", status: "approved" }) };
  it("regenerating Instagram leaves Facebook untouched and keeps Instagram's own settings", () => {
    const next = applyGenerated(current, { instagram: { caption: "IG v2" }, facebook: { caption: "should not apply" } }, ["instagram"], "now");
    expect(next.facebook).toBe(current.facebook);
    expect(next.instagram?.caption).toBe("IG v2");
    expect(next.instagram?.settings).toEqual({ tone: "funny" });
  });
  it("never replaces a platform marked final unless it is explicitly chosen", () => {
    expect(applyGenerated(current, { tiktok: { caption: "new" } }, ["tiktok"], "now").tiktok?.caption).toBe("Final TikTok");
    expect(applyGenerated(current, { tiktok: { caption: "new" } }, ["tiktok"], "now", ["tiktok"]).tiktok?.caption).toBe("new");
    expect(replacedBy(current, ["facebook", "instagram", "tiktok", "youtube"])).toEqual({ replaced: ["facebook", "instagram"], kept: ["tiktok"] });
  });
  it("uses a platform override over the global settings", () => {
    expect(effectiveSettings({ ...AUTO_SETTINGS, language: "fr" }, copy({ settings: { language: "ar_tn", tone: "auto" } }))).toEqual({ ...AUTO_SETTINGS, language: "ar_tn" });
  });
  it("treats a draft with only a post type as empty", () => {
    expect(hasCopy(emptyCopy("instagram"))).toBe(false);
    expect(hasCopy(copy({ hashtags: ["a"] }))).toBe(true);
  });
});

describe("publishing with platform copy", () => {
  const item = { title: "Post title", caption: "General", cta: "Join", hashtags: ["bac"], platform_captions: { tiktok: copy({ caption: "Short TT", hashtags: ["fyp"], cta: "Follow for part 2" }), youtube_shorts: copy({ title: "3 erreurs au bac", caption: "Desc", hashtags: ["shorts"] }) } };
  it("sends each network its own caption and falls back to the general caption", () => {
    expect(publicationCopy(item, "tiktok", composeCaption).text).toBe("Short TT\n\nFollow for part 2\n\n#fyp");
    const fb = publicationCopy(item, "facebook", composeCaption);
    expect(fb.source).toBe("general");
    expect(fb.text).toBe("General\n\nJoin\n\n#bac");
    const yt = publicationCopy(item, "youtube", composeCaption, "shorts");
    expect(yt).toMatchObject({ platform: "youtube_shorts", source: "platform", title: "3 erreurs au bac" });
    expect(publicationCopy(item, "youtube", composeCaption, "video").source).toBe("general");
  });
  it("adds YouTube chapters and links to the description, not the CTA twice", () => {
    expect(composePlatformText(copy({ caption: "Desc. Abonnez-vous", cta: "Abonnez-vous", chapters: "0:00 Intro", links: "https://sosprof.net", hashtags: ["bac"] }), "youtube")).toBe("Desc. Abonnez-vous\n\n0:00 Intro\n\nhttps://sosprof.net\n\n#bac");
  });
  it("picks the Shorts copy when only Shorts is written or the item is a Reel", () => {
    expect(defaultYouTubeVariant({ youtube_shorts: copy({ caption: "a" }) }, "Facebook video")).toBe("shorts");
    expect(defaultYouTubeVariant({}, "Instagram Reel")).toBe("shorts");
    expect(defaultYouTubeVariant({}, "Educational post")).toBe("video");
  });
});

describe("caption AI", () => {
  const input = captionAISchema.parse({ operation: "generate_all", platforms: ["tiktok", "facebook"], content: { ...base, platform_captions: { facebook: { caption: "Existing FB" } } }, instruction: "Generate a funny Tunisian Darija caption with a strong CTA.", settings: { default: AUTO_SETTINGS, tiktok: { ...AUTO_SETTINGS, language: "ar_tn" } } });
  it("sends the item, the project's own context, settings and the instruction", () => {
    const prompt = captionPrompt(input, ["tiktok", "facebook"], "## Project\nName: Elios Academy", { pillar: "Bac tips", performance: "none", recent: "" });
    expect(prompt).toContain("Name: Elios Academy");
    expect(prompt).toContain("Bac tips");
    expect(prompt).toContain("funny Tunisian Darija");
    expect(prompt).toContain("tiktok (TikTok)");
    expect(prompt).toContain("language Tunisian Darija");
    expect(prompt).toContain("Existing FB");
    expect(prompt).not.toMatch(/SOSProf/i);
    expect(CAPTION_SYSTEM).toMatch(/Never invent offers, prices/);
  });
  it("keeps only requested platforms and drops untrusted links and chapters without timings", () => {
    const out = sanitizeDraft({ rationale: "", assumptions: [], variants: [variant("tiktok", { link: "https://x.test", chapters: "0:00 a" }), variant("youtube"), variant("facebook", { link: "https://invented.example/promo" }), variant("facebook")] },
      { operation: "generate_all", platforms: ["tiktok", "facebook"], current: {}, known: "Website: https://sosprof.net", script: "no timings here" });
    expect(out.variants.map((v) => v.platform)).toEqual(["tiktok", "facebook"]);
    expect(out.variants[0].link).toBe(""); // TikTok has no link field
    expect(out.variants[1].link).toBe("");
    expect(out.assumptions.join(" ")).toMatch(/isn't in your project data/);
    const yt = sanitizeDraft({ rationale: "", assumptions: [], variants: [variant("youtube", { chapters: "0:00 Intro", links: "https://sosprof.net\nhttps://fake.example" })] },
      { operation: "generate_current", platforms: ["youtube"], current: {}, known: "https://sosprof.net", script: "no timings" });
    expect(yt.variants[0].chapters).toBe("");
    expect(yt.variants[0].links).toBe("https://sosprof.net");
    expect(hasTimings("Scene 2 (0:12)")).toBe(true);
    expect(hasTimings("Scene 2 (15s)")).toBe(true);
  });
  it("changes only hashtags for the hashtag action, and returns three alternatives", () => {
    const h = sanitizeDraft({ rationale: "", assumptions: [], variants: [variant("instagram", { caption: "rewritten", hashtags: ["#bac", "bac", "#tunisie"] })] },
      { operation: "hashtags", platforms: ["instagram"], current: { instagram: { caption: "keep me", cta: "keep cta" } }, known: "", script: "" });
    expect(h.variants[0]).toMatchObject({ caption: "keep me", cta: "keep cta", hashtags: ["bac", "tunisie"] });
    const alts = sanitizeDraft({ rationale: "", assumptions: [], variants: [1, 2, 3, 4].map((n) => variant("tiktok", { caption: `v${n}` })) },
      { operation: "alternatives", platforms: ["tiktok"], current: {}, known: "", script: "" });
    expect(alts.variants.map((v) => v.caption)).toEqual(["v1", "v2", "v3"]);
  });
});
