import { describe, expect, it } from "vitest";
import { adLibraryUrl, parseBulkPosts, parseCount, parseDate } from "@/lib/competitors/bulk";

describe("bulk manual posts", () => {
  it("reads counts the way platforms display them", () => {
    expect(parseCount("120")).toBe(120);
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("3,4 k")).toBe(3400);
    expect(parseCount("1 234")).toBe(1234);
    expect(parseCount("2M")).toBe(2_000_000);
    expect(parseCount("")).toBeNull(); // not shown publicly, never 0
    expect(parseCount("abc")).toBe("invalid");
  });

  it("reads ISO and day-first dates and rejects impossible ones", () => {
    expect(parseDate("2026-10-28")).toBe("2026-10-28");
    expect(parseDate("28/10/2026")).toBe("2026-10-28");
    expect(parseDate("5-3-2026")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });

  it("parses pasted spreadsheet rows, commas inside captions and a header line", () => {
    const text = [
      "link\tdate\tlikes\tcomments\tshares\tviews\tcaption",
      "https://www.facebook.com/tot/posts/1\t28/10/2026\t1.2K\t40\t\t\tBac revision, live tonight",
      "https://www.facebook.com/tot/posts/2, 2026-10-20, 15, 2, 1, , Offer: 20% off, this week",
      "not a link, 2026-10-20, 1",
      "https://www.facebook.com/tot/posts/3, 2026-12-01, 1",
    ].join("\n");
    const rows = parseBulkPosts(text, "2026-10-29");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ line: 2, published_at: "2026-10-28", likes: 1200, comments: 40, shares: null, views: null, caption: "Bac revision, live tonight", error: null });
    expect(rows[1]).toMatchObject({ likes: 15, comments: 2, shares: 1, views: null, caption: "Offer: 20% off, this week", error: null });
    expect(rows[2].error).toMatch(/https:\/\/ link/);
    expect(rows[3].error).toBe("Date is in the future");
  });

  it("links to Meta's Ad Library by Page id when known, else by name", () => {
    expect(adLibraryUrl({ handle: "x", url: "https://www.facebook.com/profile.php?id=61595797558486", display_name: null })).toContain("view_all_page_id=61595797558486");
    const byName = new URL(adLibraryUrl({ handle: "tunisianonlineteachers", url: "https://www.facebook.com/tunisianonlineteachers", display_name: "Tunisian Online Teachers" }));
    expect(byName.searchParams.get("q")).toBe("Tunisian Online Teachers");
    expect(byName.hostname).toBe("www.facebook.com");
  });
});

describe("Ad Library page id", () => {
  it("reads the Page id from a pasted Ad Library address or a bare id", async () => {
    const { pageIdFromInput, facebookPageId } = await import("@/lib/competitors/bulk");
    expect(pageIdFromInput("https://www.facebook.com/ads/library/?active_status=active&search_type=page&view_all_page_id=100696658038458")).toBe("100696658038458");
    expect(pageIdFromInput("100696658038458")).toBe("100696658038458");
    expect(pageIdFromInput("https://www.facebook.com/tunisianonlineteachers")).toBeNull();
    expect(facebookPageId({ handle: "tunisianonlineteachers", url: null, external_id: "100696658038458" })).toBe("100696658038458");
  });
});
