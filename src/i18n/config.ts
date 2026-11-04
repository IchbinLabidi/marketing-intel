// Supported languages. To add one: append it to LOCALES, describe it in LOCALE_META, and add
// src/i18n/locales/<code>/ with the same namespaces as `en` (TypeScript then lists every missing key).
export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when neither the user's choice, their saved profile preference nor the browser language says otherwise. */
export const DEFAULT_LOCALE: Locale = "fr";
/** The source language: a key missing in another locale falls back to its English text. */
export const FALLBACK_LOCALE: Locale = "en";

/** Cookie holding the explicit choice (also mirrored to the Supabase user metadata as `locale`). */
export const LOCALE_COOKIE = "mi_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_META: Record<Locale, { label: string; flag: string; short: string; intl: string; og: string }> = {
  fr: { label: "Français", flag: "🇫🇷", short: "FR", intl: "fr-FR", og: "fr_FR" },
  en: { label: "English", flag: "🇬🇧", short: "EN", intl: "en-GB", og: "en_GB" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header ("en-US,en;q=0.9,fr;q=0.8"). */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { base: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { base } of ranked) if (isLocale(base)) return base;
  return null;
}
