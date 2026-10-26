import { describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { STRATEGY_SECTIONS, buildStrategyPrompt } from "@/server/ai/strategy";
import { buildProjectContext } from "@/server/ai/context";
import { strategyCompleteness } from "@/server/services/strategy";
import type { Project } from "@/types/domain";

const project: Project = {
  id: "p", workspace_id: "w", name: "Maison Jasmin", description: null, industry: "Cosmetics", website: null,
  default_language: "fr", timezone: "Africa/Tunis", archived_at: null, created_at: "", updated_at: "",
};
const emptyBundle = { strategy: null, personas: [], pillars: [], campaigns: [], kpis: [] };

describe("AI layer", () => {
  it("every strategy section schema converts to a structured-output JSON schema", () => {
    for (const [name, def] of Object.entries(STRATEGY_SECTIONS)) {
      const format = betaZodOutputFormat(def.schema);
      expect(format.type, name).toBe("json_schema");
      expect(JSON.stringify(format.schema)).toContain("assumptions");
    }
  });
  it("marks missing information explicitly instead of omitting it", () => {
    const ctx = buildProjectContext({ project, brand: null, channels: [], strategy: emptyBundle });
    expect(ctx).toContain("Industry: Cosmetics");
    expect(ctx).toContain("Mission: (not provided)");
    expect(ctx).toContain("## Personas\n(none)");
  });
  it("includes the current section and the user's instruction in the prompt", () => {
    const prompt = buildStrategyPrompt("kpis", "CTX", [{ name: "Leads" }], "focus on B2B");
    expect(prompt).toContain("focus on B2B");
    expect(prompt).toContain('"name": "Leads"');
  });
  it("computes strategy completeness", () => {
    expect(strategyCompleteness(emptyBundle).percent).toBe(0);
  });
});
