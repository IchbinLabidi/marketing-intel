import { PLATFORMS, type Platform } from "@/lib/domain/constants";
import { normalizeText, titleCase } from "./text";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, january: 1, fevrier: 2, fev: 2, feb: 2, february: 2, mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, jun: 6, june: 6, juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8, septembre: 9, sept: 9, sep: 9, september: 9, octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function toIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // 31/02 etc.
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parses the date formats found in real editorial calendars into ISO yyyy-mm-dd.
 * Numeric dates are read day-first (Tunisia/France) unless the first part can only be a month.
 * Returns null when the value can't be read unambiguously as a date.
 */
export function parseDate(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let m = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return toIso(+m[1], +m[2], +m[3]);

  m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (b > 12 && a <= 12) return toIso(y, a, b); // US order, unambiguous
    return toIso(y, b, a);
  }

  // Excel serial day numbers (1955-2064 range), e.g. "45567"
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const serial = Math.floor(Number(value));
    if (serial > 20000 && serial < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }

  // Textual: "lundi 12 septembre 2024", "12 sept. 2024", "September 12, 2024", "Sep 12 2024"
  const words = normalizeText(value).split(" ");
  const monthIdx = words.findIndex((w) => MONTHS[w] !== undefined);
  if (monthIdx >= 0) {
    const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
    const year = nums.find((n) => n >= 1990 && n <= 2100);
    const day = nums.find((n) => n >= 1 && n <= 31 && n !== year);
    if (year && day) return toIso(year, MONTHS[words[monthIdx]], day);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------
const PLATFORM_ALIASES: [Platform, string[]][] = [
  ["instagram", ["instagram", "insta", "ig", "reels instagram", "instagram reels"]],
  ["facebook", ["facebook", "fb", "meta", "page facebook"]],
  ["tiktok", ["tiktok", "tik tok", "tt"]],
  ["linkedin", ["linkedin", "linked in", "li"]],
  ["youtube", ["youtube", "yt", "youtube shorts", "shorts"]],
  ["x", ["x", "twitter", "x twitter"]],
  ["pinterest", ["pinterest"]],
  ["snapchat", ["snapchat", "snap"]],
  ["threads", ["threads"]],
  ["blog", ["blog", "site", "site web", "website", "article", "seo"]],
  ["newsletter", ["newsletter", "email", "e mail", "mail", "emailing", "mailing"]],
];

/** Returns every platform recognised in the cell ("Instagram + Facebook" → both), in order of appearance. */
export function parsePlatforms(raw: string | null | undefined): Platform[] {
  const n = normalizeText(raw);
  if (!n) return [];
  if ((PLATFORMS as readonly string[]).includes(n)) return [n as Platform];
  const found: { p: Platform; at: number }[] = [];
  for (const [platform, aliases] of PLATFORM_ALIASES) {
    let best = -1;
    for (const alias of aliases) {
      const at = ` ${n} `.indexOf(` ${alias} `);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best >= 0) found.push({ p: platform, at: best });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

// ---------------------------------------------------------------------------
// Numbers (metrics are counts)
// ---------------------------------------------------------------------------
export type NumberResult = { value: number | null; error?: string };

export function parseCount(raw: string | null | undefined): NumberResult {
  let v = (raw ?? "").trim().replace(/[\s  ]/g, "");
  if (!v || v === "-" || v === "—" || /^n\/?a$/i.test(v)) return { value: null };
  if (v.endsWith("%")) return { value: null, error: "is a percentage, not a count" };
  let mult = 1;
  const suffix = v.match(/([kKmM])$/);
  if (suffix) {
    mult = /k/i.test(suffix[1]) ? 1_000 : 1_000_000;
    v = v.slice(0, -1);
  }
  if (v.includes(",") && v.includes(".")) {
    // the last separator is the decimal one
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    v = /,\d{3}$/.test(v) && mult === 1 ? v.replace(/,/g, "") : v.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(v) && mult === 1) {
    v = v.replace(/\./g, ""); // 1.234 = thousands in fr locale
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: null, error: "is not a number" };
  if (n < 0) return { value: null, error: "cannot be negative" };
  return { value: Math.round(n * mult) };
}

// ---------------------------------------------------------------------------
// Formats and statuses: normalised for analysis only; the raw value is what gets stored.
// ---------------------------------------------------------------------------
const FORMAT_RULES: [string, RegExp][] = [
  ["Short video", /\b(reels?|shorts?|tiktok|video courte|short video)\b/],
  ["Carousel", /\b(carou?s+el+|carrousel|slides?|diaporama)\b/],
  ["Story", /\b(stor(y|ies)|statut whatsapp)\b/],
  ["Live", /\b(live|direct|webinaire?|webinar)\b/],
  ["Video", /\b(videos?|tutoriel video|vlog)\b/],
  ["Infographic", /\b(infograph\w*)\b/],
  ["Poll / quiz", /\b(poll|sondage|quiz|qcm|question)\b/],
  ["Article", /\b(article|blog|blog post)\b/],
  ["Newsletter", /\b(newsletter|email|e mail|mailing)\b/],
  ["Image post", /\b(image|photo|visuel|static|statique|post simple|single image|affiche|poster|post|publication)\b/],
  ["Text post", /\b(texte?|text|thread)\b/],
];

export function normalizeFormat(raw: string | null | undefined): string | null {
  const n = normalizeText(raw);
  if (!n) return null;
  for (const [label, re] of FORMAT_RULES) if (re.test(n)) return label;
  return titleCase(n);
}

export type StatusGroup = "published" | "planned" | "idea" | "cancelled" | "unknown";

export function statusGroup(raw: string | null | undefined): StatusGroup {
  const n = normalizeText(raw);
  if (!n) return "unknown";
  if (/\b(non publie|not published|unpublished|annule|cancel+ed|abandonne|supprime)\b/.test(n)) return "cancelled";
  if (/\b(publie|publiee|published|posted|poste|en ligne|live|done|fait|termine|ok|oui|yes|منشور)\b/.test(n)) return "published";
  if (/\b(planifie|planifiee|planned|prevu|prevue|programme|programmee|scheduled|a publier|en attente|todo|to do|valide|approved)\b/.test(n)) return "planned";
  if (/\b(idee|idea|brouillon|draft|en cours|in progress|a faire)\b/.test(n)) return "idea";
  return "unknown";
}
