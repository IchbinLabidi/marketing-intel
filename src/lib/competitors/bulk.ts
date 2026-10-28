// Bulk manual entry of competitor posts (platforms without an official data source, e.g. other Facebook Pages).
// One post per line, columns separated by tabs (pasted from a spreadsheet), semicolons or commas:
//   link, date, likes, comments, shares, views, caption…
// Everything after the views column is the caption, so captions may contain commas.

export type BulkRow = {
  line: number; url: string; published_at: string | null; likes: number | null; comments: number | null; shares: number | null; views: number | null;
  caption: string; error: string | null;
};

/** "1.2K" → 1200, "3,4 k" → 3400, "1 234" → 1234, "" → null (not shown publicly). */
export function parseCount(raw: string | undefined): number | null | "invalid" {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)(k|m)?$/);
  if (m) {
    const base = m[2] ? Number(m[1].replace(",", ".")) : Number(m[1].replace(/[.,]/g, ""));
    return Math.round(base * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1));
  }
  return /^\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, "")) : "invalid";
}

/** YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (day first, as shown on Facebook in French/Arabic locales) → YYYY-MM-DD. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function parseBulkPosts(text: string, today: string): BulkRow[] {
  const rows: BulkRow[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const cells = line.split(sep).map((c) => c.trim());
    if (i === 0 && /^(link|url|lien)$/i.test(cells[0])) return; // header row
    const [url = "", date, likes, comments, shares, views, ...rest] = cells;
    const counts = [likes, comments, shares, views].map(parseCount);
    const published = parseDate(date);
    const error = !/^https:\/\/\S+$/i.test(url) ? "The first column must be the post's https:// link"
      : !published ? "Date not recognised (use 2026-10-28 or 28/10/2026)"
      : published > today ? "Date is in the future"
      : counts.some((c) => c === "invalid") ? "A number is not recognised (examples: 120, 1.2K, 3 400)"
      : null;
    rows.push({
      line: i + 1, url, published_at: published,
      likes: counts[0] === "invalid" ? null : counts[0], comments: counts[1] === "invalid" ? null : counts[1],
      shares: counts[2] === "invalid" ? null : counts[2], views: counts[3] === "invalid" ? null : counts[3],
      caption: rest.join(sep === "\t" ? " " : `${sep} `).trim(), error,
    });
  });
  return rows;
}

/**
 * Meta's public Ad Library for a competitor's Facebook Page: the exact Page when its numeric id is known
 * (facebook.com/profile.php?id=…), otherwise a search on the Page name. Opens in the browser; nothing is collected.
 */
/** Numeric Facebook Page id from a pasted Ad Library link (view_all_page_id=…), a profile.php?id=… link or the bare id. */
export function pageIdFromInput(input: string): string | null {
  const s = input.trim();
  if (/^\d{5,20}$/.test(s)) return s;
  return s.match(/[?&](?:view_all_page_id|id)=(\d{5,20})/)?.[1] ?? null;
}

/**
 * The Page id saved for the Ad Library. Only an id taken from the Ad Library itself is trusted: a profile.php?id=…
 * number in the profile link is often a different id from the advertiser Page id Meta uses there.
 */
export function facebookPageId(channel: { external_id?: string | null }) {
  return channel.external_id && /^\d{5,20}$/.test(channel.external_id) ? channel.external_id : null;
}

export function adLibraryUrl(channel: { handle: string | null; url: string | null; display_name: string | null; external_id?: string | null }, country = "ALL") {
  const id = facebookPageId(channel);
  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", "all");
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", country);
  if (id) {
    u.searchParams.set("view_all_page_id", id);
    u.searchParams.set("search_type", "page");
  } else {
    u.searchParams.set("q", channel.display_name || channel.handle || "");
    u.searchParams.set("search_type", "keyword_unordered");
  }
  u.searchParams.set("media_type", "all");
  return u.toString();
}
