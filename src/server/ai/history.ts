import "server-only";
import { z } from "zod";
import { FUNNEL_STAGES, INSIGHT_TYPES, METRIC_LABELS, PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { effectiveDate, type AnalysisItem, type HistoricalStats } from "@/lib/history/analysis";
import { ENGAGEMENT_FORMULA, type PlatformPerformance } from "@/lib/history/performance";
import type { SeasonWindow } from "@/lib/history/seasons";

const notes = z.object({
  assumptions: z.array(z.string()).describe("Assumptions made because information was missing"),
  questions: z.array(z.string()).describe("Questions whose answers would most improve the output"),
});

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------
export const pdfExtractionSchema = z.object({
  columns: z.array(z.string()).describe("Column headers as written in the document, or descriptive names if the table has none"),
  rows: z.array(z.array(z.string())).describe("One array per content item, cells aligned with columns; empty string when unreadable"),
  reliability: z.enum(["high", "medium", "low"]).describe("How faithfully the table could be transcribed"),
  notes: z.array(z.string()).describe("Anything the user must check: merged cells, unreadable parts, dates composed from a month header…"),
});

export const PDF_SYSTEM_PROMPT = `You transcribe editorial calendars from PDF documents into a table, for a data import tool.
Rules:
- Transcribe only. Never invent, complete, correct or summarise content. If a cell is unreadable, output an empty string and say so in notes.
- One row per planned or published content item. Keep the original column headers and wording, in the original language.
- Keep dates as written. If the calendar is a month grid where cells only show a day number, compose the full date from the month/year header (format YYYY-MM-DD) and state that in notes.
- Keep status words exactly as written (e.g. "publié", "prévu"). Never mark an item as published unless the document says so.
- If the document is not an editorial calendar or has no table, return no rows, reliability "low", and explain in notes.`;

export const PDF_PROMPT = "Extract every content item from this editorial calendar as a table.";

// ---------------------------------------------------------------------------
// Compact serialisation of history for prompts. Items get short refs (H1, H2…) the model cites as evidence.
// ---------------------------------------------------------------------------
const MAX_PROMPT_ITEMS = 400;

export function historyDigest(items: AnalysisItem[], pillarName: (id: string) => string | undefined, priorityIds: Set<string> = new Set()) {
  const byDate = (a: AnalysisItem, b: AnalysisItem) => (effectiveDate(a) ?? "9999").localeCompare(effectiveDate(b) ?? "9999");
  const sorted = [...items].sort(byDate);
  const step = sorted.length > MAX_PROMPT_ITEMS ? sorted.length / MAX_PROMPT_ITEMS : 1;
  // Items cited by the statistics (top posts, refresh candidates…) are always included so their refs resolve.
  const priority = sorted.filter((i) => priorityIds.has(i.id));
  const rest = sorted.filter((i) => !priorityIds.has(i.id));
  const room = Math.max(0, MAX_PROMPT_ITEMS - priority.length);
  const restStep = rest.length > room ? rest.length / Math.max(1, room) : 1;
  const sample = step === 1 ? sorted : [...priority, ...Array.from({ length: Math.min(room, rest.length) }, (_, k) => rest[Math.floor(k * restStep)])].sort(byDate);
  const refs = new Map<string, string>(); // ref -> item id
  const lines = sample.map((i, k) => {
    const ref = `H${k + 1}`;
    refs.set(ref, i.id);
    const metrics = Object.entries(METRIC_LABELS)
      .filter(([m]) => i[m as keyof AnalysisItem] != null)
      .map(([m, label]) => `${label.toLowerCase()}=${i[m as keyof AnalysisItem]}`)
      .join(" ");
    return [
      ref,
      effectiveDate(i) ?? "no date",
      i.platform ? PLATFORM_LABELS[i.platform as Platform] : "?",
      i.format ?? "?",
      `pillar: ${i.pillar_id ? pillarName(i.pillar_id) : i.content_pillar ?? "-"}`,
      i.campaign ? `campaign: ${i.campaign}` : "",
      i.publication_status ? `status: ${i.publication_status}` : "status: not recorded",
      [i.title, i.topic].filter(Boolean).join(" — ") || (i.caption ?? "").slice(0, 120),
      metrics,
    ].filter(Boolean).join(" | ");
  });
  const note = step === 1 ? "" : `(Evenly spaced sample of ${MAX_PROMPT_ITEMS} out of ${items.length} items; statistics below cover all items.)`;
  return { text: [note, ...lines].filter(Boolean).join("\n"), refs };
}

/** Statistics block for prompts: the deterministic facts the model must build on. */
export function statsDigest(stats: HistoricalStats, refOf: (id: string) => string | undefined) {
  const s = stats;
  const fmt = (rows: { label: string; count: number; share: number }[]) => rows.slice(0, 12).map((r) => `${r.label} ${r.count} (${r.share}%)`).join("; ");
  return [
    `Items: ${s.totals.items} (dated ${s.totals.dated}); period ${s.totals.start ?? "?"} → ${s.totals.end ?? "?"}; ${s.frequency.perWeek ?? "?"} posts/week.`,
    `Status as imported: published ${s.totals.status.published}, planned ${s.totals.status.planned}, idea ${s.totals.status.idea}, cancelled ${s.totals.status.cancelled}, not recorded/unclear ${s.totals.status.unknown}. Planned items are NOT published items.`,
    `By month: ${s.byMonth.map((m) => `${m.month}:${m.count}`).join(", ") || "-"}`,
    `By platform: ${fmt(s.byPlatform)}`,
    `By format: ${fmt(s.byFormat)}`,
    `By pillar: ${fmt(s.byPillar)}`,
    `Pillar balance vs strategy targets: ${s.pillarBalance.map((p) => `${p.name}: actual ${p.actual}% vs target ${p.target ?? "none"}% (${p.status})`).join("; ") || "no strategy pillars"}`,
    `Formats not used on active platforms: ${s.formatGaps.map((g) => `${g.label}: ${g.missing.join(", ")}`).join("; ") || "none"}`,
    `Low months: ${s.frequency.lowMonths.map((m) => `${m.month} (${m.count} vs median ${m.median})`).join(", ") || "none"}`,
    `Silent gaps (21+ days): ${s.frequency.silentGaps.map((g) => `${g.from}→${g.to} (${g.days}d)`).join(", ") || "none"}`,
    `Repetition clusters: ${s.repetitions.slice(0, 15).map((c) => `[${c.kind}] "${c.label}" ×${c.ids.length} (${c.ids.map(refOf).filter(Boolean).slice(0, 6).join(",")})`).join("; ") || "none"}`,
    `Campaign themes: ${s.campaignThemes.map((c) => `${c.name} (${c.posts} posts, ${c.schoolYears.join("/")})`).join("; ") || "none"}`,
    `Seasonality (index = posting rate vs period average): ${s.seasons.map((x) => `${x.label}: ${x.pattern}${x.years.length ? ` [${x.years.map((y) => `${y.schoolYear} ×${y.index}`).join(", ")}]` : ""}`).join("; ")}`,
    s.metrics.coverage.length
      ? `Performance metrics imported: ${s.metrics.coverage.map((m) => `${METRIC_LABELS[m.metric]} on ${m.values} items`).join(", ")}. Averages by format: ${s.metrics.byFormat.map((m) => `${METRIC_LABELS[m.metric]}: ${m.rows.map((r) => `${r.format} ${r.average} (n=${r.n})`).join(", ")}`).join("; ") || "too few values"}.`
      : "Performance metrics imported: NONE. You must not say any content performed well or badly.",
  ].join("\n");
}

/** Calculated performance per platform, for prompts. Says explicitly when there is none. */
export function performanceDigest(perf: PlatformPerformance[], refOf: (id: string) => string | undefined) {
  if (!perf.length) return "No performance metrics are available (fewer than 3 posts with interaction counts per platform). Do not claim anything performed well or badly.";
  return perf
    .map((p) => {
      const unit = p.metric === "engagement_rate" ? "engagement rate % of reach" : "engagements";
      const g = (rows: { label: string; n: number; medianScore: number | null; lift: number | null }[]) =>
        rows.slice(0, 8).map((r) => `${r.label} (n=${r.n}, median ${r.medianScore}, ×${r.lift ?? "?"})`).join("; ") || "-";
      return [
        `### ${p.label}: ${p.posts} posts with metrics; ranking metric = ${unit} (calculated: ${ENGAGEMENT_FORMULA}); median ${p.baseline}`,
        `Top posts: ${p.top.slice(0, 8).map((t) => `${refOf(t.id) ?? "?"} "${(t.title ?? "").slice(0, 70)}" ${t.format ?? ""} score ${t.score}`).join(" | ")}`,
        `Weakest posts: ${p.bottom.map((t) => `${refOf(t.id) ?? "?"} "${(t.title ?? "").slice(0, 50)}" score ${t.score}`).join(" | ")}`,
        `By format: ${g(p.byFormat)}`,
        `By pillar: ${g(p.byPillar)}`,
        `Topics (word-level, lift vs median): ${p.topics.map((t) => `${t.topic} ×${t.lift} (n=${t.n})`).join(", ") || "-"}`,
        `Hook patterns: ${g(p.hooks.patterns)}`,
        `CTA types detected in captions: ${g(p.ctas)}`,
        `Refresh candidates (old top-quartile posts): ${p.refreshCandidates.map((r) => `${refOf(r.id) ?? "?"} "${(r.title ?? "").slice(0, 50)}" (${r.date})`).join(" | ") || "-"}`,
        `Monthly median trend: ${p.trend.map((t) => `${t.month}:${t.median ?? "n<2"}`).join(", ")}`,
      ].join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Pillar classification of posts (AI assignment, always labelled as such)
// ---------------------------------------------------------------------------
export const pillarClassificationSchema = z.object({
  assignments: z.array(z.object({ ref: z.string(), pillar: z.string().nullable().describe("Exact pillar name, or null when no pillar fits") })),
});

export const PILLAR_SYSTEM_PROMPT = `You classify social media posts into a brand's content pillars.
Use only the pillar names provided, exactly as written. Return null when a post fits none of them. Do not guess from missing text: posts without a caption get null.`;

export function buildPillarPrompt(pillars: { name: string; description: string | null }[], posts: { ref: string; text: string }[]) {
  return [
    "# Pillars",
    pillars.map((p) => `- ${p.name}: ${p.description ?? ""}`).join("\n"),
    "\n# Posts (ref | text)",
    posts.map((p) => `${p.ref} | ${p.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n"),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------
export const RECOMMENDATION_CATEGORIES = ["topic", "refresh", "format_test", "pillar", "seasonal", "campaign", "repurpose"] as const;

export const recommendationsSchema = z.object({
  recommendations: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      category: z.enum(RECOMMENDATION_CATEGORIES),
      insight_type: z.enum(INSIGHT_TYPES).describe("data_supported only when the evidence is imported rows/statistics; hypothesis when reasoned; experiment for deliberate creative bets"),
      evidence: z.array(
        z.object({
          kind: z.enum(["historical_item", "statistic", "strategy"]),
          refs: z.array(z.string()).describe("H-refs of the historical items cited; empty for statistics/strategy"),
          note: z.string(),
        }),
      ),
      pillar: z.string().nullable().describe("Exact name of a strategy content pillar, or null"),
      format: z.string(),
      platform: z.enum(PLATFORMS).nullable(),
      funnel_stage: z.enum(FUNNEL_STAGES).nullable(),
      persona: z.string().nullable().describe("Exact name of a strategy persona, or null"),
      timing: z.string().describe("When to publish, e.g. 'Early September (back to school)'"),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
  topic_gaps: z.array(z.object({ topic: z.string(), why: z.string(), pillar: z.string().nullable() })).describe("Strategy-relevant topics the history has not covered"),
  notes,
});
export type RecommendationsOutput = z.infer<typeof recommendationsSchema>;

export const HISTORY_SYSTEM_PROMPT = `You are a senior content strategist analysing a brand's past editorial calendars inside a marketing SaaS.
Rules:
- Separate facts from interpretation. Facts come only from the statistics and items provided. Label each recommendation:
  data_supported (grounded in cited items or statistics), hypothesis (reasoned from strategy + patterns), experiment (a deliberate creative bet).
- Never claim a post performed well or poorly unless performance metrics are listed as imported. Never invent numbers.
- A planned item is not a published item. Only say something was published when its status says so.
- Recurring educational topics (e.g. exam revision every year) are normal and often desirable. Flag repetition only when the same angle and format repeat closely, and then suggest a fresh angle rather than dropping the topic.
- Cite evidence with the H-refs provided, only inside evidence.refs (and repurpose_of). Never write H-refs or R-refs in titles, explanations, briefs or rationales: readers don't see them; describe the item (date, title) instead.
- Use exact pillar and persona names from the strategy, or null.
- Be specific to this business and its audience. No generic marketing filler.
- Write in the project's default content language (French for Tunisian Arabic projects unless asked otherwise).`;

export function buildRecommendationsPrompt(input: { context: string; stats: string; performance: string; items: string; instruction?: string }) {
  return [
    "# Task",
    "Produce 8-14 actionable recommendations from this history, covering: topics to explore, angles to refresh, formats to test, underused pillars, seasonal opportunities, campaigns to plan, and content to repurpose. Then list strategy-relevant topics the history has not covered.",
    "Where performance metrics exist, prioritise what the data shows works (formats, topics, hooks, CTAs) for each platform separately, and say which numbers support it. Correlation in past posts is not proof of cause: phrase such links as hypotheses to test unless the pattern is strong and consistent.",
    input.instruction ? `\nAdditional instruction from the user: ${input.instruction}` : "",
    "\n# Project context and strategy",
    input.context,
    "\n# Statistics computed from the imported history (facts)",
    input.stats,
    "\n# Performance (raw metrics from the source; scores below are calculated)",
    input.performance,
    "\n# Imported items",
    input.items,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Calendar generation
// ---------------------------------------------------------------------------
export const calendarDraftSchema = z.object({
  items: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD within the requested period"),
      platform: z.enum(PLATFORMS),
      title: z.string(),
      format: z.string(),
      pillar: z.string().nullable().describe("Exact strategy pillar name or null"),
      campaign: z.string().nullable().describe("Exact strategy campaign name or null"),
      funnel_stage: z.enum(FUNNEL_STAGES).nullable(),
      hook: z.string(),
      brief: z.string().describe("2-3 sentences: what the content shows and says"),
      cta: z.string(),
      rationale: z.string().describe("Why this item, citing the history or strategy"),
      repurpose_of: z.string().nullable().describe("H-ref of a past item this refreshes or repurposes, or null"),
      recommendation: z.string().nullable().describe("R-ref of the recommendation this implements, or null"),
    }),
  ),
  notes,
});
export type CalendarDraftOutput = z.infer<typeof calendarDraftSchema>;

export function buildCalendarPrompt(input: {
  context: string;
  stats: string;
  performance: string;
  items: string;
  start: string;
  end: string;
  platforms: { platform: Platform; perWeek: number }[];
  expectedItems: number;
  windows: SeasonWindow[];
  recommendations: string;
  instruction?: string;
}) {
  return [
    "# Task",
    `Plan an editorial calendar from ${input.start} to ${input.end} (inclusive) with about ${input.expectedItems} items.`,
    `Platforms and rhythm: ${input.platforms.map((p) => `${PLATFORM_LABELS[p.platform]} ${p.perWeek}/week`).join(", ")}. Use only these platforms. Spread items evenly; avoid stacking several on the same day per platform.`,
    "Requirements:",
    "- Follow the strategy and respect the content pillar target shares across the whole calendar.",
    "- Avoid repeating recent angles listed in the repetition clusters; refresh them instead. Recurring educational topics are fine with a new angle.",
    "- Use the seasonal windows below where relevant (school calendar / Ramadan only if relevant to this brand).",
    "- Use the history's gaps (missing pillars, untested formats, quiet periods) to propose new topics.",
    "- Where performance data exists, give more slots to the formats, topics, hooks and CTAs that performed best on each platform, and refresh top past posts rather than repeating weak ones. Keep a few experiments.",
    "- Keep the brand voice. Write titles, hooks, briefs and CTAs in the project's default content language.",
    "- Never promise performance. Set repurpose_of / recommendation refs only when the item really builds on them.",
    input.instruction ? `\nAdditional instruction from the user: ${input.instruction}` : "",
    "\n# Seasonal windows in this period (approximate dates)",
    input.windows.map((w) => `- ${w.label}: ${w.start} → ${w.end}`).join("\n") || "(none)",
    "\n# Recommendations from the historical analysis",
    input.recommendations || "(none generated yet)",
    "\n# Project context and strategy",
    input.context,
    "\n# Historical statistics (facts)",
    input.stats,
    "\n# Performance (raw metrics from the source; scores are calculated)",
    input.performance,
    "\n# Historical items",
    input.items,
  ].join("\n");
}
