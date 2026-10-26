import "server-only";
import { z } from "zod";
import { FUNNEL_LABELS, FUNNEL_STAGES, INSIGHT_TYPES, PLATFORMS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";

const rating = z.object({ score: z.number().int().min(0).max(100), reason: z.string().describe("One sentence, specific to this idea") });

const opportunityShape = z.object({
  title: z.string().describe("The content idea as an actionable title (what to post), not a vague goal"),
  rationale: z.string().describe("Why it matters for this business now, referring to the cited signals by their content, not by key"),
  target_audience: z.string().describe("Specific audience segment; use a persona name when one fits"),
  persona: z.string().nullable().describe("Exact persona name from the strategy, or null"),
  business_objective: z.string().describe("The business objective this idea serves, in a few words (from the strategy when written)"),
  campaign: z.string().nullable().describe("Exact name of an active campaign it belongs to, or null"),
  pillar: z.string().nullable().describe("Exact content pillar name from the strategy, or null"),
  funnel_stage: z.enum(FUNNEL_STAGES),
  platform: z.enum(PLATFORMS),
  format: z.string().describe("Reel, Carousel, Image post, Story, Video, Live, Text post…"),
  hook: z.string().describe("Opening line the audience sees first, in the content language"),
  angle: z.string().describe("The specific perspective that makes it interesting"),
  cta: z.string(),
  signals: z.array(z.string()).describe("Keys (S1, S2…) of the signals this idea is built on; empty if none applies"),
  insight_type: z.enum(INSIGHT_TYPES).describe("data_supported only when cited signals directly support it; hypothesis when reasoned; experiment for a deliberate test"),
  assumptions: z.array(z.string()).describe("What is assumed and not shown by the data"),
  suggested_timing: z.string().nullable().describe("When to publish, only from a cited timing signal or a dated campaign/season; else null"),
  ratings: z.object({
    strategic: rating.describe("Fit with business/marketing objectives and positioning"),
    audience: rating.describe("Relevance to the target audience and personas"),
    platform: rating.describe("Fit of the format and idea with the platform"),
    differentiation: rating.describe("How it stands apart from competitors (use competitor signals; 50 when none)"),
  }),
});

export const opportunitiesSchema = z.object({
  opportunities: z.array(opportunityShape),
  notes: z.object({ assumptions: z.array(z.string()), questions: z.array(z.string()) }),
});
export const singleOpportunitySchema = z.object({ opportunity: opportunityShape });
export type GeneratedOpportunity = z.infer<typeof opportunityShape>;

export const OPPORTUNITY_SYSTEM_PROMPT = `You are a senior social media strategist building a prioritised backlog of content opportunities for one brand, inside its marketing SaaS.
Rules:
- Facts come only from the numbered signals (S1, S2…). They were calculated from the brand's real posts, strategy and imported competitor posts. Never write a number, percentage or result that is not in a signal you cite. Never claim competitor engagement unless a competitor signal gives counts.
- Cite signal keys only in "signals". In texts, describe the evidence in words ("carousels do better on Instagram") instead of keys.
- Every idea must be specific: a concrete subject, audience, angle, hook, format and CTA for this business. No generic advice ("post more engaging content", "use storytelling").
- Use exact pillar and persona names from the strategy, or null.
- Label honestly: data_supported only when cited signals support the idea directly; hypothesis when it is reasoned from strategy or patterns; experiment when it is a deliberate test. Put what you assume in "assumptions".
- Ratings are your judgment (0-100) with a one-sentence reason specific to the idea; they are shown to the user as AI judgments.
- Do not repeat or lightly reword ideas listed as existing, and respect the team's feedback: avoid what they marked not relevant, already covered or not aligned; do more of what they marked useful.
- Write titles, hooks and CTAs in the project's default content language (Tunisian Derja with French school terms for Tunisian Arabic projects); rationale and reasons may be in French.`;

export function buildOpportunitiesPrompt(input: {
  context: string;
  signals: string;
  existing: { title: string; platform: string | null; state: string }[];
  feedback: { title: string; kind: string; note: string | null }[];
  count: number;
  focus: { pillar: string | null; platform: Platform | null; funnel: FunnelStage | null; instruction: string | null };
  target?: { title: string; rationale: string; hook: string | null; angle: string | null; instruction: string | null };
}) {
  const f = input.focus;
  const focus = [
    f.pillar ? `Content pillar: ${f.pillar}` : "",
    f.platform ? `Platform: ${PLATFORM_LABELS[f.platform]}` : "",
    f.funnel ? `Funnel stage: ${FUNNEL_LABELS[f.funnel]}` : "",
    f.instruction ? `Instruction from the user: ${f.instruction}` : "",
  ].filter(Boolean);
  return [
    "# Task",
    input.target
      ? `Rewrite this one opportunity${input.target.instruction ? ` following the instruction: ${input.target.instruction}` : " with a clearly different, stronger angle"}. Keep it specific and grounded in the signals.\nCurrent version: "${input.target.title}" — ${input.target.rationale}${input.target.hook ? `\nHook: ${input.target.hook}` : ""}${input.target.angle ? `\nAngle: ${input.target.angle}` : ""}`
      : `Propose ${input.count} distinct content opportunities. Mix: build on what demonstrably works, fix strategic gaps (missing or under-target pillars, unused formats), refresh proven past posts, and 1-2 experiments. Spread them across platforms, pillars and funnel stages unless a focus is set.`,
    focus.length ? `\n# Focus (every idea must respect it)\n${focus.join("\n")}` : "",
    "\n# Brand, audience and strategy",
    input.context,
    "\n# Signals (calculated facts; cite by key)",
    input.signals,
    "\n# Existing opportunities (do not duplicate)",
    input.existing.map((e) => `- ${e.title}${e.platform ? ` (${e.platform})` : ""} [${e.state}]`).join("\n") || "(none)",
    "\n# Team feedback on earlier ideas",
    input.feedback.map((x) => `- ${x.kind}: "${x.title}"${x.note ? ` — ${x.note}` : ""}`).join("\n") || "(none yet)",
  ].join("\n");
}
