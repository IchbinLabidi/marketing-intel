import { normalizeText } from "@/lib/history/text";
import { featureOf, type SerpItem } from "./normalize";

// Deterministic SERP analytics. The intent is inferred from what Google actually shows (features and the kind of
// pages ranking), with the keyword's wording as a weak signal only. Every point carries its reason.

export const INTENTS = ["informational", "commercial", "transactional", "navigational"] as const;
export type Intent = (typeof INTENTS)[number];
export const INTENT_LABELS: Record<Intent, string> = { informational: "Informational", commercial: "Commercial", transactional: "Transactional", navigational: "Navigational" };

export type ContentType =
  | "article" | "course_page" | "commercial_page" | "homepage" | "listing" | "video" | "social" | "forum" | "encyclopedia" | "document" | "page";
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  article: "Article / guide", course_page: "Course / lesson page", commercial_page: "Offer / pricing / sign-up page", homepage: "Homepage",
  listing: "Listing / category", video: "Video", social: "Social media", forum: "Forum / Q&A", encyclopedia: "Encyclopedia", document: "PDF / document", page: "Other page",
};

const has = (s: string, re: RegExp) => re.test(s);

/** Content type from the URL, domain and title (calculated, rule-based). */
export function contentTypeOf(i: Pick<SerpItem, "url" | "domain" | "title">): ContentType {
  const url = (i.url ?? "").toLowerCase();
  const d = i.domain ?? "";
  const t = normalizeText(i.title);
  let path = "/";
  try { path = new URL(i.url ?? "").pathname.toLowerCase(); } catch { /* keep "/" */ }
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com)$/.test(d) || /\/(watch|video|videos)\b/.test(path)) return "video";
  if (/(^|\.)(facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com|pinterest\.)/.test(d)) return "social";
  if (/(^|\.)(reddit\.com|quora\.com|stackexchange\.com|stackoverflow\.com)$/.test(d) || /forum|\/questions?\//.test(url)) return "forum";
  if (/wikipedia\.org$|wiktionary\.org$/.test(d)) return "encyclopedia";
  if (/\.(pdf|docx?|pptx?)(\?|$)/.test(url)) return "document";
  if (path === "/" || /^\/(fr|ar|en)\/?$/.test(path)) return "homepage";
  if (has(path, /(tarif|prix|pricing|price|inscription|register|signup|sign-up|abonnement|subscribe|offre|offer|checkout|panier|cart|shop|boutique|produit|product)/) || has(t, /\b(prix|tarif|inscri|offre|promo|abonnement)/)) return "commercial_page";
  if (has(path, /(cours|course|lecon|lesson|chapitre|chapter|matiere|module|formation|training|exercice|exercise)/)) return "course_page";
  if (has(path, /(blog|article|actualit|news|guide|conseil|tips|post|\d{4}\/\d{2})/) || has(t, /\b(comment|pourquoi|guide|conseils|astuces|how|why|what)\b/)) return "article";
  if (has(path, /(category|categorie|tag|liste|list|annuaire|directory|search|recherche)/) || has(t, /\b(meilleurs?|top \d+|liste)\b/)) return "listing";
  return "page";
}

export type IntentResult = { primary: Intent; secondary: Intent | null; scores: Record<Intent, number>; signals: { intent: Intent; points: number; reason: string }[]; basis: "serp" };

