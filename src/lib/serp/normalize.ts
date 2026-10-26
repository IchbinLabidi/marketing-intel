// Provider responses → one list of SERP items (stored as returned; nothing is invented or re-ranked).

export type SerpItemType =
  | "organic" | "featured_snippet" | "people_also_ask" | "related_search" | "local" | "image" | "video"
  | "top_story" | "knowledge_graph" | "ad" | "shopping" | "other";

export type SerpItem = { type: SerpItemType; position: number | null; title: string | null; url: string | null; domain: string | null; snippet: string | null; data: Record<string, unknown> };
export type NormalizedSerp = { items: SerpItem[]; totalResults: number | null; providerSearchId: string | null; features: string[] };

/** Feature an item stands for: its type, or for "other" items the kind of block (ai_overview…). */
export const featureOf = (i: Pick<SerpItem, "type" | "data">) => (i.type === "other" && typeof i.data?.kind === "string" ? i.data.kind : i.type);

export function domainOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);

/** SerpApi Google engine response (https://serpapi.com/search-api). */
export function normalizeSerpApi(body: Record<string, unknown>): NormalizedSerp {
  const items: SerpItem[] = [];
  const push = (type: SerpItemType, position: number | null, title: unknown, url: unknown, snippet: unknown, data: Record<string, unknown> = {}) => {
    const u = str(url);
    items.push({ type, position, title: str(title), url: u, domain: domainOf(u), snippet: str(snippet), data });
  };

  for (const o of arr(body.organic_results)) {
    push("organic", num(o.position), o.title, o.link, o.snippet, {
      displayed_link: str(o.displayed_link), date: str(o.date), source: str(o.source),
      sitelinks: Boolean(o.sitelinks), rich_snippet: o.rich_snippet ?? null, snippet_highlighted_words: o.snippet_highlighted_words ?? null,
    });
  }
  const ab = body.answer_box as Record<string, unknown> | undefined;
  if (ab && typeof ab === "object") {
    push("featured_snippet", 0, ab.title ?? ab.answer, ab.link, ab.snippet ?? ab.answer ?? (Array.isArray(ab.list) ? (ab.list as string[]).join(" · ") : null), { answer_type: str(ab.type), list: ab.list ?? null });
  }
  arr(body.related_questions).forEach((q, k) => push("people_also_ask", k + 1, q.question, q.link, q.snippet, { source_title: str(q.title) }));
  arr(body.related_searches).forEach((r, k) => push("related_search", k + 1, r.query, null, null));
  const local = body.local_results as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const places = Array.isArray(local) ? arr(local) : arr((local as Record<string, unknown> | undefined)?.places);
  places.forEach((p, k) => push("local", num(p.position) ?? k + 1, p.title, p.website ?? p.links ?? null, p.address, {
    rating: num(p.rating), reviews: num(p.reviews), type: str(p.type), phone: str(p.phone), place_id: str(p.place_id),
  }));
  [...arr(body.inline_images), ...arr(body.images_results).slice(0, 10)].forEach((i, k) => push("image", k + 1, i.title, i.source ?? i.link, null, { thumbnail: str(i.thumbnail), original: str(i.original) }));
  [...arr(body.inline_videos), ...arr((body as { video_results?: unknown }).video_results).slice(0, 10)].forEach((v, k) => push("video", num(v.position) ?? k + 1, v.title, v.link, null, {
    channel: str(v.channel) ?? str((v.channel as Record<string, unknown> | undefined)?.name), duration: str(v.duration), platform: str(v.platform), date: str(v.date), thumbnail: str(v.thumbnail),
  }));
  arr(body.top_stories).forEach((s, k) => push("top_story", k + 1, s.title, s.link, null, { source: str(s.source), date: str(s.date) }));
  const kg = body.knowledge_graph as Record<string, unknown> | undefined;
  if (kg && typeof kg === "object" && (kg.title || kg.description)) push("knowledge_graph", null, kg.title, kg.website ?? kg.source ?? null, kg.description, { kg_type: str(kg.type) });
  arr(body.ads).forEach((a, k) => push("ad", num(a.position) ?? k + 1, a.title, a.link, a.description, { displayed_link: str(a.displayed_link), block: str(a.block_position) }));
  [...arr(body.shopping_results), ...arr(body.immersive_products)].forEach((s, k) => push("shopping", num(s.position) ?? k + 1, s.title, s.link, null, { price: str(s.price) ?? s.extracted_price ?? null, source: str(s.source) }));

  // Google AI Overview: its text and the pages it cites. Some responses only carry a token (content not fetched).
  const ao = body.ai_overview as Record<string, unknown> | undefined;
  if (ao && typeof ao === "object") {
    const text = arr(ao.text_blocks).flatMap((b) => [str(b.snippet), ...arr(b.list).map((l) => [str(l.title), str(l.snippet)].filter(Boolean).join(" "))]).filter(Boolean).join("\n");
    const refs = arr(ao.references).map((r) => ({ title: str(r.title), link: str(r.link), source: str(r.source), domain: domainOf(str(r.link)) }));
    push("other", null, "AI Overview", null, text ? text.slice(0, 4000) : null, { kind: "ai_overview", references: refs, content_fetched: Boolean(text) });
  }

  const info = body.search_information as Record<string, unknown> | undefined;
  const meta = body.search_metadata as Record<string, unknown> | undefined;
  return {
    items,
    totalResults: num(info?.total_results),
    providerSearchId: str(meta?.id),
    features: [...new Set(items.filter((i) => i.type !== "organic").map(featureOf))],
  };
}
