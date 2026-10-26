"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, LANGUAGES, PLATFORMS, type Language } from "@/lib/domain/constants";
import { classifyIntent, pagesSummary, slugify } from "@/lib/serp/analysis";
import { domainOf } from "@/lib/serp/normalize";
import { contentTokens, normalizeText, stripRefs } from "@/lib/history/text";
import { isDuplicate } from "@/lib/opportunities/scoring";
import type { ActionResult } from "@/lib/validation/common";
import { createClient } from "@/lib/supabase/server";
import { describeAIError } from "@/server/ai/client";
import { buildProjectContext } from "@/server/ai/context";
import { runStructured } from "@/server/ai/run";
import {
  briefMarkdown, briefSchema, draftSchema, marketDigest, SEO_SYSTEM_PROMPT, seoOpportunitiesSchema, serpDigest, serpInsightSchema,
} from "@/server/ai/serp";
import { analyzeRankingPages } from "@/server/serp/pages";
import { COUNTRIES, SERP_LANGUAGES, serpProvider, SerpProviderError } from "@/server/serp/provider";
import { insertPost } from "@/server/services/calendar";
import { insertOpportunities, linkedPosts, listOpportunities } from "@/server/services/opportunities";
import { getBrandProfile, getProjectContext, listChannels } from "@/server/services/projects";
import { getAnalysis, getBrief } from "@/server/services/serp";
import { requireUser } from "@/server/services/session";
import { getStrategyBundle } from "@/server/services/strategy";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");
const fail = (e: unknown, fallback: string): ActionResult<never> => {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : fallback;
  return { ok: false, error: /schema cache|does not exist/.test(m) ? "SERP Intelligence needs database migration 0010." : m };
};

async function guard(projectId: string) {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  return { user, project, allowed: canEdit(role), ownDomain: domainOf(project.website?.startsWith("http") ? project.website : project.website ? `https://${project.website}` : null) };
}

const analyzeSchema = z.object({
  keyword: z.string().trim().min(2, "Enter a keyword").max(200),
  country: z.string().refine((c) => c in COUNTRIES, "Choose a country"),
  language: z.string().refine((l) => l in SERP_LANGUAGES, "Choose a language"),
  devices: z.array(z.enum(["desktop", "mobile"])).min(1, "Choose at least one device").max(2),
});

/**
 * Runs a live Google SERP request through the provider for each device, stores every element as returned, then
 * calculates intent and reads the ranking pages' structure. Each run is a new dated snapshot.
 */
export async function analyzeKeywordAction(projectId: string, input: z.input<typeof analyzeSchema>): Promise<ActionResult<{ ids: string[] }>> {
  const { user, allowed, ownDomain } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = analyzeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const provider = serpProvider();
  if (!provider.configured()) return { ok: false, error: provider.setupHint };
  const q = parsed.data;
  const db = await createClient();
  const runOne = async (device: "desktop" | "mobile") => {
    const { data: row, error } = await db.from("serp_analyses").insert({
      project_id: projectId, keyword: q.keyword, keyword_normalized: normalizeText(q.keyword), country: q.country, language: q.language,
      device, location: COUNTRIES[q.country].location, provider: provider.id, created_by: user.id,
    }).select("id").single();
    if (error) throw error;
    try {
      const serp = await provider.search({ keyword: q.keyword, country: q.country, language: q.language, device });
      for (let k = 0; k < serp.items.length; k += 200) {
        const ins = await db.from("serp_items").insert(serp.items.slice(k, k + 200).map((i) => ({ ...i, project_id: projectId, analysis_id: row.id })));
        if (ins.error) throw ins.error;
      }
      const intent = classifyIntent(q.keyword, serp.items, ownDomain);
      const pages = await analyzeRankingPages(serp.items, 8);
      const summary = pagesSummary(pages, ownDomain, contentTokens);
      // our position among all organic results returned (not only the pages read)
      const own = ownDomain ? serp.items.filter((i) => i.type === "organic" && (i.domain === ownDomain || i.domain?.endsWith(`.${ownDomain}`))).sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[0] : null;
      summary.ownPosition = own?.position ?? null;
      const up = await db.from("serp_analyses").update({
        status: "completed", provider_search_id: serp.providerSearchId, total_results: serp.totalResults, features: serp.features,
        intent, competitors: { pages, summary }, fetched_at: new Date().toISOString(),
      }).eq("id", row.id);
      if (up.error) throw up.error;
    } catch (e) {
      await db.from("serp_analyses").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 1000) : "Failed" }).eq("id", row.id);
      throw e;
    }
    return row.id as string;
  };
  try {
    const ids = await Promise.all(q.devices.map(runOne));
    refresh(projectId);
    return { ok: true, data: { ids }, message: `SERP analysed (${q.devices.join(" + ")})` };
  } catch (e) {
    refresh(projectId);
    return e instanceof SerpProviderError ? { ok: false, error: e.message } : fail(e, "The analysis failed");
  }
}

