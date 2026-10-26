import { describe, expect, it } from "vitest";
import { addDays, addMonths, isTime, monthGrid, shiftView, startOfWeek, todayInZone, utcToZoned, viewRange, zonedToUtc } from "@/lib/calendar/time";
import { bestPublicationTimes, findConflicts, suggestedTime } from "@/lib/calendar/insights";
import { STATUS_TO_WORKFLOW } from "@/lib/domain/constants";

describe("time zones", () => {
  it("converts project wall-clock time to UTC and back", () => {
    expect(zonedToUtc("2026-11-03", "18:30", "Africa/Tunis")).toBe("2026-11-03T17:30:00.000Z"); // UTC+1, no DST
    expect(utcToZoned("2026-11-03T17:30:00.000Z", "Africa/Tunis")).toMatchObject({ date: "2026-11-03", time: "18:30", hour: 18, weekday: 2 });
    // a late-evening slot crosses midnight in UTC but stays on its local day
    expect(zonedToUtc("2026-11-03", "00:30", "Africa/Tunis")).toBe("2026-11-02T23:30:00.000Z");
  });
  it("handles daylight saving transitions", () => {
    expect(zonedToUtc("2026-03-28", "10:00", "Europe/Paris")).toBe("2026-03-28T09:00:00.000Z"); // CET
    expect(zonedToUtc("2026-03-30", "10:00", "Europe/Paris")).toBe("2026-03-30T08:00:00.000Z"); // CEST
    expect(utcToZoned("2026-10-25T01:30:00.000Z", "Europe/Paris").time).toBe("02:30"); // after fall-back
  });
  it("computes today in the project zone, not the server's", () => {
    const lateUtc = Date.parse("2026-11-03T23:30:00Z");
    expect(todayInZone("Africa/Tunis", lateUtc)).toBe("2026-11-04");
    expect(todayInZone("America/New_York", lateUtc)).toBe("2026-11-03");
  });
});

describe("calendar dates", () => {
  it("builds Monday-first month grids and week ranges", () => {
    const grid = monthGrid("2026-11-15");
    expect(grid[0][0]).toBe("2026-10-26"); // Monday before 1 Nov (a Sunday)
    expect(grid.flat()).toContain("2026-11-30");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
    expect(viewRange("week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(viewRange("day", "2026-11-04")).toEqual({ from: "2026-11-04", to: "2026-11-04" });
  });
  it("navigates periods, clamping month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftView("month", "2026-11-15", -1)).toBe("2026-10-15");
    expect(shiftView("week", "2026-11-04", 1)).toBe("2026-11-11");
    expect(isTime("09:05")).toBe(true);
    expect(isTime("24:00")).toBe(false);
  });
});

describe("workflow", () => {
  it("groups production stages into publication states and never implies publishing", () => {
    expect(STATUS_TO_WORKFLOW.planned).toBe("draft");
    expect(STATUS_TO_WORKFLOW.in_review).toBe("pending");
    expect(STATUS_TO_WORKFLOW.scheduled).toBe("scheduled");
    expect(STATUS_TO_WORKFLOW.failed).toBe("failed");
  });
});

describe("publication-time insights", () => {
  // Thursday 18:00–21:00 local posts perform 3× better than Monday mornings in this sample
  const post = (iso: string, likes: number) => ({ platform: "instagram" as const, published_at: iso, likes, comments: 0, shares: 0, saves: 0, reach: 1000 });
  const items = [
    ...Array.from({ length: 6 }, (_, k) => post(`${addDays("2026-01-01", k * 7)}T18:00:00Z`, 90)), // Thursdays 19:00 Tunis
    ...Array.from({ length: 6 }, (_, k) => post(`${addDays("2026-01-05", k * 4)}T08:00:00Z`, 30)), // mornings
    post("not-a-date", 999), // malformed timestamps are ignored, never crash the page
  ];
  it("finds best days, windows and suggested slots in the project zone", () => {
    const [ig] = bestPublicationTimes(items, "Africa/Tunis");
    expect(ig.metric).toBe("engagement");
    expect(ig.weekdays.find((w) => w.label === "Thursday")?.n).toBe(6);
    expect(ig.suggestions[0]).toMatchObject({ weekday: 4, window: 18, n: 6 });
    expect(suggestedTime(ig, 4)).toBe("18:00");
    expect(suggestedTime(ig, 1)).toBeNull();
  });
  it("ranks windows on interactions, so low-reach windows don't win on rate alone", () => {
    // evenings: 10 interactions on 20 reach (50% rate); mornings: 40 interactions on 2,000 reach (2% rate)
    const fb = (iso: string, likes: number, reach: number) => ({ platform: "facebook" as const, published_at: iso, likes, comments: 0, shares: 0, saves: 0, reach });
    const list = [
      ...Array.from({ length: 6 }, (_, k) => fb(`${addDays("2026-02-02", k)}T20:00:00Z`, 10, 20)),
      ...Array.from({ length: 6 }, (_, k) => fb(`${addDays("2026-02-02", k)}T08:00:00Z`, 40, 2000)),
    ];
    const [t] = bestPublicationTimes(list, "Africa/Tunis");
    expect(t.hours.find((h) => h.key === "9")?.lift).toBeGreaterThan(1);
    expect(t.hours.find((h) => h.key === "21")?.lift).toBeLessThan(1);
  });
  it("stays silent without enough timed posts", () => {
    expect(bestPublicationTimes(items.slice(0, 5), "Africa/Tunis")).toEqual([]);
    expect(bestPublicationTimes(items.map((i) => ({ ...i, published_at: null })), "Africa/Tunis")).toEqual([]);
  });
});

describe("conflicts", () => {
  const slots = [
    { id: "a", platform: "instagram", scheduled_at: "2026-11-03T17:00:00Z", title: "A" },
    { id: "b", platform: "facebook", scheduled_at: "2026-11-03T17:10:00Z", title: "B" },
  ];
  it("flags same-platform posts within an hour only", () => {
    expect(findConflicts(slots, { id: "c", platform: "instagram", scheduled_at: "2026-11-03T17:30:00Z", title: "C" }).map((s) => s.id)).toEqual(["a"]);
    expect(findConflicts(slots, { id: "c", platform: "instagram", scheduled_at: "2026-11-03T18:30:00Z", title: "C" })).toEqual([]);
    expect(findConflicts(slots, { id: "a", platform: "instagram", scheduled_at: "2026-11-03T17:00:00Z", title: "A" })).toEqual([]); // itself
  });
});
