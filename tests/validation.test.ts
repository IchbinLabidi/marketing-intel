import { describe, expect, it } from "vitest";
import { brandProfileSchema, projectSchema } from "@/lib/validation/project";
import { campaignSchema, pillarSchema } from "@/lib/validation/strategy";
import { formToObject } from "@/lib/validation/common";

describe("project validation", () => {
  it("normalises website and empty fields", () => {
    const r = projectSchema.parse({ name: " Brand ", website: "brand.tn", description: "", default_language: "ar_tn" });
    expect(r).toMatchObject({ name: "Brand", website: "https://brand.tn", description: null, default_language: "ar_tn" });
  });
  it("rejects empty names", () => {
    expect(projectSchema.safeParse({ name: "  " }).success).toBe(false);
  });
  it("parses products one per line with optional description", () => {
    const r = brandProfileSchema.parse({ products_services: "Argan serum - flagship\n\nToner", values: "Natural\nHonest" });
    expect(r.products_services).toEqual([{ name: "Argan serum", description: "flagship" }, { name: "Toner", description: undefined }]);
    expect(r.values).toEqual(["Natural", "Honest"]);
  });
});

describe("strategy validation", () => {
  it("bounds pillar share to 0-100", () => {
    expect(pillarSchema.safeParse({ name: "Edu", target_share: "120" }).success).toBe(false);
    expect(pillarSchema.parse({ name: "Edu", target_share: "40" }).target_share).toBe(40);
    expect(pillarSchema.parse({ name: "Edu", target_share: "" }).target_share).toBeNull();
  });
  it("rejects campaigns ending before they start", () => {
    expect(campaignSchema.safeParse({ name: "X", starts_on: "2027-02-01", ends_on: "2027-01-01" }).success).toBe(false);
    expect(campaignSchema.safeParse({ name: "X", starts_on: "2027-02-01", ends_on: "" }).success).toBe(true);
  });
  it("collects [] form keys as arrays", () => {
    const fd = new FormData();
    fd.append("name", "Sana");
    fd.append("preferred_platforms[]", "instagram");
    fd.append("preferred_platforms[]", "tiktok");
    expect(formToObject(fd)).toEqual({ name: "Sana", preferred_platforms: ["instagram", "tiktok"] });
  });
});

describe("optional fields", () => {
  it("accepts objects with optional keys missing entirely", () => {
    expect(campaignSchema.safeParse({ name: "Only a name" }).success).toBe(true);
    expect(pillarSchema.safeParse({ name: "Only a name" }).success).toBe(true);
  });
});