export async function deleteAnalysisAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error, count } = await db.from("serp_analyses").delete({ count: "exact" }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    if (!count) return { ok: false, error: "Analysis not found." };
    refresh(projectId);
    return { ok: true, message: "Analysis deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}

async function aiContext(projectId: string) {
  const { project } = await getProjectContext(projectId);
  const [bundle, brand, channels] = await Promise.all([getStrategyBundle(projectId), getBrandProfile(projectId), listChannels(projectId)]);
  return { project, bundle, context: buildProjectContext({ project, brand, channels, strategy: bundle }) };
}

async function loadFull(projectId: string, id: string, ownDomain: string | null) {
  const a = await getAnalysis(projectId, id);
  if (!a || a.analysis.status !== "completed") return null;
  const pages = a.analysis.competitors?.pages ?? [];
  const digest = serpDigest(a.items, pages);
  const market = marketDigest({ keyword: a.analysis.keyword, country: a.analysis.country, language: a.analysis.language, device: a.analysis.device, intent: a.analysis.intent!, summary: a.analysis.competitors?.summary ?? null, ownDomain });
  return { ...a, digest, market };
}

/** AI interpretation of one SERP (labelled; statements without real refs become recommendations). */
export async function serpInsightAction(projectId: string, id: string): Promise<ActionResult> {
  const { user, allowed, ownDomain } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const full = await loadFull(projectId, id, ownDomain);
    if (!full) return { ok: false, error: "Analysis not found or not completed." };
    const { project, context } = await aiContext(projectId);
    const out = await runStructured({
      feature: "serp.insight", workspaceId: project.workspace_id, projectId, userId: user.id, system: SEO_SYSTEM_PROMPT, schema: serpInsightSchema, effort: "low",
      prompt: ["# Task", "Analyse this SERP: who ranks and with what content, the structure and depth that wins, what's missing, and how our website and strategy compare.", "\n# Brand and strategy", context, "\n# Market", full.market, "\n# SERP (as returned by the provider)", full.digest.text].join("\n"),
    });
    const fix = (list: typeof out.gaps) => list.map((s) => {
      const refs = [...new Set(s.refs)].filter((r) => full.digest.refs.has(r));
      return { ...s, text: stripRefs(s.text), refs, basis: s.basis === "serp_data" && !refs.length ? ("ai_recommendation" as const) : s.basis };
    });
    const db = await createClient();
    const { error } = await db.from("serp_analyses").update({
      ai_analysis: { ...out, summary: stripRefs(out.summary), competitors: fix(out.competitors), content_patterns: fix(out.content_patterns), gaps: fix(out.gaps), vs_our_site: fix(out.vs_our_site), created_at: new Date().toISOString() },
    }).eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "AI analysis ready" };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/**
 * SEO opportunities from one or more saved analyses, stored in Content Opportunities (source serp_analysis) with
 * the SERP elements that support them as evidence. No search volume or difficulty is claimed: none is collected.
 */
export async function seoOpportunitiesAction(projectId: string, analysisIds: string[], count = 6): Promise<ActionResult<{ created: number; skipped: number }>> {
  const { user, allowed, ownDomain } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const fulls = (await Promise.all(analysisIds.slice(0, 4).map((id) => loadFull(projectId, id, ownDomain)))).filter((x): x is NonNullable<typeof x> => Boolean(x));
    if (!fulls.length) return { ok: false, error: "Select at least one completed analysis." };
    const { project, bundle, context } = await aiContext(projectId);
    // refs are prefixed per analysis (A1:R3) so evidence maps back to the right snapshot
    const blocks = fulls.map((f, k) => `## A${k + 1}\n${f.market}\n${f.digest.text.split("\n").map((l) => `A${k + 1}:${l}`).join("\n")}`);
    const existing = await listOpportunities(projectId);
    const out = await runStructured({
      feature: "serp.opportunities", workspaceId: project.workspace_id, projectId, userId: user.id, system: SEO_SYSTEM_PROMPT, schema: seoOpportunitiesSchema,
      prompt: [
        "# Task", `Propose ${Math.min(10, Math.max(3, count))} SEO opportunities for our website: keywords to target, topics to create, existing pages to improve, content gaps, long-tail keywords, FAQ opportunities, content clusters or pillar pages. Cite refs as A1:R3, A1:Q2…`,
        "\n# Brand, strategy, personas and pillars", context,
        "\n# SERP analyses", ...blocks,
        "\n# Existing opportunities (don't repeat)", existing.slice(0, 80).map((o) => `- ${o.title ?? o.idea}`).join("\n") || "(none)",
      ].join("\n"),
    });
    const byName = <T extends { id: string; name: string }>(list: T[], n: string | null) => (n ? list.find((x) => normalizeText(x.name) === normalizeText(n))?.id ?? null : null);
    const rows = [];
    let skipped = 0;
    for (const o of out.opportunities) {
      const evidence = [...new Set(o.refs)].flatMap((ref) => {
        const m = /^A(\d+):([RQSFP]\d+)$/.exec(ref);
        const f = m ? fulls[Number(m[1]) - 1] : fulls.length === 1 ? fulls[0] : null;
        const item = f?.digest.refs.get(m ? m[2] : ref) as { type?: string; position?: number | null; title?: string | null; url?: string | null; domain?: string | null } | undefined;
        if (!f || !item) return [];
        const a = f.analysis;
        const what = item.type === "people_also_ask" ? `People also ask: “${item.title}”` : item.type === "related_search" ? `Related search: “${item.title}”` : item.type === "featured_snippet" ? `Featured snippet from ${item.domain}` : `#${item.position} ${item.domain}: “${item.title ?? ""}”`;
        return [{ type: "serp", note: `${what} — Google ${a.country.toUpperCase()}/${a.language}, ${a.device}, ${a.fetched_at?.slice(0, 10)}`, method: "As returned by Google through the SERP provider at the date shown.", metrics: { keyword: a.keyword, source_url: item.url ?? null, position: item.position ?? null }, ref_id: null }];
      });
      const calculated = fulls[0].analysis.intent?.primary;
      const row = {
        title: stripRefs(o.title), idea: stripRefs(o.title), rationale: stripRefs(o.rationale), platform: "blog" as const, format: o.content_type,
        pillar_id: byName(bundle.pillars, o.pillar), persona_id: byName(bundle.personas, o.persona), target_audience: o.persona, funnel_stage: o.funnel_stage,
        insight_type: evidence.length >= 2 ? ("data_supported" as const) : ("hypothesis" as const),
        // no search volume or ranking difficulty is collected, so confidence stays at medium at best
        confidence: evidence.length >= 3 && o.intent === calculated ? ("medium" as const) : ("low" as const),
        evidence: [...evidence, { type: "ai_reasoning", note: "AI recommendation built on the SERP elements above. Search volume and difficulty are not measured." }],
        seo: { keyword: o.keyword, intent: o.intent, country: fulls[0].analysis.country, language: fulls[0].analysis.language, content_type: o.content_type, slug: slugify(o.slug || o.title), outline: o.outline, kind: o.kind },
        source: "serp_analysis", serp_analysis_id: fulls[0].analysis.id, state: "new" as const, focus: {},
      };
      if (isDuplicate({ title: row.title, platform: "blog" }, [...existing, ...rows])) { skipped++; continue; }
      rows.push(row);
    }
    await insertOpportunities(projectId, rows as never);
    refresh(projectId);
    return { ok: true, data: { created: rows.length, skipped }, message: `${rows.length} SEO opportunities added to Content Opportunities${skipped ? ` (${skipped} duplicates skipped)` : ""}` };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

/** SEO content brief for a keyword, researched from the ranking pages (structure only, never their text). */
export async function generateBriefAction(projectId: string, input: { analysisId: string; opportunityId?: string | null; keyword?: string | null }): Promise<ActionResult<{ id: string }>> {
  const { user, allowed, ownDomain } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const full = await loadFull(projectId, input.analysisId, ownDomain);
    if (!full) return { ok: false, error: "Analysis not found or not completed." };
    const { project, context } = await aiContext(projectId);
    const opp = input.opportunityId ? (await listOpportunities(projectId)).find((o) => o.id === input.opportunityId) ?? null : null;
    const keyword = (input.keyword || opp?.seo?.keyword || full.analysis.keyword).slice(0, 200);
    const median = full.analysis.competitors?.summary.medianWords;
    const out = await runStructured({
      feature: "serp.brief", workspaceId: project.workspace_id, projectId, userId: user.id, system: SEO_SYSTEM_PROMPT, schema: briefSchema,
      prompt: [
        "# Task", `Write a detailed SEO content brief for the keyword "${keyword}" (${full.analysis.language}, ${full.analysis.country}). Use the ranking pages as research: cover what the search expects, answer the questions people ask, and plan a page that is more useful and original than the current results. ${median ? `The ranking pages read have a median of ${median} words.` : ""}`,
        opp ? `\n# Opportunity to develop\n${opp.title}\n${opp.rationale}\nOutline idea: ${opp.seo?.outline?.join(" / ") ?? ""}` : "",
        "\n# Brand and strategy", context, "\n# Market", full.market, "\n# SERP", full.digest.text,
      ].join("\n"),
    });
    const brief = {
      ...out, slug: slugify(out.slug || out.h1), competitor_observations: out.competitor_observations.map((c) => ({ ...c, observation: stripRefs(c.observation), refs: c.refs.filter((r) => full.digest.refs.has(r)) })),
    };
    const db = await createClient();
    const { data, error } = await db.from("seo_briefs").insert({
      project_id: projectId, analysis_id: input.analysisId, opportunity_id: opp?.id ?? null, keyword, country: full.analysis.country, language: full.analysis.language, brief, created_by: user.id,
    }).select("id").single();
    if (error) throw error;
    refresh(projectId);
    return { ok: true, data: { id: data.id }, message: "SEO brief ready" };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

export async function generateDraftAction(projectId: string, briefId: string): Promise<ActionResult> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const b = await getBrief(projectId, briefId);
    if (!b) return { ok: false, error: "Brief not found." };
    const { project, context } = await aiContext(projectId);
    const out = await runStructured({
      feature: "serp.draft", workspaceId: project.workspace_id, projectId, userId: user.id, system: SEO_SYSTEM_PROMPT, schema: draftSchema,
      prompt: ["# Task", "Write the full article draft following this brief exactly (H1/H2/H3, questions, CTA), original, in the brief's language. Leave [placeholders] for facts you can't know (prices, dates, names).", "\n# Brand", context, "\n# Brief", briefMarkdown(b.brief)].join("\n"),
    });
    const db = await createClient();
    const { error } = await db.from("seo_briefs").update({ draft: [out.markdown, out.notes.length ? `\n---\nTo check: ${out.notes.join(" · ")}` : ""].join("") }).eq("project_id", projectId).eq("id", briefId);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Draft ready (AI): review before publishing" };
  } catch (e) {
    return { ok: false, error: describeAIError(e) };
  }
}

const calendarSchema = z.object({
  date: z.iso.date().nullish(),
  campaign_id: z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null),
  pillar_id: z.union([z.uuid(), z.literal("")]).nullish().transform((v) => v || null),
  platform: z.enum(PLATFORMS),
  format: z.string().trim().min(1).max(120),
});

/** Adds the brief (and its draft) to the existing Editorial Calendar as a planned item; one calendar item per brief. */
export async function addBriefToCalendarAction(projectId: string, briefId: string, input: z.input<typeof calendarSchema>): Promise<ActionResult<{ contentItemId: string }>> {
  const { user, allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  const parsed = calendarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  try {
    const b = await getBrief(projectId, briefId);
    if (!b) return { ok: false, error: "Brief not found." };
    if (b.content_item_id) return { ok: false, error: "This brief is already in the Editorial Calendar." };
    // one content item per opportunity (database rule): link only if the opportunity has none yet
    const linkOpp = b.opportunity_id && !(await linkedPosts(projectId, [b.opportunity_id])).length ? b.opportunity_id : null;
    const funnel = b.brief.search_intent === "transactional" ? "conversion" : b.brief.search_intent === "commercial" ? "acquisition" : "awareness";
    const p = parsed.data;
    const post = await insertPost(projectId, user.id, {
      title: b.brief.seo_title.slice(0, 300), platform: p.platform, format: p.format, pillar_id: p.pillar_id, campaign_id: p.campaign_id, funnel_stage: funnel,
      hook: b.brief.meta_description, cta: b.brief.cta, creative_brief: briefMarkdown(b.brief).slice(0, 10000), main_content: b.draft,
      language: (LANGUAGES as readonly string[]).includes(b.language) ? (b.language as Language) : undefined,
      scheduled_date: p.date ?? null, status: "planned", opportunity_id: linkOpp,
    });
    const db = await createClient();
    await db.from("seo_briefs").update({ content_item_id: post.id }).eq("project_id", projectId).eq("id", briefId);
    refresh(projectId);
    return { ok: true, data: { contentItemId: post.id }, message: "Added to the Editorial Calendar" };
  } catch (e) {
    return fail(e, "Could not add to the calendar");
  }
}

export async function deleteBriefAction(projectId: string, id: string): Promise<ActionResult> {
  const { allowed } = await guard(projectId);
  if (!allowed) return NO_EDIT;
  try {
    const db = await createClient();
    const { error } = await db.from("seo_briefs").delete().eq("project_id", projectId).eq("id", id);
    if (error) throw error;
    refresh(projectId);
    return { ok: true, message: "Brief deleted" };
  } catch (e) {
    return fail(e, "Could not delete");
  }
}
