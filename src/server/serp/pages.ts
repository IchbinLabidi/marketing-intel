import "server-only";
import { parse } from "node-html-parser";
import { robotsAllows } from "@/lib/serp/robots";
import { contentTypeOf, type ContentType } from "@/lib/serp/analysis";
import type { SerpItem } from "@/lib/serp/normalize";

// Reads the public pages that rank (from the SERP links), politely: robots.txt respected, one request per page,
// short timeout, size cap, no login, no JavaScript. Only structure is kept (title, headings, length, schema types),
// never the full text, so briefs are informed by competitors without copying them.

const UA = "SignalBot/1.0 (SEO content research; +https://localhost)";
const MAX_BYTES = 2_000_000;

export type RankingPage = {
  position: number | null; url: string; domain: string | null; content_type: ContentType;
  ok: boolean; error: string | null; title: string | null; meta_description: string | null; h1: string | null;
  headings: { level: 2 | 3; text: string }[]; words: number | null; schema: string[]; has_faq: boolean; images: number | null; lang: string | null;
};

async function fetchText(url: string, timeout = 10_000) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return { text: await res.text(), type: res.headers.get("content-type") ?? "" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), type: res.headers.get("content-type") ?? "" };
}

const robotsCache = new Map<string, string>();
async function allowed(url: URL) {
  const origin = url.origin;
  if (!robotsCache.has(origin)) {
    try { robotsCache.set(origin, (await fetchText(`${origin}/robots.txt`, 5000)).text); } catch { robotsCache.set(origin, ""); }
  }
  return robotsAllows(robotsCache.get(origin)!, url.pathname + url.search);
}

export async function analyzePage(item: SerpItem): Promise<RankingPage> {
  const base: RankingPage = {
    position: item.position, url: item.url!, domain: item.domain, content_type: contentTypeOf(item),
    ok: false, error: null, title: item.title, meta_description: null, h1: null, headings: [], words: null, schema: [], has_faq: false, images: null, lang: null,
  };
  if (["video", "social", "document"].includes(base.content_type)) return { ...base, error: "Not an HTML article (video, social or document): SERP data only." };
  let url: URL;
  try { url = new URL(item.url!); } catch { return { ...base, error: "Invalid URL" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ...base, error: "Unsupported URL" };
  if (!(await allowed(url))) return { ...base, error: "Blocked by the site's robots.txt: not read." };
  try {
    const { text, type } = await fetchText(url.toString());
    if (!/html/i.test(type)) return { ...base, error: "Not an HTML page" };
    const root = parse(text, { comment: false, blockTextElements: { script: true, style: true, noscript: false, pre: true } });
    const schema = root.querySelectorAll('script[type="application/ld+json"]').flatMap((s) => {
      try {
        const j = JSON.parse(s.text);
        const list = Array.isArray(j) ? j : j["@graph"] ?? [j];
        return list.flatMap((x: { "@type"?: string | string[] }) => (Array.isArray(x?.["@type"]) ? x["@type"] : x?.["@type"] ? [x["@type"]] : []));
      } catch { return []; }
    });
    for (const sel of ["script", "style", "nav", "header", "footer", "aside", "noscript", "form"]) root.querySelectorAll(sel).forEach((n) => n.remove());
    const main = root.querySelector("article") ?? root.querySelector("main") ?? root.querySelector("body") ?? root;
    const words = main.text.replace(/\s+/g, " ").trim().split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      ...base, ok: true,
      title: clean(root.querySelector("title")?.text ?? item.title ?? "") || item.title,
      meta_description: root.querySelector('meta[name="description"]')?.getAttribute("content")?.slice(0, 300) ?? null,
      h1: clean(root.querySelector("h1")?.text ?? "") || null,
      headings: main.querySelectorAll("h2, h3").map((h) => ({ level: (h.tagName === "H2" ? 2 : 3) as 2 | 3, text: clean(h.text) })).filter((h) => h.text).slice(0, 40),
      words, schema: [...new Set(schema.map(String))].slice(0, 12),
      has_faq: schema.some((s: string) => /FAQPage|QAPage/i.test(String(s))) || main.querySelectorAll("h2, h3").some((h) => /\?\s*$/.test(h.text.trim())),
      images: main.querySelectorAll("img").length,
      lang: root.querySelector("html")?.getAttribute("lang") ?? null,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error && e.name === "TimeoutError" ? "No answer within 10 s" : `Could not read the page (${e instanceof Error ? e.message : "error"})` };
  }
}

/** Top organic pages, read in parallel (max 4 at a time). */
export async function analyzeRankingPages(items: SerpItem[], max = 8) {
  const organic = items.filter((i) => i.type === "organic" && i.url).sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).slice(0, max);
  const out: RankingPage[] = [];
  for (let k = 0; k < organic.length; k += 4) out.push(...(await Promise.all(organic.slice(k, k + 4).map(analyzePage))));
  return out;
}