/** SERP-based intent. Features and ranking page types weigh more than the keyword text. */
export function classifyIntent(keyword: string, items: SerpItem[], ownDomain?: string | null): IntentResult {
  const signals: IntentResult["signals"] = [];
  const add = (intent: Intent, points: number, reason: string) => signals.push({ intent, points, reason });
  const count = (t: SerpItem["type"]) => items.filter((i) => i.type === t).length;
  const organic = items.filter((i) => i.type === "organic").sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(0, 10);

  if (count("featured_snippet")) add("informational", 2, "Google shows a featured snippet (a direct answer)");
  if (count("people_also_ask")) add("informational", 2, `"People also ask" with ${count("people_also_ask")} questions`);
  if (count("video")) add("informational", 1, `${count("video")} video results`);
  if (count("knowledge_graph")) add("navigational", 1, "A knowledge panel is shown");
  if (items.some((i) => featureOf(i) === "ai_overview")) add("informational", 1, "Google shows an AI Overview (an answer above the results)");
  if (count("ad")) { add("commercial", 2, `${count("ad")} ads: advertisers pay for this query`); add("transactional", 1, "Ads indicate purchase intent"); }
  if (count("shopping")) add("transactional", 3, "Shopping results are shown");
  if (count("local")) { add("commercial", 2, `Local pack with ${count("local")} places`); add("transactional", 1, "Local businesses to contact or visit"); }

  const types = organic.map((o) => contentTypeOf(o));
  const share = (pred: (t: ContentType) => boolean) => (organic.length ? types.filter(pred).length / organic.length : 0);
  const infoShare = share((t) => ["article", "encyclopedia", "forum", "video", "document", "course_page"].includes(t));
  const commShare = share((t) => ["commercial_page", "listing", "homepage"].includes(t));
  if (infoShare >= 0.5) add("informational", Math.round(infoShare * 4), `${Math.round(infoShare * 100)}% of the top results are articles, lessons, videos, documents or Q&A`);
  if (commShare >= 0.3) add("commercial", Math.round(commShare * 4), `${Math.round(commShare * 100)}% of the top results are offer pages, listings or homepages`);
  if (share((t) => t === "commercial_page") >= 0.3) add("transactional", 2, "Several top results are sign-up, pricing or offer pages");

  const top3 = organic.slice(0, 3).map((o) => o.domain).filter(Boolean);
  if (top3.length === 3 && new Set(top3).size === 1) add("navigational", 3, `The top 3 results all belong to ${top3[0]}`);
  if (organic[0]?.data?.sitelinks) add("navigational", 2, `The first result (${organic[0].domain}) has sitelinks`);

  const k = normalizeText(keyword);
  if (/\b(comment|pourquoi|c est quoi|definition|qu est ce|exercices?|corrige|pdf|resume|cours|lecon|methode|how|what|why)\b/.test(k)) add("informational", 1, "Keyword wording: learning / how-to terms");
  if (/\b(meilleurs?|avis|comparatif|top|vs|prix|tarifs?|particuliers?|prof|professeur|centre|ecole|plateforme)\b/.test(k)) add("commercial", 1, "Keyword wording: comparing providers or services");
  if (/\b(inscription|acheter|reserver|abonnement|commander|essai gratuit|s inscrire|payer|offre)\b/.test(k)) add("transactional", 1, "Keyword wording: sign-up or purchase terms");
  if (ownDomain && k.replace(/\s/g, "").includes(ownDomain.split(".")[0])) add("navigational", 2, "The keyword contains the brand's own name");

  const scores = Object.fromEntries(INTENTS.map((i) => [i, signals.filter((s) => s.intent === i).reduce((t, s) => t + s.points, 0)])) as Record<Intent, number>;
  const ranked = [...INTENTS].sort((a, b) => scores[b] - scores[a]);
  const primary = scores[ranked[0]] > 0 ? ranked[0] : "informational";
  const secondary = scores[ranked[1]] > 0 && scores[ranked[1]] >= scores[ranked[0]] * 0.6 ? ranked[1] : null;
  return { primary, secondary, scores, signals: signals.sort((a, b) => b.points - a.points), basis: "serp" };
}

/** Domains across several snapshots: how often and how high they rank (organic results only). */
export function domainStats(snapshots: { analysisId: string; keyword: string; items: SerpItem[] }[]) {
  const map = new Map<string, { domain: string; appearances: number; keywords: Set<string>; positions: number[]; best: number }>();
  for (const s of snapshots) {
    for (const o of s.items.filter((i) => i.type === "organic" && i.domain)) {
      const e = map.get(o.domain!) ?? { domain: o.domain!, appearances: 0, keywords: new Set<string>(), positions: [], best: 99 };
      e.appearances++;
      e.keywords.add(s.keyword);
      if (o.position != null) { e.positions.push(o.position); e.best = Math.min(e.best, o.position); }
      map.set(o.domain!, e);
    }
  }
  return [...map.values()]
    .map((e) => ({ domain: e.domain, appearances: e.appearances, keywords: [...e.keywords], avgPosition: e.positions.length ? Math.round((e.positions.reduce((a, b) => a + b, 0) / e.positions.length) * 10) / 10 : null, best: e.best === 99 ? null : e.best }))
    .sort((a, b) => b.keywords.length - a.keywords.length || (a.avgPosition ?? 99) - (b.avgPosition ?? 99));
}

