import { describe, expect, it } from "vitest";
import { normalizeSerpApi } from "@/lib/serp/normalize";
import { classifyIntent, compareSnapshots, contentTypeOf, domainStats, pagesSummary, slugify } from "@/lib/serp/analysis";
import { contentTokens } from "@/lib/history/text";
import { robotsAllows } from "@/lib/serp/robots";

// Shape of SerpApi's Google engine response (fields as documented), with neutral example values
const informational = {
  search_metadata: { id: "abc123" },
  search_information: { total_results: 125000 },
  answer_box: { type: "organic_result", title: "Cours informatique", link: "https://exemple-cours.tn/informatique", snippet: "Le programme comprend…" },
  organic_results: [
    { position: 1, title: "Cours informatique Bac — résumé PDF", link: "https://www.exemple-cours.tn/cours/informatique-bac", snippet: "…", displayed_link: "exemple-cours.tn" },
    { position: 2, title: "Comment réviser l'informatique", link: "https://blog.exemple.com/2026/05/reviser-informatique", snippet: "…" },
    { position: 3, title: "Vidéo : algorithmique bac", link: "https://www.youtube.com/watch?v=x", snippet: "…" },
    { position: 4, title: "Informatique — Wikipédia", link: "https://fr.wikipedia.org/wiki/Informatique", snippet: "…" },
  ],
  related_questions: [{ question: "Comment réussir le bac info ?", snippet: "…", link: "https://a.tn/x" }, { question: "Quel programme ?" }],
  related_searches: [{ query: "bac info pdf" }, { query: "exercices algorithmique" }],
  inline_videos: [{ position: 1, title: "Algo", link: "https://www.youtube.com/watch?v=y", channel: { name: "Prof" }, duration: "12:01" }],
};
const commercial = {
  organic_results: [
    { position: 1, title: "Cours particuliers à Tunis — tarifs", link: "https://profs.tn/tarifs", snippet: "…" },
    { position: 2, title: "Inscription soutien scolaire", link: "https://ecole.tn/inscription", snippet: "…" },
    { position: 3, title: "Meilleurs centres de soutien", link: "https://annuaire.tn/liste-centres", snippet: "…" },
  ],
  ads: [{ position: 1, title: "Profs à domicile", link: "https://ads.tn", description: "…" }],
  local_results: { places: [{ position: 1, title: "Centre X", address: "Tunis", rating: 4.6, reviews: 120 }] },
};

describe("SerpApi normalisation", () => {
  const n = normalizeSerpApi(informational);
  it("keeps every element with its type, position and domain", () => {
    expect(n.items.filter((i) => i.type === "organic").map((i) => i.domain)).toEqual(["exemple-cours.tn", "blog.exemple.com", "youtube.com", "fr.wikipedia.org"]);
    expect(n.items.filter((i) => i.type === "people_also_ask")).toHaveLength(2);
    expect(n.items.find((i) => i.type === "video")?.data.channel).toBe("Prof");
    expect(n.totalResults).toBe(125000);
    expect(n.providerSearchId).toBe("abc123");
    expect(n.features.sort()).toEqual(["featured_snippet", "people_also_ask", "related_search", "video"]);
  });
  it("handles local results as an object or an array, and missing sections", () => {
    expect(normalizeSerpApi(commercial).items.filter((i) => i.type === "local")[0]).toMatchObject({ title: "Centre X", data: { rating: 4.6, reviews: 120 } });
    expect(normalizeSerpApi({}).items).toEqual([]);
  });

  it("keeps the AI Overview text and the pages it cites, as its own feature", () => {
    const n = normalizeSerpApi({
      ai_overview: {
        text_blocks: [{ type: "paragraph", snippet: "Le bac informatique comprend…" }, { type: "list", list: [{ title: "Algorithmique", snippet: "Python." }] }],
        references: [{ title: "ReviserBac", link: "https://www.reviserbac.tn/info", source: "ReviserBac" }],
      },
    });
    expect(n.features).toEqual(["ai_overview"]);
    expect(n.items[0]).toMatchObject({ type: "other", snippet: "Le bac informatique comprend…\nAlgorithmique Python.", data: { kind: "ai_overview", content_fetched: true, references: [{ domain: "reviserbac.tn" }] } });
    expect(normalizeSerpApi({ ai_overview: { page_token: "x" } }).items[0].data).toMatchObject({ content_fetched: false, references: [] });
  });
});

