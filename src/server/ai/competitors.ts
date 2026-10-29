import "server-only";
import { z } from "zod";
import { FUNNEL_STAGES, INSIGHT_TYPES, PLATFORMS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import type { Summary } from "@/lib/competitors/analysis";

const basis = z.enum(["fact", "hypothesis"]).describe("fact = directly shown by the statistics or cited posts; hypothesis = your interpretation");
const statement = (categories: readonly [string, ...string[]]) =>
  z.object({ category: z.enum(categories), text: z.string(), basis, refs: z.array(z.string()).describe("C-refs of the posts that support it (required for facts about posts)") });

export const competitorAnalysisSchema = z.object({
  summary: z.string().describe("3-4 sentences: who they are on social media and what works for them"),
  strategy: z.array(statement(["pillar", "topic", "positioning", "tone", "format", "frequency", "promotional", "educational", "community"])),
  performance: z.array(statement(["best_post", "outlier", "topic", "hook", "cta", "format", "timing"])),
  weaknesses: z.array(statement(["repetition", "underused_format", "missing_topic", "weak_coverage", "differentiation"])),
  notes: z.object({ assumptions: z.array(z.string()), data_limits: z.array(z.string()) }),
});
export type CompetitorAnalysis = z.infer<typeof competitorAnalysisSchema>;

const rating = z.object({ score: z.number().int().min(0).max(100), reason: z.string() });
export const gapAnalysisSchema = z.object({
  gaps: z.array(z.object({
    type: z.enum(["they_cover_we_dont", "we_cover_they_ignore", "underrepresented_pillar", "funnel_stage", "format", "differentiation"]),
    title: z.string(),
    evidence: z.string().describe("What in the data shows it, in words (numbers only from the statistics)"),
    refs: z.array(z.string()).describe("C-refs of supporting competitor posts"),
    why: z.string(),
    audience: z.string(),
    pillar: z.string().nullable().describe("Exact pillar name from our strategy, or null"),
    funnel_stage: z.enum(FUNNEL_STAGES).nullable(),
    platform: z.enum(PLATFORMS).nullable(),
    basis,
  })),
  ideas: z.array(z.object({
    title: z.string().describe("An original content idea for OUR brand"),
    rationale: z.string(),
    inspired_by: z.array(z.string()).describe("C-refs of the competitor posts that inspired it"),
    original_angle: z.string().describe("What makes our version different and ours"),
    how_it_differs: z.string().describe("How it differs from the competitor posts (never a copy)"),
    hook: z.string(), format: z.string(), platform: z.enum(PLATFORMS), cta: z.string(),
    pillar: z.string().nullable(), persona: z.string().nullable(), funnel_stage: z.enum(FUNNEL_STAGES),
    insight_type: z.enum(INSIGHT_TYPES),
    ratings: z.object({ strategic: rating, audience: rating, platform: rating, differentiation: rating }),
  })),
  notes: z.object({ assumptions: z.array(z.string()), data_limits: z.array(z.string()) }),
});
export type GapAnalysis = z.infer<typeof gapAnalysisSchema>;

export const COMPETITOR_SYSTEM_PROMPT = `You are a senior social media strategist analysing competitors for a brand inside its marketing SaaS.
Rules:
- Facts come only from the statistics and the numbered competitor posts (C1, C2…) provided. Never invent numbers, posts, followers or results. If a metric is listed as unavailable, do not discuss it.
- Label every statement: basis "fact" only when the statistics or cited posts show it directly (cite the C-refs); otherwise "hypothesis".
- Judge performance with "lift" (engagement ÷ the account's own median), not raw likes: big and small accounts are compared to themselves.
- Cite C-refs only in "refs"/"inspired_by"; in texts, describe posts by date and topic.
- Ideas are for OUR brand: original, in our tone, for our audience and pillars. Never copy or lightly rephrase competitor captions, hooks or scripts; take the underlying need or structure and make it ours.
- Write in the project's default content language for hooks and CTAs (Tunisian Derja with French school terms for Tunisian Arabic projects); analysis text may be in French.`;

export function summaryDigest(label: string, s: Summary) {
  const g = (rows: { label: string; n: number; share: number; medianLift: number | null }[], k = 8) => rows.slice(0, k).map((r) => `${r.label} ${r.n} (${r.share}%, lift ×${r.medianLift ?? "?"})`).join("; ") || "-";
  return [
    `### ${label}: ${s.posts} posts, ${s.perWeek ?? "?"} per week, ${s.firstDate?.slice(0, 10) ?? "?"} → ${s.lastDate?.slice(0, 10) ?? "?"}`,
    `Public metrics available: ${s.metrics.filter((m) => m.posts).map((m) => `${m.metric} on ${m.posts} posts`).join(", ") || "none"}; unavailable: ${s.metrics.filter((m) => !m.posts).map((m) => m.metric).join(", ") || "none"}`,
    `Platforms: ${g(s.byPlatform)}`,
    `Formats: ${g(s.byFormat)}`,
    `Topics (content words): ${g(s.topics, 15)}`,
    `Hashtags: ${g(s.hashtags, 12)}`,
    `Hook patterns: ${s.hooks.map((h) => `${h.label} ${h.n} (×${h.medianLift ?? "?"})`).join("; ") || "-"}`,
    `CTAs: ${g(s.ctas)}`,
    `Weekdays: ${g(s.byWeekday, 7)}`,
    `Posts at 2× or more the account median: ${s.outliers}`,
  ].join("\n");
}

export function buildCompetitorPrompt(input: { context: string; competitor: string; profiles: string; stats: string; posts: string; ads?: string }) {
  return [
    "# Task",
    `Analyse the competitor "${input.competitor}": content strategy (pillars, recurring topics, positioning, tone, formats, frequency, promotional / educational / community strategy), performance (best posts and outliers vs their own baseline, topics with repeated engagement, successful hooks, effective CTAs, stronger formats, timing) and weaknesses (repetition, underused formats, missing topics, weak coverage, openings for differentiation).`,
    "\n# Our brand (for context only: judge the competitor, don't describe us)",
    input.context,
    "\n# Competitor profiles (public data)",
    input.profiles,
    "\n# Statistics (calculated from collected posts)",
    input.stats,
    "\n# Posts (ref | platform | date | format | hook | public metrics | lift vs own median)",
    input.posts,
    ...(input.ads ? ["\n# Paid ads recorded from Meta Ad Library (separate from organic posts; no reach or spend available; a long-running ad suggests it works for them, but that is a hypothesis)", input.ads] : []),
  ].join("\n");
}

export function buildGapPrompt(input: { context: string; ours: string; competitors: string; posts: string; existing: string[]; count: number }) {
  return [
    "# Task",
    "Compare our brand with these competitors and identify content gaps: topics they cover that we don't, topics we cover that they ignore, our under-represented pillars, funnel stages they address more, formats we rarely use, and differentiation openings. For each gap say what it is, the competitor data supporting it, why it matters, the audience, our pillar, the funnel stage and the best platform.",
    `Then propose ${input.count} original content ideas for OUR brand inspired by the strongest competitor posts or gaps (cite them in inspired_by). Do not recommend copying competitors.`,
    "\n# Our brand, strategy and audience",
    input.context,
    "\n# Our own content (calculated from our synced posts)",
    input.ours,
    "\n# Competitors (calculated from collected posts)",
    input.competitors,
    "\n# Notable competitor posts (ref | competitor | platform | date | format | hook | metrics | lift)",
    input.posts,
    "\n# Existing opportunities (don't repeat)",
    input.existing.map((t) => `- ${t}`).join("\n") || "(none)",
  ].join("\n");
}

export const platformLabel = (p: string | null) => (p ? PLATFORM_LABELS[p as Platform] ?? p : "?");
