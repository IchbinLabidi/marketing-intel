// Competitor ads saved from Meta's public Ad Library (pure helpers, tested).
// One ad per line, columns separated by tabs, semicolons or commas:
//   ad link or Library ID, start date, end date or "active", platforms, ad text…
// Platforms: words like "facebook instagram" or "fb/ig"; everything after the platforms column is the ad text.

import { parseDate } from "./bulk";

export const AD_PLATFORMS = ["facebook", "instagram", "messenger", "audience_network", "threads"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];
export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network", threads: "Threads" };

export type AdRow = {
  line: number; library_id: string | null; url: string; started_on: string | null; ended_on: string | null; platforms: AdPlatform[]; body: string; error: string | null;
};

/** Library ID from an Ad Library link (…/ads/library/?id=123…) or a bare ID ("Library ID: 123" works too). */
export function libraryIdFrom(input: string): string | null {
  const s = input.trim();
  const fromUrl = s.match(/facebook\.com\/ads\/library\/?\?(?:[^#]*&)?id=(\d{5,25})/i)?.[1];
  if (fromUrl) return fromUrl;
  return s.replace(/^library\s*id\s*:?\s*/i, "").match(/^\d{5,25}$/)?.[0] ?? null;
}

export const adUrl = (libraryId: string) => `https://www.facebook.com/ads/library/?id=${libraryId}`;

export function parsePlatforms(raw: string | undefined): AdPlatform[] {
  const s = (raw ?? "").toLowerCase();
  const out = new Set<AdPlatform>();
  if (/\b(facebook|fb)\b/.test(s)) out.add("facebook");
  if (/\b(instagram|ig|insta)\b/.test(s)) out.add("instagram");
  if (/\bmessenger\b/.test(s)) out.add("messenger");
  if (/audience\s*network|\ban\b/.test(s)) out.add("audience_network");
  if (/\bthreads\b/.test(s)) out.add("threads");
  return [...out];
}

export function parseAdLines(text: string, today: string): AdRow[] {
  const rows: AdRow[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const cells = line.split(sep).map((c) => c.trim());
    if (i === 0 && /^(link|url|lien|library|id)\b/i.test(cells[0]) && !libraryIdFrom(cells[0])) return; // header row
    const [ref = "", start, end, platforms, ...rest] = cells;
    const libraryId = libraryIdFrom(ref);
    const started = parseDate(start);
    const active = !end || /^(active|actif|running|en cours|-)$/i.test(end);
    const ended = active ? null : parseDate(end);
    const error = !libraryId ? "First column: the ad's Ad Library link or Library ID"
      : !started ? "Start date not recognised (use 2026-10-28 or 28/10/2026)"
      : started > today ? "Start date is in the future"
      : !active && !ended ? "End date not recognised (or write “active”)"
      : ended && ended < started ? "End date is before the start date"
      : null;
    rows.push({
      line: i + 1, library_id: libraryId, url: libraryId ? adUrl(libraryId) : ref, started_on: started, ended_on: ended,
      platforms: parsePlatforms(platforms), body: rest.join(sep === "\t" ? " " : `${sep} `).trim(), error,
    });
  });
  return rows;
}

/** Days an ad has run: up to its end date, or up to today while it is active (both days counted). */
export function runningDays(ad: { started_on: string; ended_on: string | null }, today: string) {
  const end = ad.ended_on ?? today;
  return Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${ad.started_on}T00:00:00Z`)) / 86_400_000) + 1);
}

/** Short facts for the AI analysis: counts, running times and the texts of the ads. Ads that run long are often the ones that work for the advertiser, but that stays a hypothesis. */
export function adsDigest(ads: { started_on: string; ended_on: string | null; platforms: string[]; body: string; library_id: string }[], today: string) {
  if (!ads.length) return "(no ads recorded)";
  const active = ads.filter((a) => !a.ended_on);
  const lines = ads.slice(0, 40).map((a) => `- Ad ${a.library_id}: started ${a.started_on}, ${a.ended_on ? `ended ${a.ended_on}` : "still active"}, ${runningDays(a, today)} days, ${a.platforms.join("/") || "platforms not noted"}: ${a.body.slice(0, 300) || "(text not recorded)"}`);
  return `${ads.length} ads recorded from Meta's Ad Library (${active.length} active). Recorded manually; reach and spend are not published by Meta for these ads.\n${lines.join("\n")}`;
}
