import "server-only";
import { z } from "zod";
import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { WEEKDAY_LABELS, type PlatformTiming } from "@/lib/calendar/insights";

export const postDraftSchema = z.object({
  title: z.string().describe("Internal title for the calendar"),
  format: z.string().describe("e.g. Carousel, Reel, Image post, Story, Video, Live"),
  hook: z.string().describe("First line the audience sees"),
  caption: z.string().describe("Full caption, written for this platform"),
  cta: z.string(),
  hashtags: z.array(z.string()).describe("Without #; none for formats/platforms where hashtags don't help"),
  creative_brief: z.string().describe("What the visual or video shows, slide by slide or shot by shot, for the designer"),
  suggested_time: z.string().nullable().describe("HH:MM local time, only if supported by the timing data provided; else null"),
  rationale: z.string().describe("Why this post, citing the strategy and the performance data given"),
  notes: z.object({ assumptions: z.array(z.string()), questions: z.array(z.string()) }),
});
export type PostDraft = z.infer<typeof postDraftSchema>;

const PLATFORM_RULES: Partial<Record<Platform, string>> = {
  instagram:
    "Instagram: hook in the first line (it is cut after ~125 characters), short paragraphs, emojis only if the brand voice uses them, 5-10 relevant hashtags, CTA adapted to Instagram (no clickable links in captions: point to the link in bio, a DM keyword, a save or a comment).",
  facebook:
    "Facebook: a link may be included in the caption, 0-3 hashtags, a clear CTA, slightly longer explanatory text is fine; questions that invite comments work well for community posts.",
};

export const POST_SYSTEM_PROMPT = `You are the brand's senior social media copywriter, working inside its editorial calendar.
Rules:
- Use the brand identity, tone of voice, audience, personas and strategy provided. Write in the project's default content language (for Tunisian Arabic/Derja projects, captions in Derja with French school terms where students use them).
- Base decisions on the performance data when it is provided; never invent statistics, results or testimonials. If a detail is unknown (teacher name, price, date of a live), leave a clear placeholder like [nom du professeur] and list it in notes.assumptions.
- Do not repeat recent posts listed; find a new angle when the topic is recurring.
- Never claim the post will be or has been published.`;

export function buildPostPrompt(input: {
  context: string;
  performance: string;
  timing: PlatformTiming | undefined;
  platform: Platform;
  pillar: { name: string; description: string | null } | null;
  funnel: FunnelStage | null;
  format: string | null;
  date: string | null;
  weekday: number | null;
  recent: { title: string; scheduled_date: string | null; platform: string | null }[];
  existing: { title: string; caption: string | null; hook: string | null } | null;
  instruction?: string;
}) {
  const timing = input.timing
    ? [
        `Ranking metric: interactions per post (likes + comments + shares + saves), median ${input.timing.baseline}, ${input.timing.posts} timed posts.`,
        `By weekday: ${input.timing.weekdays.map((w) => `${w.label} ×${w.lift ?? "?"} (n=${w.n})`).join(", ")}`,
        `By time window: ${input.timing.hours.map((h) => `${h.label} ×${h.lift ?? "?"} (n=${h.n})`).join(", ")}`,
        `Best slots: ${input.timing.suggestions.map((s) => `${s.label} ×${s.lift} (n=${s.n})`).join("; ") || "none with enough posts"}`,
      ].join("\n")
    : "No publication-time data for this platform: set suggested_time to null.";
  return [
    input.existing ? "# Task: rewrite this existing post (keep its intent, improve it)" : "# Task: write one new post",
    `Platform: ${PLATFORM_LABELS[input.platform]}. ${PLATFORM_RULES[input.platform] ?? ""}`,
    `Content pillar: ${input.pillar ? `${input.pillar.name}: ${input.pillar.description ?? ""}` : "choose the most relevant pillar for the goal"}`,
    `Funnel stage: ${input.funnel ? FUNNEL_LABELS[input.funnel] : "choose what fits"}`,
    `Format: ${input.format ?? "choose the format that performs best for this platform in the data"}`,
    input.date ? `Planned date: ${input.date}${input.weekday != null ? ` (${WEEKDAY_LABELS[input.weekday]})` : ""}` : "",
    input.instruction ? `Instruction from the user: ${input.instruction}` : "",
    input.existing ? `\n# Existing post\nTitle: ${input.existing.title}\nHook: ${input.existing.hook ?? "-"}\nCaption: ${input.existing.caption ?? "-"}` : "",
    "\n# Project context and strategy",
    input.context,
    "\n# Historical performance (raw metrics from the connected accounts; scores calculated)",
    input.performance,
    "\n# Publication-time data for this platform (calculated from real post timestamps)",
    timing,
    "\n# Recent posts in the calendar (avoid repeating them)",
    input.recent.map((r) => `- ${r.scheduled_date ?? "undated"} ${r.platform ?? ""}: ${r.title}`).join("\n") || "(none)",
  ].filter(Boolean).join("\n");
}
