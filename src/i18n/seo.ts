import type { Metadata } from "next";
import { LOCALES } from "./config";

/**
 * hreflang alternates for a public page. The app keeps one URL per page (no /fr or /en prefix); `?lang=fr|en`
 * selects the language explicitly (the proxy turns it into the saved choice), and the bare URL is the canonical
 * x-default that follows the visitor's preference.
 */
export function languageAlternates(path: string): Metadata["alternates"] {
  return {
    canonical: path,
    languages: { ...Object.fromEntries(LOCALES.map((l) => [l, `${path}?lang=${l}`])), "x-default": path },
  };
}
