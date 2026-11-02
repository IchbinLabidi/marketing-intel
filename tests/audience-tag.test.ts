import { describe, expect, it } from "vitest";
import { audienceOfSegment, fallbackAudience, guessAudience, isAudience, parseAudience, segmentForAudience } from "@/lib/backlog/audience";
import { postSchema } from "@/lib/validation/calendar";
import { draftItemSchema } from "@/lib/validation/history";

describe("audience tag", () => {
  it("accepts exactly student, parent or teacher", () => {
    expect(isAudience("student")).toBe(true);
    expect(isAudience("students")).toBe(false);
    expect(isAudience("both")).toBe(false);
    expect(isAudience(null)).toBe(false);
  });

  it("reads loose AI answers and rejects anything that isn't one of the three", () => {
    expect(parseAudience("Teacher")).toBe("teacher");
    expect(parseAudience(" parents ")).toBe("parent");
    expect(parseAudience("Students")).toBe("student");
    expect(parseAudience("Enseignants")).toBe("teacher");
    expect(parseAudience("both")).toBeNull();
    expect(parseAudience("")).toBeNull();
    expect(parseAudience(3)).toBeNull();
  });

  it("guesses from French, English and Arabic keywords, teachers first", () => {
    expect(guessAudience("Comment devenir professeur sur SOSProf")).toBe("teacher");
    expect(guessAudience("Conseils aux parents avant le bac")).toBe("parent");
    expect(guessAudience("Révisions du bac pour les élèves")).toBe("student");
    expect(guessAudience("نصائح للأولياء")).toBe("parent");
    expect(guessAudience("Nouveautés de la plateforme")).toBeNull();
  });

  it("keeps the segment in step: single side follows the tag, 'both' stays", () => {
    expect(segmentForAudience("teacher", null)).toBe("teachers");
    expect(segmentForAudience("parent", "students")).toBe("parents");
    expect(segmentForAudience("student", "both")).toBe("both");
    expect(audienceOfSegment("parents")).toBe("parent");
    expect(audienceOfSegment("both")).toBeNull();
  });

  it("always falls back to a valid tag: segment, keywords, pillar side, then student", () => {
    expect(fallbackAudience({ segment: "teachers", texts: ["élèves"] })).toBe("teacher");
    expect(fallbackAudience({ segment: "both", texts: [null, "Message aux parents"] })).toBe("parent");
    expect(fallbackAudience({ texts: ["Nouveautés"], pillarSegment: "teachers" })).toBe("teacher");
    expect(fallbackAudience({})).toBe("student");
  });

  it("validates the tag on posts and on reviewed calendar drafts", () => {
    const base = { title: "Post", platform: "facebook", status: "planned", date: null, time: null };
    expect(postSchema.safeParse({ ...base, audience: "parent" }).success).toBe(true);
    expect(postSchema.safeParse({ ...base, audience: "everyone" }).success).toBe(false);
    const draft = { scheduled_date: "2026-11-10", platform: "facebook", title: "T", format: null, pillar_id: null, campaign_id: null, funnel_stage: null, hook: null, creative_brief: null, cta: null, marketing_objective: null, opportunity_id: null, historical_source_id: null };
    expect(draftItemSchema.safeParse({ ...draft, audience: "teacher" }).success).toBe(true);
    expect(draftItemSchema.safeParse(draft).success).toBe(true); // older drafts: classified on save
    expect(draftItemSchema.safeParse({ ...draft, audience: "students" }).success).toBe(false);
  });
});
