// Time zone and calendar-date helpers. Dates are ISO strings ("2026-11-03"), times "HH:MM".
// Wall-clock values are always interpreted in the project's IANA time zone; storage is UTC (timestamptz).

const pad = (n: number) => String(n).padStart(2, "0");

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    partsCache.set(tz, f);
  }
  return f;
}

function zonedParts(instant: number, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, weekday: p.weekday as string };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (e.g. +3600000 for Africa/Tunis). */
export function tzOffsetMs(instant: number, tz: string) {
  const z = zonedParts(instant, tz);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock date + time in `tz` → UTC ISO string. Handles DST: the offset is re-evaluated at the result. */
export function zonedToUtc(date: string, time: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(utc, tz);
  if (second !== utc) utc = second;
  return new Date(utc).toISOString();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** UTC instant → wall-clock date, time, weekday (0 = Sunday) and hour in `tz`. */
export function utcToZoned(iso: string, tz: string) {
  const z = zonedParts(Date.parse(iso), tz);
  return { date: `${z.y}-${pad(z.m)}-${pad(z.d)}`, time: `${pad(z.h)}:${pad(z.mi)}`, hour: z.h, minute: z.mi, weekday: WEEKDAYS.indexOf(z.weekday) };
}

export function todayInZone(tz: string, now = Date.now()) {
  return utcToZoned(new Date(now).toISOString(), tz).date;
}

// --- Pure calendar-date arithmetic (no time zone involved) ---------------------------------------------
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, n: number) => fromUtc(toUtc(date) + n * 86400000);
export const weekdayOf = (date: string) => new Date(toUtc(date)).getUTCDay();

/** Monday of the week containing `date` (ISO weeks start on Monday). */
export const startOfWeek = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

export function addMonths(date: string, n: number) {
  const d = new Date(toUtc(date));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return fromUtc(target.getTime());
}

export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

/** 6 × 7 grid of dates covering the month of `date`, starting on a Monday. */
export function monthGrid(date: string) {
  const first = startOfWeek(monthStart(date));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
}

export const weekDays = (date: string) => Array.from({ length: 7 }, (_, d) => addDays(startOfWeek(date), d));

export type CalendarView = "month" | "week" | "day";

/** Inclusive date range rendered by a view. */
export function viewRange(view: CalendarView, date: string) {
  if (view === "day") return { from: date, to: date };
  if (view === "week") return { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) };
  const grid = monthGrid(date);
  return { from: grid[0][0], to: grid[5][6] };
}

export function shiftView(view: CalendarView, date: string, dir: 1 | -1) {
  if (view === "day") return addDays(date, dir);
  if (view === "week") return addDays(date, 7 * dir);
  return addMonths(date, dir);
}

export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtc(v));
export const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
