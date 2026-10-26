// Which data the editorial engine can actually use for a project. Every status is computed from rows that exist;
// a missing source is reported as missing, and the plan and prompts say what is not validated by data.

export type SourceStatus = "available" | "partial" | "missing";
export type SourceKey =
  | "brand" | "business_objectives" | "marketing_objectives" | "personas" | "customer_journey" | "funnel" | "pillars"
  | "brand_voice" | "campaigns" | "historical_performance" | "competitors" | "serp" | "important_dates" | "calendars" | "published";
export type Source = { key: SourceKey; label: string; status: SourceStatus; detail: string; usedFor: string };

export type SourcesInput = {
  brand: { mission?: string | null; personality?: string | null; target_audience?: string | null; differentiators?: string | null; products_services?: unknown[] | null } | null;
  strategy: {
    business_objectives?: string | null; marketing_objectives?: string | null; brand_voice?: Record<string, unknown> | null;
    customer_journey?: unknown[] | null; funnel?: Record<string, string> | null;
  } | null;
  personas: number;
  pillars: { name: string; target_share: number | null }[];
  campaigns: { name: string; starts_on: string | null; ends_on: string | null }[];
  history: { posts: number; withMetrics: number; platforms: string[]; lastDate: string | null };
  competitors: { competitors: number; posts: number; withCounts: number };
  serp: { analyses: number; keywords: number; lastDate: string | null };
  importantDates: number;
  calendars: number;
  published: { verified: number; withMetrics: number };
  period: { start: string; end: string };
};

const filled = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.values(v).some(filled) : Boolean(v));

export function assessSources(i: SourcesInput): Source[] {
  const s = i.strategy;
  const shares = i.pillars.filter((p) => p.target_share != null);
  const inPeriod = i.campaigns.filter((c) => (!c.starts_on || c.starts_on <= i.period.end) && (!c.ends_on || c.ends_on >= i.period.start));
  const st = (ok: boolean, partial = false): SourceStatus => (ok ? "available" : partial ? "partial" : "missing");
  return [
    (() => {
      const b = i.brand;
      const parts = b ? [b.mission, b.personality, b.target_audience, b.differentiators, b.products_services].filter(filled).length : 0;
      return { key: "brand" as const, label: "Brand identity", status: st(parts >= 3, parts > 0), detail: parts ? `${parts} of 5 brand fields filled (mission, personality, audience, differentiators, offer)` : "Brand profile empty", usedFor: "tone, offer and audience in every post" };
    })(),
    { key: "business_objectives", label: "Business objectives", status: st(filled(s?.business_objectives)), detail: filled(s?.business_objectives) ? "Written in the strategy" : "Not written in the strategy", usedFor: "strategic relevance of opportunities" },
    { key: "marketing_objectives", label: "Marketing objectives", status: st(filled(s?.marketing_objectives)), detail: filled(s?.marketing_objectives) ? "Written in the strategy" : "Not written in the strategy", usedFor: "funnel mix and KPIs" },
    { key: "personas", label: "Personas", status: st(i.personas > 0), detail: i.personas ? `${i.personas} persona${i.personas > 1 ? "s" : ""}` : "No persona defined", usedFor: "audience relevance and targeting" },
    { key: "customer_journey", label: "Customer journey", status: st(filled(s?.customer_journey)), detail: filled(s?.customer_journey) ? `${s!.customer_journey!.length} stage(s)` : "Not described", usedFor: "content needs per stage" },
    { key: "funnel", label: "Marketing funnel", status: st(filled(s?.funnel)), detail: filled(s?.funnel) ? `${Object.values(s!.funnel!).filter(filled).length} stage(s) described` : "Not described: the funnel mix follows the month's objective", usedFor: "funnel distribution" },
    { key: "pillars", label: "Content pillars and target shares", status: st(i.pillars.length > 0 && shares.length === i.pillars.length, i.pillars.length > 0), detail: !i.pillars.length ? "No pillar: posts can't be balanced by pillar" : shares.length === i.pillars.length ? `${i.pillars.length} pillars, all with a target share` : `${i.pillars.length} pillars, ${shares.length} with a target share (others share the rest equally)`, usedFor: "pillar distribution" },
    { key: "brand_voice", label: "Brand voice", status: st(filled(s?.brand_voice)), detail: filled(s?.brand_voice) ? "Defined in the strategy" : "Not defined", usedFor: "wording of hooks and captions" },
    { key: "campaigns", label: "Campaigns", status: st(inPeriod.length > 0, i.campaigns.length > 0), detail: inPeriod.length ? `${inPeriod.length} active in this period: ${inPeriod.map((c) => c.name).slice(0, 3).join(", ")}` : i.campaigns.length ? "Campaigns exist, none active in this period" : "No campaign", usedFor: "campaign coverage" },
    { key: "historical_performance", label: "Historical social media performance", status: st(i.history.withMetrics >= 20, i.history.posts > 0), detail: !i.history.posts ? "No past posts imported or synced: recommendations are not performance-validated" : `${i.history.posts} past posts, ${i.history.withMetrics} with metrics${i.history.platforms.length ? ` (${i.history.platforms.join(", ")})` : ""}${i.history.lastDate ? `, latest ${i.history.lastDate}` : ""}`, usedFor: "formats, topics, hooks, timing that perform" },
    { key: "competitors", label: "Competitor content", status: st(i.competitors.posts >= 5, i.competitors.competitors > 0), detail: !i.competitors.competitors ? "No competitor tracked" : `${i.competitors.competitors} competitor(s), ${i.competitors.posts} posts (${i.competitors.withCounts} with public counts)`, usedFor: "differentiation and topic gaps" },
    { key: "serp", label: "SERP insights", status: st(i.serp.analyses > 0), detail: i.serp.analyses ? `${i.serp.keywords} keyword(s) analysed${i.serp.lastDate ? `, latest ${i.serp.lastDate}` : ""}` : "No keyword analysed in SERP Intelligence", usedFor: "search demand and website content" },
    { key: "important_dates", label: "Important dates and seasons", status: st(i.importantDates > 0), detail: i.importantDates ? `${i.importantDates} date(s) or season(s) in this period` : "None in this period", usedFor: "timing of posts" },
    { key: "calendars", label: "Existing editorial calendars", status: st(i.calendars > 0), detail: i.calendars ? `${i.calendars} calendar(s)` : "None yet", usedFor: "repetition checks" },
    { key: "published", label: "Previously published content (verified)", status: st(i.published.withMetrics > 0, i.published.verified > 0), detail: i.published.verified ? `${i.published.verified} verified post(s), ${i.published.withMetrics} with synced metrics` : "No calendar post verified as published yet", usedFor: "feedback loop: results vs objective" },
  ];
}
