import "server-only";
import { z } from "zod";
import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";

// Editorial engine prompts. The plan and slots are calculated; the model writes the content of each slot, following
// platform conventions, and judges near-duplicate pairs. Facts come only from cited signals.

export const EDITORIAL_SYSTEM_PROMPT = `You are a senior content strategist and copywriter writing one brand's editorial calendar inside its marketing SaaS.
Rules:
- Each slot (P1, P2…) has a fixed date, platform, pillar, funnel stage, format and campaign: write content for exactly that slot. Do not change them.
- Platform conventions. Facebook: educational posts, community discussion questions, promotional posts; longer captions are fine when useful. Instagram: visual hooks, concise captions, reels, carousels, stories. Website / blog: SEO articles, educational resources, landing pages, FAQ pages, written as a brief (keyword, title, outline), not as a social caption.
- Never reuse the same caption or hook on two slots, even across platforms: adapt the idea to each platform.
- Recurring topics are allowed, but every post needs a distinct purpose and angle (e.g. revision technique, corrected exercise, common mistake, teacher advice, exam checklist). Do not repeat an angle from the recent posts listed.
- Use an assigned opportunity (O1, O2…) when one is given for the slot; build on it, do not copy its title verbatim.
- Facts, numbers and results come only from the numbered signals (S1, S2…). Never invent statistics, prices, dates or testimonials; leave [placeholders] for details the brand must fill in.
- The rationale says in one or two sentences why this post is in the plan (objective, pillar, signal, date). Say "not performance-validated" when no signal supports it.
- Reels: opening hook (first 2 seconds), a short script, 3-6 scenes, on-screen text lines, CTA. Carousels: cover title, 5-8 slides, final CTA slide. Stories: 3-5 frames. Articles: target keyword, SEO title, meta description, H1, H2/H3 outline.
- Write in the project's default content language (Tunisian Derja with French school terms for Tunisian Arabic projects).`;

const scene = z.object({ visual: z.string(), voiceover: z.string(), on_screen_text: z.string() });
const slide = z.object({ title: z.string(), body: z.string() });

export const weekContentSchema = z.object({
  items: z.array(z.object({
    slot: z.string().describe("Slot key, e.g. P4"),
    opportunity: z.string().nullable().describe("Opportunity key used (O2…), or null"),
    title: z.string().describe("Internal title of the post"),
    topic: z.string(),
    hook: z.string().describe("First line / first seconds the audience sees"),
    angle: z.string().describe("The specific angle or purpose that makes this post different"),
    cta: z.string(),
    caption: z.string().describe("Social: the full caption. Website: a short content brief (what the page covers and for whom)"),
    hashtags: z.array(z.string()),
    creative_direction: z.string().describe("Visual direction for the designer / video maker"),
    rationale: z.string(),
    signals: z.array(z.string()).describe("Signal keys this post relies on; empty if none"),
    reel: z.object({ opening_hook: z.string(), script: z.string(), scenes: z.array(scene), cta: z.string() }).nullable().describe("Only for Reel / Video / Short formats"),
    carousel: z.object({ cover_title: z.string(), slides: z.array(slide), final_cta: z.string() }).nullable().describe("Only for Carousel formats"),
    story: z.object({ frames: z.array(z.object({ text: z.string(), visual: z.string() })) }).nullable().describe("Only for Story formats"),
    article: z.object({ target_keyword: z.string(), seo_title: z.string(), meta_description: z.string(), h1: z.string(), outline: z.array(z.object({ h2: z.string(), h3: z.array(z.string()) })) }).nullable().describe("Only for website / blog formats"),
  })),
});
export type WeekContent = z.infer<typeof weekContentSchema>["items"][number];

export type PromptSlot = { key: string; date: string; weekday: string; platform: Platform; format: string; pillar: string | null; funnel: FunnelStage; campaign: string | null; occasion: string | null; opportunity: string | null; kpi: string };

export function buildWeekPrompt(i: {
  context: string; objective: string; signals: string; learnings: string; opportunities: string; slots: PromptSlot[];
  recent: string[]; planned: string[]; instruction?: string | null; missing: string[];
}) {
  return [
    "# Task",
    `Write the content of these ${i.slots.length} calendar slots. Business objective of the month: ${i.objective}.`,
    i.instruction ? `Instruction from the user: ${i.instruction}` : "",
    "\n# Slots (fixed: write one item per slot)",
    i.slots.map((s) => `${s.key} | ${s.date} (${s.weekday}) | ${PLATFORM_LABELS[s.platform]} | ${s.format} | pillar: ${s.pillar ?? "-"} | funnel: ${FUNNEL_LABELS[s.funnel]} (judged on ${s.kpi}) | campaign: ${s.campaign ?? "-"}${s.occasion ? ` | occasion: ${s.occasion}` : ""}${s.opportunity ? ` | use opportunity ${s.opportunity}` : ""}`).join("\n"),
    "\n# Brand, audience and strategy",
    i.context,
    "\n# Opportunities assigned to slots",
    i.opportunities || "(none)",
    "\n# Signals relevant to these slots (calculated facts; cite by key)",
    i.signals || "(no signal: write strategy-based content and say it is not performance-validated)",
    "\n# What published calendar posts taught us",
    i.learnings || "(no published calendar post with metrics yet)",
    i.missing.length ? `\n# Data not available (do not pretend it exists)\n${i.missing.join("\n")}` : "",
    "\n# Already planned in this calendar (other weeks, locked posts): do not repeat their angle",
    i.planned.slice(0, 80).map((t) => `- ${t}`).join("\n") || "(none)",
    "\n# Recent posts (last months): do not repeat their angle or hook",
    i.recent.slice(0, 60).map((t) => `- ${t}`).join("\n") || "(none)",
  ].filter(Boolean).join("\n");
}

export const repetitionSchema = z.object({
  pairs: z.array(z.object({
    pair: z.string().describe("Pair key, e.g. R3"),
    verdict: z.enum(["repeat", "different_angle"]).describe("repeat = same purpose/angle for the same audience; different_angle = same topic but a meaningfully different purpose, format or benefit"),
    note: z.string().describe("One short sentence"),
  })),
});

export const REPETITION_SYSTEM_PROMPT = `You check an editorial calendar for repetition. For each pair of posts, decide whether the second repeats the first (same purpose and angle for the same audience, even if worded differently) or covers the same topic from a meaningfully different angle (technique vs corrected exercise vs common mistake vs checklist…). Recurring topics are fine; repeated angles are not. Answer for every pair.`;
