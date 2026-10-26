import "server-only";
import { z } from "zod";
import { FUNNEL_STAGES } from "@/lib/domain/constants";
import { INTENTS, type IntentResult, type PagesSummary } from "@/lib/serp/analysis";
import type { SerpItem } from "@/lib/serp/normalize";

export const SEO_KINDS = ["keyword_target", "topic", "improve_page", "content_gap", "long_tail", "faq", "cluster", "pillar_page"] as const;
export const SEO_KIND_LABELS: Record<(typeof SEO_KINDS)[number], string> = {
  keyword_target: "Keyword to target", topic: "Topic to create", improve_page: "Existing page to improve", content_gap: "Content gap",
  long_tail: "Long-tail keyword", faq: "FAQ opportunity", cluster: "Content cluster", pillar_page: "Pillar page",
};
export const WEB_FORMATS = ["SEO article", "Landing page", "Educational resource", "FAQ page", "Topic cluster"] as const;

export const SEO_SYSTEM_PROMPT = `You are a senior SEO strategist for a brand inside its marketing SaaS.
Rules:
- SERP facts come only from the numbered items provided (R = organic result, Q = "People also ask", S = related search, F = featured snippet, P = ranking page structure). Never invent rankings, search volumes, traffic or difficulty scores: they are not provided.
- Cite refs only in "refs"; in texts, describe results in words.
- Recommendations are AI suggestions: be specific to this brand, its audience, pillars and market (country, language). No generic SEO advice.
- Never copy competitors' titles, headings or text. Use them to understand what the search expects, then propose an original, better angle for the brand.
- Write titles, H1/H2/H3, meta descriptions and questions in the SERP's language (French or Arabic as given; Tunisian Derja only if the SERP itself uses it).`;

export function serpDigest(items: SerpItem[], pages: { position: number | null; url: string; ok: boolean; title: string | null; h1: string | null; headings: { level: number; text: string }[]; words: number | null; has_faq: boolean; content_type: string; error: string | null }[]) {
  const refs = new Map<string, SerpItem | (typeof pages)[number]>();
  const lines: string[] = [];
  const org = items.filter((i) => i.type === "organic").sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  org.forEach((o, k) => { refs.set(`R${k + 1}`, o); lines.push(`R${k + 1} | #${o.position} | ${o.domain} | ${o.title ?? ""} | ${(o.snippet ?? "").slice(0, 160)}`); });
  items.filter((i) => i.type === "featured_snippet").forEach((f, k) => { refs.set(`F${k + 1}`, f); lines.push(`F${k + 1} | featured snippet | ${f.domain ?? ""} | ${(f.snippet ?? f.title ?? "").slice(0, 200)}`); });
  items.filter((i) => i.type === "people_also_ask").forEach((q, k) => { refs.set(`Q${k + 1}`, q); lines.push(`Q${k + 1} | question | ${q.title}`); });
  items.filter((i) => i.type === "related_search").forEach((s, k) => { refs.set(`S${k + 1}`, s); lines.push(`S${k + 1} | related search | ${s.title}`); });
  for (const t of ["local", "video", "image", "top_story", "ad", "shopping", "knowledge_graph"] as const) {
    const list = items.filter((i) => i.type === t);
    if (list.length) lines.push(`${t}: ${list.length} (${list.slice(0, 4).map((i) => i.title).filter(Boolean).join("; ")})`);
  }
  pages.forEach((p, k) => {
    refs.set(`P${k + 1}`, p);
    lines.push(p.ok
      ? `P${k + 1} | #${p.position} | ${p.content_type} | ${p.words} words | H1: ${p.h1 ?? "-"} | H2/H3: ${p.headings.slice(0, 15).map((h) => `${h.level === 3 ? "  " : ""}${h.text}`).join(" / ")}${p.has_faq ? " | has FAQ" : ""}`
      : `P${k + 1} | #${p.position} | ${p.content_type} | not read: ${p.error}`);
  });
  return { text: lines.join("\n"), refs };
}

export function marketDigest(input: { keyword: string; country: string; language: string; device: string; intent: IntentResult; summary: PagesSummary | null; ownDomain: string | null }) {
  const s = input.summary;
  return [
    `Keyword: "${input.keyword}" · country ${input.country} · language ${input.language} · ${input.device}`,
    `Intent (calculated from the SERP): ${input.intent.primary}${input.intent.secondary ? ` (secondary ${input.intent.secondary})` : ""}; signals: ${input.intent.signals.slice(0, 6).map((x) => `${x.reason} (+${x.points} ${x.intent})`).join("; ")}`,
    s ? `Ranking pages read: ${s.pagesRead}/${s.pagesTotal}; median ${s.medianWords ?? "?"} words (${s.minWords ?? "?"}–${s.maxWords ?? "?"}); median ${s.medianHeadings ?? "?"} H2/H3; ${s.faqShare ?? "?"}% have a FAQ; content types: ${s.contentTypes.map((c) => `${c.label} ${c.n}`).join(", ")}; topics in headings of 2+ sites: ${s.commonTopics.map((t) => t.topic).join(", ") || "-"}` : "",
    `Our website: ${input.ownDomain ?? "not set in the project"}${s?.ownPosition ? `, ranking #${s.ownPosition}` : input.ownDomain ? ", not in the results analysed" : ""}`,
  ].filter(Boolean).join("\n");
}