describe("SERP analysis", () => {
  it("detects content types from URLs and titles", () => {
    expect(contentTypeOf({ url: "https://www.youtube.com/watch?v=x", domain: "youtube.com", title: "x" })).toBe("video");
    expect(contentTypeOf({ url: "https://profs.tn/tarifs", domain: "profs.tn", title: "x" })).toBe("commercial_page");
    expect(contentTypeOf({ url: "https://a.tn/cours/maths", domain: "a.tn", title: "x" })).toBe("course_page");
    expect(contentTypeOf({ url: "https://a.tn/", domain: "a.tn", title: "x" })).toBe("homepage");
    expect(contentTypeOf({ url: "https://a.tn/doc.pdf", domain: "a.tn", title: "x" })).toBe("document");
  });
  it("infers intent from the SERP, not only the keyword", () => {
    const info = classifyIntent("cours informatique bac tunisien", normalizeSerpApi(informational).items);
    expect(info.primary).toBe("informational");
    expect(info.signals[0].reason).toMatch(/top results|snippet|People also ask/);
    // same commercial-looking words, but the SERP decides: here ads, local pack and offer pages
    const comm = classifyIntent("cours particuliers bac informatique tunisie", normalizeSerpApi(commercial).items);
    expect(["commercial", "transactional"]).toContain(comm.primary);
    // the same keyword on an informational SERP stays informational
    expect(classifyIntent("cours particuliers bac informatique tunisie", normalizeSerpApi(informational).items).primary).toBe("informational");
  });
  it("aggregates domains across snapshots and compares two snapshots", () => {
    const a = normalizeSerpApi(informational).items;
    const b = normalizeSerpApi({ organic_results: [{ position: 1, title: "Comment réviser", link: "https://blog.exemple.com/2026/05/reviser-informatique" }, { position: 2, title: "New", link: "https://new.tn/x" }], ads: [{ title: "ad", link: "https://ads.tn" }] }).items;
    const d = domainStats([{ analysisId: "1", keyword: "k1", items: a }, { analysisId: "2", keyword: "k2", items: b }]);
    expect(d[0]).toMatchObject({ domain: "blog.exemple.com", keywords: ["k1", "k2"], best: 1 });
    const c = compareSnapshots(a, b);
    expect(c.rows.find((r) => r.domain === "blog.exemple.com")).toMatchObject({ a: 2, b: 1, change: 1 });
    expect(c.rows.find((r) => r.domain === "new.tn")).toMatchObject({ a: null, b: 2 });
    expect(c.featuresAdded).toEqual(["ad"]);
    expect(c.overlap).toBe(1);
  });
  it("shows shared heading topics as the pages wrote them, not as folded tokens", () => {
    const page = (domain: string, h: string) => ({ ok: true, domain, position: 1, words: 300, headings: [{ level: 2, text: h }], has_faq: false, schema: [], content_type: "page" as const });
    const s = pagesSummary([page("a.tn", "Cours de Français et autres matières"), page("b.tn", "Le français, les autres langues")], null, contentTokens);
    expect(s.commonTopics.map((t) => t.topic)).toEqual(expect.arrayContaining(["français", "autres"]));
  });

  it("makes readable slugs, Arabic included", () => {
    expect(slugify("Cours d'informatique : Bac 2026 !")).toBe("cours-d-informatique-bac-2026");
    expect(slugify("مراجعة البكالوريا")).toBe("مراجعة-البكالوريا");
  });
});

describe("robots.txt", () => {
  const txt = "User-agent: *\nDisallow: /admin\nDisallow: /*.pdf$\nAllow: /admin/public\n\nUser-agent: SignalBot\nDisallow: /private";
  it("applies our own group first, else the wildcard group, longest rule winning", () => {
    expect(robotsAllows(txt, "/private/x")).toBe(false);
    expect(robotsAllows(txt, "/admin")).toBe(true); // our group has no /admin rule
    expect(robotsAllows("User-agent: *\nDisallow: /admin\nAllow: /admin/public", "/admin/x")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /admin\nAllow: /admin/public", "/admin/public/a")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/a/b.pdf")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/a/b.pdf?x")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
});
