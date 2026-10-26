import "server-only";
import { normalizeSerpApi, type NormalizedSerp } from "@/lib/serp/normalize";

// SERP data comes from an approved provider through its API (no direct Google scraping). SerpApi is implemented:
// one GET per search, Google results by country (gl + google domain), language (hl) and device, with SERP features
// already structured. The key stays on the server (SERPAPI_API_KEY). Another provider = another SerpProvider.

// Searches are made from the main city: a country-wide location makes Google broaden queries (tested 2026-10-26:
// "cours informatique bac tunisien" with location "Tunisia" returned generic "informatique" pages, Tunis the bac pages).
export const COUNTRIES: Record<string, { label: string; domain: string; location: string; city: string }> = {
  tn: { label: "Tunisia", domain: "google.tn", location: "Tunis,Tunis Governorate,Tunisia", city: "Tunis" },
  fr: { label: "France", domain: "google.fr", location: "Paris,Paris,Ile-de-France,France", city: "Paris" },
  ma: { label: "Morocco", domain: "google.co.ma", location: "Casablanca,Casablanca-Settat,Morocco", city: "Casablanca" },
  dz: { label: "Algeria", domain: "google.dz", location: "Algiers,Algiers Province,Algeria", city: "Algiers" },
  be: { label: "Belgium", domain: "google.be", location: "Brussels,Brussels,Belgium", city: "Brussels" },
  ca: { label: "Canada", domain: "google.ca", location: "Montreal,Quebec,Canada", city: "Montreal" },
  ch: { label: "Switzerland", domain: "google.ch", location: "Geneva,Geneva,Geneva,Switzerland", city: "Geneva" },
  sa: { label: "Saudi Arabia", domain: "google.com.sa", location: "Riyadh,Riyadh Province,Saudi Arabia", city: "Riyadh" },
  ae: { label: "United Arab Emirates", domain: "google.ae", location: "Dubai,Dubai,United Arab Emirates", city: "Dubai" },
  gb: { label: "United Kingdom", domain: "google.co.uk", location: "London,England,United Kingdom", city: "London" },
  us: { label: "United States", domain: "google.com", location: "New York,New York,United States", city: "New York" },
};
export const SERP_LANGUAGES: Record<string, string> = { fr: "French", ar: "Arabic", en: "English" };

export type SerpQuery = { keyword: string; country: string; language: string; device: "desktop" | "mobile" };
export interface SerpProvider { id: string; label: string; configured(): boolean; setupHint: string; search(q: SerpQuery): Promise<NormalizedSerp> }

export class SerpProviderError extends Error {}

export const serpApi: SerpProvider = {
  id: "serpapi",
  label: "SerpApi · Google",
  configured: () => Boolean(process.env.SERPAPI_API_KEY?.trim()),
  setupHint: "Add SERPAPI_API_KEY to .env.local (serpapi.com → Dashboard → Your Private API Key; the free plan includes 100 searches a month).",
  async search(q) {
    const c = COUNTRIES[q.country];
    if (!c) throw new SerpProviderError("Unsupported country.");
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google", q: q.keyword, google_domain: c.domain, gl: q.country, hl: q.language, location: c.location,
      device: q.device, num: "10", api_key: process.env.SERPAPI_API_KEY!.trim(),
    }).toString();
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new SerpProviderError("SerpApi is unreachable. Try again in a moment.");
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 401 || /invalid api key/i.test(String(body.error ?? ""))) throw new SerpProviderError("The SerpApi key was rejected. Check SERPAPI_API_KEY.");
    if (res.status === 429 || /run out of searches|plan|limit/i.test(String(body.error ?? ""))) throw new SerpProviderError(`SerpApi quota reached: ${body.error ?? "too many requests"}.`);
    // "Google hasn't returned any results for this query." is a valid empty SERP, not a failure
    if (body.error && !/hasn't returned any results/i.test(String(body.error))) throw new SerpProviderError(`SerpApi: ${body.error}`);
    if (!res.ok && !body.search_metadata) throw new SerpProviderError(`SerpApi error (${res.status}).`);
    return normalizeSerpApi(body);
  },
};

export const serpProvider = (): SerpProvider => serpApi;
