import { describe, expect, it } from "vitest";
import { z } from "zod";
import { geminiJsonSchema } from "@/lib/ai/json-schema";
import { estimateCost, featureEnvName, parseRoute, priceFor, resolveRoute, tierOf } from "@/lib/ai/models";
import { competitorAnalysisSchema, gapAnalysisSchema } from "@/server/ai/competitors";
import { calendarDraftSchema, pdfExtractionSchema, pillarClassificationSchema, recommendationsSchema } from "@/server/ai/history";
import { opportunitiesSchema, singleOpportunitySchema } from "@/server/ai/opportunities";
import { postDraftSchema } from "@/server/ai/post";
import { productionDraftSchema } from "@/server/ai/production";
import { briefSchema, draftSchema, seoOpportunitiesSchema, serpInsightSchema } from "@/server/ai/serp";
import { STRATEGY_SECTIONS } from "@/server/ai/strategy";

const both = { gemini: true, anthropic: true };

describe("AI routing", () => {
  it("routes by tier: cheap model for classification and short edits, premium for long-form", () => {
    expect(tierOf("history.pillar_classification")).toBe("light");
    expect(tierOf("production.hashtags")).toBe("light");
    expect(tierOf("serp.draft")).toBe("premium");
    expect(tierOf("strategy.positioning")).toBe("standard");
    expect(resolveRoute("history.pillar_classification", {}, both)).toMatchObject({ provider: "gemini", model: "gemini-3.1-flash-lite", tier: "light", source: "builtin" });
    expect(resolveRoute("serp.brief", {}, both)).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash", fallback: { provider: "anthropic" } });
    expect(resolveRoute("serp.draft", {}, both)).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", fallback: { provider: "gemini", model: "gemini-4-argon" } });
  });

  it("applies overrides: feature > module > tier > default provider/model", () => {
    const env = {
      [featureEnvName("serp.draft")]: "anthropic:claude-opus-5-5",
      AI_ROUTE_PRODUCTION: "anthropic",
      AI_TIER_STANDARD: "gemini-2.5-flash",
      AI_DEFAULT_PROVIDER: "anthropic",
    };
    expect(featureEnvName("serp.draft")).toBe("AI_ROUTE_SERP_DRAFT");
    expect(resolveRoute("serp.draft", env, both)).toMatchObject({ model: "claude-opus-5-5", source: "feature" });
    expect(resolveRoute("production.hashtags", env, both)).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", source: "feature" });
    expect(resolveRoute("strategy.positioning", env, both)).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash", source: "tier" });
    expect(resolveRoute("history.pillar_classification", env, both)).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", source: "env_default" });
    expect(resolveRoute("serp.brief", { AI_DEFAULT_MODEL: "gemini-3.8-flash" }, both)).toMatchObject({ model: "gemini-3.8-flash" });
    expect(parseRoute("nonsense-model", "light")).toBeNull();
  });

  it("uses the other provider when the chosen one has no key, and offers no fallback without a second key", () => {
    expect(resolveRoute("serp.draft", {}, { gemini: true, anthropic: false })).toMatchObject({ provider: "gemini", model: "gemini-4-argon", fallback: null });
    expect(resolveRoute("serp.brief", {}, { gemini: false, anthropic: true })).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", fallback: null });
  });
});

describe("AI cost estimation", () => {
  it("prices input, output and cache tokens, with dated price changes", () => {
    // 1M input + 1M output on gemini-3.8-flash = $0.75 + $3.75
    expect(estimateCost("gemini-3.8-flash", { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 }, new Date("2026-10-26"))).toBe(4.5);
    expect(estimateCost("gemini-3.8-flash", { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, new Date("2027-01-02"))).toBe(1.5);
    expect(priceFor("gemini-4-argon", new Date("2026-12-01"))?.input).toBe(4);
    // Claude: cache reads at the cache price, cache writes at 1.25× input
    expect(estimateCost("claude-sonnet-5-5", { input: 1000, output: 500, cacheRead: 10000, cacheWrite: 2000 })).toBe(0.014); // 2000×$2 … = $0.002 + $0.005 + $0.002 + $0.005
  });

  it("never guesses the price of an unknown model", () => {
    expect(estimateCost("gemini-9-unknown", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("Gemini structured output schemas", () => {
  const ALLOWED = new Set(["$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties", "additionalProperties", "required", "propertyOrdering"]);
  const keywords = (node: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((n) => keywords(n, out));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "properties" || k === "$defs") Object.values(v as object).forEach((s) => keywords(s, out));
        else { out.add(k); keywords(v, out); }
      }
    }
    return out;
  };

  it("keeps only the JSON Schema keywords Gemini supports, turning const into enum", () => {
    const s = geminiJsonSchema(z.object({ kind: z.literal("x"), name: z.string().min(2).max(9).regex(/a/), id: z.uuid(), when: z.iso.date() }));
    expect(s.properties).toMatchObject({ kind: { enum: ["x"], type: "string" }, when: { format: "date" } });
    expect(JSON.stringify(s)).not.toMatch(/"(const|pattern|minLength|maxLength|\$schema)"/);
  });

  it("converts every schema the app sends to the AI", () => {
    const schemas: z.ZodType[] = [
      competitorAnalysisSchema, gapAnalysisSchema, calendarDraftSchema, pdfExtractionSchema, pillarClassificationSchema, recommendationsSchema,
      opportunitiesSchema, singleOpportunitySchema, postDraftSchema, productionDraftSchema, briefSchema, draftSchema, seoOpportunitiesSchema, serpInsightSchema,
      ...Object.values(STRATEGY_SECTIONS).map((s) => s.schema as z.ZodType),
    ];
    for (const schema of schemas) {
      const json = geminiJsonSchema(schema);
      expect(json.type).toBe("object");
      expect([...keywords(json)].filter((k) => !ALLOWED.has(k))).toEqual([]);
    }
  });
});
