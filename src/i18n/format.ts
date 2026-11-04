import { LOCALE_META, type Locale } from "./config";

type DateInput = string | number | Date;

/** Parses "YYYY-MM-DD" as that calendar day (noon UTC) so it never shifts a day across time zones. */
export function dayToDate(day: string) {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`);
}

/**
 * Locale-aware formatting for the whole UI (dates, numbers, currency, relative time, lists).
 * Display only: stored values, calculations and machine formats (CSV, en-CA date keys) never go through this.
 */
export function createFormatter(locale: Locale) {
  const tag = LOCALE_META[locale].intl;
  const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
  const nf = (o?: Intl.NumberFormatOptions) => {
    const k = `n${JSON.stringify(o ?? {})}`;
    return (cache.get(k) ?? cache.set(k, new Intl.NumberFormat(tag, o)).get(k)!) as Intl.NumberFormat;
  };
  const df = (o: Intl.DateTimeFormatOptions) => {
    const k = `d${JSON.stringify(o)}`;
    return (cache.get(k) ?? cache.set(k, new Intl.DateTimeFormat(tag, o)).get(k)!) as Intl.DateTimeFormat;
  };
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });

  return {
    locale,
    /** BCP 47 tag for any direct Intl / toLocale* call. */
    intl: tag,
    number: (n: number, o?: Intl.NumberFormatOptions) => nf(o).format(n),
    /** `ratio` is 0–1 (0.125 → "12.5 %" in French, "12.5%" in English). */
    percent: (ratio: number, digits = 0) => nf({ style: "percent", maximumFractionDigits: digits }).format(ratio),
    compact: (n: number) => nf({ notation: "compact", maximumFractionDigits: 1 }).format(n),
    currency: (amount: number, currency = "EUR", o?: Intl.NumberFormatOptions) => nf({ style: "currency", currency, ...o }).format(amount),
    /** "27 Oct 2026" / "27 oct. 2026" by default; pass Intl options to change it. */
    date: (d: DateInput, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => df(o).format(new Date(d)),
    /** A "YYYY-MM-DD" calendar day, never shifted by the viewer's time zone. */
    day: (day: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
      df({ ...o, timeZone: "UTC" }).format(dayToDate(day)),
    dateTime: (d: DateInput, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) =>
      df(o).format(new Date(d)),
    time: (d: DateInput, o: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) => df(o).format(new Date(d)),
    /** "3 days ago" / "il y a 3 jours", "tomorrow" / "demain". */
    relative: (d: DateInput, now: number = Date.now()) => {
      const diff = (new Date(d).getTime() - now) / 1000;
      const abs = Math.abs(diff);
      const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
        abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"] : abs < 86400 ? [diff / 3600, "hour"] : abs < 86400 * 30 ? [diff / 86400, "day"] : abs < 86400 * 365 ? [diff / (86400 * 30), "month"] : [diff / (86400 * 365), "year"];
      return rtf.format(Math.round(value), unit);
    },
    list: (items: string[], type: "conjunction" | "disjunction" = "conjunction") => new Intl.ListFormat(tag, { style: "long", type }).format(items),
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
