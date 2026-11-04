import { describe, expect, it } from "vitest";
import { slotFields, utcToZoned } from "@/lib/calendar/time";
import { testT } from "@/i18n/testing";

const t = testT("calendar");

describe("publication slot fields", () => {
  it("stores the local date/time and its UTC instant (Tunis is UTC+1, no DST)", () => {
    const r = slotFields("2026-11-02", "20:00", "Africa/Tunis", t);
    expect(r).toEqual({ ok: true, fields: { scheduled_date: "2026-11-02", scheduled_time: "20:00", scheduled_at: "2026-11-02T19:00:00.000Z" } });
    if (r.ok) expect(utcToZoned(r.fields.scheduled_at!, "Africa/Tunis")).toMatchObject({ date: "2026-11-02", time: "20:00" });
  });

  it("keeps a date without a time, and clears everything without a date", () => {
    expect(slotFields("2026-11-05", null, "Africa/Tunis", t)).toEqual({ ok: true, fields: { scheduled_date: "2026-11-05", scheduled_time: null, scheduled_at: null } });
    expect(slotFields(null, "10:00", "Africa/Tunis", t)).toEqual({ ok: true, fields: { scheduled_date: null, scheduled_time: null, scheduled_at: null } });
  });

  it("refuses invalid input and times skipped by a daylight-saving change", () => {
    expect(slotFields("02/11/2026", "20:00", "Africa/Tunis", t).ok).toBe(false);
    expect(slotFields("2026-11-02", "25:00", "Africa/Tunis", t).ok).toBe(false);
    expect(slotFields("2026-03-29", "02:30", "Europe/Paris", t).ok).toBe(false);
    expect(slotFields("2026-03-29", "04:00", "Europe/Paris", t).ok).toBe(true);
  });
});