/** Two snapshots (another date, device or language): organic positions by URL, entering and leaving results. */
export function compareSnapshots(a: SerpItem[], b: SerpItem[]) {
  const pos = (items: SerpItem[]) => new Map(items.filter((i) => i.type === "organic" && i.url).map((i) => [i.url!.replace(/[?#].*$/, "").replace(/\/$/, ""), i]));
  const A = pos(a), B = pos(b);
  const rows = [...new Set([...A.keys(), ...B.keys()])].map((url) => {
    const x = A.get(url), y = B.get(url);
    return { url, domain: (x ?? y)!.domain, title: (y ?? x)!.title, a: x?.position ?? null, b: y?.position ?? null, change: x?.position != null && y?.position != null ? x.position - y.position : null };
  }).sort((p, q) => (p.b ?? 99) - (q.b ?? 99) || (p.a ?? 99) - (q.a ?? 99));
  const fa = new Set(a.filter((i) => i.type !== "organic").map(featureOf)), fb = new Set(b.filter((i) => i.type !== "organic").map(featureOf));
  return {
    rows,
    overlap: rows.filter((r) => r.a != null && r.b != null).length,
    featuresAdded: [...fb].filter((f) => !fa.has(f)),
    featuresRemoved: [...fa].filter((f) => !fb.has(f)),
  };
}

type PageLike = { ok: boolean; domain: string | null; position: number | null; content_type: ContentType; words: number | null; headings: { level: number; text: string }[]; has_faq: boolean; schema: string[] };

/** Calculated from the pages actually read: length, structure and recurring heading topics. */
export function pagesSummary(pages: PageLike[], ownDomain: string | null, tokens: (s: string) => string[]) {
  const read = pages.filter((p) => p.ok);
  const words = read.map((p) => p.words ?? 0).filter((w) => w > 0).sort((a, b) => a - b);
  const median = words.length ? words[Math.floor(words.length / 2)] : null;
  const topicPages = new Map<string, Set<string>>();
  for (const p of read) for (const t of new Set(p.headings.flatMap((h) => tokens(h.text)))) topicPages.set(t, (topicPages.get(t) ?? new Set()).add(p.domain ?? ""));
  // tokens are folded ("français" → "francai"): show the word as the pages wrote it most often
  const surface = new Map<string, Map<string, number>>();
  for (const w of read.flatMap((p) => p.headings.flatMap((h) => h.text.toLocaleLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)))) {
    const t = tokens(w)[0];
    if (t) surface.set(t, (surface.get(t) ?? new Map()).set(w, (surface.get(t)?.get(w) ?? 0) + 1));
  }
  const word = (t: string) => [...(surface.get(t) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? t;
  const own = ownDomain ? pages.find((p) => p.domain === ownDomain || p.domain?.endsWith(`.${ownDomain}`)) : null;
  const types = new Map<ContentType, number>();
  for (const p of pages) types.set(p.content_type, (types.get(p.content_type) ?? 0) + 1);
  return {
    pagesRead: read.length,
    pagesTotal: pages.length,
    medianWords: median,
    minWords: words[0] ?? null,
    maxWords: words.at(-1) ?? null,
    medianHeadings: read.length ? [...read.map((p) => p.headings.length)].sort((a, b) => a - b)[Math.floor(read.length / 2)] : null,
    faqShare: read.length ? Math.round((read.filter((p) => p.has_faq).length / read.length) * 100) : null,
    schemaTypes: [...new Set(read.flatMap((p) => p.schema))].slice(0, 12),
    contentTypes: [...types].map(([type, n]) => ({ type, label: CONTENT_TYPE_LABELS[type], n })).sort((a, b) => b.n - a.n),
    /** heading words used by 2+ different ranking sites */
    commonTopics: [...topicPages].filter(([, d]) => d.size >= 2).map(([topic, d]) => ({ topic: word(topic), sites: d.size })).sort((a, b) => b.sites - a.sites).slice(0, 20),
    ownPosition: own?.position ?? null,
  };
}
export type PagesSummary = ReturnType<typeof pagesSummary>;

export const FEATURE_LABELS: Record<string, string> = {
  organic: "Organic results", featured_snippet: "Featured snippet", people_also_ask: "People also ask", related_search: "Related searches",
  local: "Local pack", image: "Images", video: "Videos", top_story: "Top stories", knowledge_graph: "Knowledge panel", ad: "Ads", shopping: "Shopping", ai_overview: "AI Overview", other: "Other",
};

export function slugify(text: string) {
  return normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
