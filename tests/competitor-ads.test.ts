import { describe, expect, it } from "vitest";
import { adsDigest, libraryIdFrom, parseAdLines, parsePlatforms, runningDays } from "@/lib/competitors/ads";

describe("competitor ads from Meta's Ad Library", () => {
  it("reads the Library ID from an ad link, a bare ID or a copied label", () => {
    expect(libraryIdFrom("https://www.facebook.com/ads/library/?id=1234567890123456")).toBe("1234567890123456");
    expect(libraryIdFrom("https://www.facebook.com/ads/library/?active_status=all&id=1234567890123456&country=TN")).toBe("1234567890123456");
    expect(libraryIdFrom("Library ID: 1234567890123456")).toBe("1234567890123456");
    expect(libraryIdFrom("https://www.facebook.com/ads/library/?view_all_page_id=100696658038458")).toBeNull(); // a Page, not an ad
  });

  it("understands platform words and abbreviations", () => {
    expect(parsePlatforms("facebook instagram")).toEqual(["facebook", "instagram"]);
    expect(parsePlatforms("fb/ig/messenger")).toEqual(["facebook", "instagram", "messenger"]);
    expect(parsePlatforms("")).toEqual([]);
  });

  it("parses pasted lines with active and ended ads, and flags mistakes", () => {
    const rows = parseAdLines([
      "1234567890123456, 20/10/2026, active, facebook instagram, Inscriptions ouvertes, Bac 2027",
      "9876543210987654\t2026-09-01\t2026-09-30\tfb\tPromo rentrée -20%",
      "not an id, 2026-09-01, active",
      "1111122222333334, 2026-10-01, 2026-09-01, fb",
      "5555566666777778, 2026-11-15, active",
    ].join("\n"), "2026-10-29");
    expect(rows[0]).toMatchObject({ library_id: "1234567890123456", started_on: "2026-10-20", ended_on: null, platforms: ["facebook", "instagram"], body: "Inscriptions ouvertes, Bac 2027", error: null });
    expect(rows[0].url).toBe("https://www.facebook.com/ads/library/?id=1234567890123456");
    expect(rows[1]).toMatchObject({ ended_on: "2026-09-30", platforms: ["facebook"], body: "Promo rentrée -20%", error: null });
    expect(rows[2].error).toMatch(/Library ID/);
    expect(rows[3].error).toBe("End date is before the start date");
    expect(rows[4].error).toBe("Start date is in the future");
  });

  it("counts running days inclusively and summarises ads for the analysis without inventing reach", () => {
    expect(runningDays({ started_on: "2026-10-20", ended_on: null }, "2026-10-29")).toBe(10);
    expect(runningDays({ started_on: "2026-09-01", ended_on: "2026-09-30" }, "2026-10-29")).toBe(30);
    const d = adsDigest([{ library_id: "1", started_on: "2026-10-20", ended_on: null, platforms: ["facebook"], body: "Bac" }], "2026-10-29");
    expect(d).toContain("1 ads recorded");
    expect(d).toContain("reach and spend are not published");
    expect(adsDigest([], "2026-10-29")).toBe("(no ads recorded)");
  });
});
