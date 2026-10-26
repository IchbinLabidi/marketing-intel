// Recurring periods used to read historical calendars. School dates follow the Tunisian school year and are
// approximate (the ministry publishes exact dates each year); the UI labels them as such.

export type SeasonKey =
  | "back_to_school" | "term1_exams" | "winter_break" | "term2_exams" | "spring_break"
  | "bac_preparation" | "final_exams" | "summer_break" | "ramadan";

export type SeasonDef = { key: SeasonKey; label: string; group: "school" | "religious" };

export const SEASONS: SeasonDef[] = [
  { key: "back_to_school", label: "Back to school", group: "school" },
  { key: "term1_exams", label: "1st-term exams (devoirs de synthèse)", group: "school" },
  { key: "winter_break", label: "Winter school holidays", group: "school" },
  { key: "term2_exams", label: "2nd-term exams", group: "school" },
  { key: "spring_break", label: "Spring school holidays", group: "school" },
  { key: "bac_preparation", label: "Baccalaureate preparation", group: "school" },
  { key: "final_exams", label: "Final exams & national exams (Bac, 9e, 6e)", group: "school" },
  { key: "summer_break", label: "Summer holidays", group: "school" },
  { key: "ramadan", label: "Ramadan", group: "religious" },
];

// [startMonth, startDay, endMonth, endDay]; the window belongs to the school year starting in September.
const SCHOOL_WINDOWS: Record<Exclude<SeasonKey, "ramadan">, [number, number, number, number]> = {
  back_to_school: [9, 1, 10, 15],
  term1_exams: [11, 25, 12, 20],
  winter_break: [12, 21, 1, 5],
  term2_exams: [2, 25, 3, 14],
  spring_break: [3, 15, 3, 31],
  bac_preparation: [4, 1, 5, 31],
  final_exams: [5, 15, 6, 30],
  summer_break: [7, 1, 8, 31],
};

// Approximate Gregorian dates (±1 day depending on moon sighting).
const RAMADAN: Record<number, [string, string]> = {
  2018: ["2018-05-16", "2018-06-14"], 2019: ["2019-05-06", "2019-06-04"], 2020: ["2020-04-24", "2020-05-23"],
  2021: ["2021-04-13", "2021-05-12"], 2022: ["2022-04-02", "2022-05-01"], 2023: ["2023-03-23", "2023-04-20"],
  2024: ["2024-03-11", "2024-04-09"], 2025: ["2025-03-01", "2025-03-30"], 2026: ["2026-02-18", "2026-03-19"],
  2027: ["2027-02-08", "2027-03-09"], 2028: ["2028-01-28", "2028-02-26"], 2029: ["2029-01-16", "2029-02-14"],
  2030: ["2030-01-06", "2030-02-04"],
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export type SeasonWindow = { key: SeasonKey; label: string; start: string; end: string; schoolYear: string };

/** School year label for a date: "2024-2025" for anything from Sept 2024 to Aug 2025. */
export function schoolYearOf(date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 9 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/** Concrete windows for every school year touched by [from, to]. */
export function seasonWindows(from: string, to: string): SeasonWindow[] {
  const firstYear = Number(schoolYearOf(from).slice(0, 4));
  const lastYear = Number(schoolYearOf(to).slice(0, 4));
  const out: SeasonWindow[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const schoolYear = `${y}-${y + 1}`;
    for (const def of SEASONS) {
      if (def.key === "ramadan") continue;
      const [sm, sd, em, ed] = SCHOOL_WINDOWS[def.key];
      const sy = sm >= 9 ? y : y + 1;
      const ey = em >= 9 ? y : y + 1;
      out.push({ key: def.key, label: def.label, start: iso(sy, sm, sd), end: iso(ey, em, ed), schoolYear });
    }
  }
  for (const [start, end] of Object.values(RAMADAN)) {
    if (end >= from && start <= to) out.push({ key: "ramadan", label: "Ramadan", start, end, schoolYear: schoolYearOf(start) });
  }
  return out.filter((w) => w.end >= from && w.start <= to).sort((a, b) => a.start.localeCompare(b.start));
}

/** Upcoming windows from a given date, for calendar generation. */
export function upcomingWindows(from: string, to: string) {
  return seasonWindows(from, to).filter((w) => w.end >= from);
}