const statement = z.object({ text: z.string(), basis: z.enum(["serp_data", "ai_recommendation"]).describe("serp_data only when the cited items show it"), refs: z.array(z.string()) });
export const serpInsightSchema = z.object({
  summary: z.string(),
  intent: z.object({ primary: z.enum(INTENTS), agrees_with_calculated: z.boolean(), rationale: z.string() }),
  competitors: z.array(statement).describe("Who ranks and with what kind of content"),
  content_patterns: z.array(statement).describe("Structure, depth, formats, recurring subtopics"),
  gaps: z.array(statement).describe("What the ranking pages miss, and where our brand can do better"),
  vs_our_site: z.array(statement).describe("Comparison with our website and marketing strategy"),
});
export type SerpInsight = z.infer<typeof serpInsightSchema>;

export const seoOpportunitiesSchema = z.object({
  opportunities: z.array(z.object({
    kind: z.enum(SEO_KINDS),
    keyword: z.string(),
    intent: z.enum(INTENTS),
    content_type: z.enum(WEB_FORMATS),
    title: z.string().describe("Suggested page title"),
    slug: z.string().describe("lowercase-words-with-hyphens, no domain"),
    outline: z.array(z.string()).describe("5-10 sections"),
    persona: z.string().nullable().describe("Exact persona name from the strategy, or null"),
    pillar: z.string().nullable().describe("Exact pillar name from the strategy, or null"),
    funnel_stage: z.enum(FUNNEL_STAGES),
    rationale: z.string(),
    refs: z.array(z.string()).describe("SERP refs supporting it (R/Q/S/F/P)"),
  })),
});
export type SeoOpportunity = z.infer<typeof seoOpportunitiesSchema>["opportunities"][number];

export const briefSchema = z.object({
  primary_keyword: z.string(),
  secondary_keywords: z.array(z.string()),
  search_intent: z.enum(INTENTS),
  target_audience: z.string(),
  content_type: z.enum(WEB_FORMATS),
  seo_title: z.string().describe("max 60 characters"),
  meta_description: z.string().describe("max 155 characters"),
  slug: z.string(),
  h1: z.string(),
  outline: z.array(z.object({ h2: z.string(), h3: z.array(z.string()), notes: z.string() })),
  questions: z.array(z.string()).describe("Questions the page must answer (from People also ask when present)"),
  entities: z.array(z.string()).describe("Entities and subtopics to cover"),
  internal_links: z.array(z.object({ anchor: z.string(), target: z.string().describe("Page on our site (existing URL or a page to create)") })),
  cta: z.string(),
  word_count_target: z.number().int().describe("Based on the ranking pages' median length when available"),
  competitor_observations: z.array(z.object({ observation: z.string(), refs: z.array(z.string()) })),
  differentiation: z.string().describe("How our page will be more useful than the ranking pages"),
});
export type SeoBrief = z.infer<typeof briefSchema>;

export const draftSchema = z.object({ markdown: z.string().describe("The full article in Markdown, following the brief's H1/H2/H3"), notes: z.array(z.string()).describe("Facts to verify or details to complete ([placeholders])") });

export function briefMarkdown(b: SeoBrief) {
  return [
    `# ${b.h1}`,
    `SEO title: ${b.seo_title}`,
    `Meta description: ${b.meta_description}`,
    `URL: /${b.slug}`,
    `Primary keyword: ${b.primary_keyword} · Secondary: ${b.secondary_keywords.join(", ")}`,
    `Intent: ${b.search_intent} · Audience: ${b.target_audience} · ${b.content_type} · ~${b.word_count_target} words`,
    "",
    ...b.outline.flatMap((s) => [`## ${s.h2}`, ...s.h3.map((h) => `### ${h}`), s.notes ? `> ${s.notes}` : ""]),
    "",
    "Questions to answer:", ...b.questions.map((q) => `- ${q}`),
    "Entities and subtopics:", ...b.entities.map((e) => `- ${e}`),
    "Internal links:", ...b.internal_links.map((l) => `- ${l.anchor} → ${l.target}`),
    `CTA: ${b.cta}`,
    `Differentiation: ${b.differentiation}`,
  ].filter((l) => l !== undefined).join("\n");
}
