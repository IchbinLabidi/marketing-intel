import { describe, expect, it } from "vitest";
import { productionAISchema, productionSchema, workflowSchema } from "@/lib/validation/production";
import { canWriteItem, changedFields, isRTL, writingOf } from "@/lib/production/model";
import { PRODUCTION_SYSTEM, productionDraftSchema, productionPrompt } from "@/server/ai/production";

const draft = { ...writingOf({ title: "Useful advice", caption: "A caption" }), platform: "instagram" as const, format: "Carousel", language: "fr" as const, pillar_id: null, funnel_stage: null, target_audience: "Parents", assignee_id: null, due_date: null, language_variants: {} };
describe("production validation", () => {
  it("accepts multilingual variants without discarding the original", () => {
    const value = productionSchema.parse({ ...draft, language_variants: { fr: writingOf(draft), ar_tn: writingOf({ title: "فكرة", caption: "شنوة رأيكم؟" }) } });
    expect(value.language_variants.fr?.caption).toBe("A caption");
    expect(value.language_variants.ar_tn?.caption).toBe("شنوة رأيكم؟");
  });
  it("rejects invalid dates, unsupported languages, bad references and oversized content", () => {
    for (const invalid of [{ title: " " }, { due_date: "2026-02-31" }, { language: "derja" }, { assignee_id: "someone" }, { pillar_id: "wrong-project-name" }, { caption: "a".repeat(10001) }, { main_content: "a".repeat(30001) }]) expect(productionSchema.safeParse({ ...draft, ...invalid }).success).toBe(false);
  });
  it("strips authority fields from client input", () => {
    const value = productionSchema.parse({ ...draft, status: "published", production_stage: "ready", created_by: "spoof", approved_by: "spoof", project_id: "spoof", revision: 999 });
    expect(value).not.toHaveProperty("status"); expect(value).not.toHaveProperty("approved_by"); expect(value).not.toHaveProperty("project_id");
  });
  it("validates custom workflow labels", () => {
    expect(workflowSchema.safeParse({ require_internal_review: false, labels: { approval: "Client sign-off" } }).success).toBe(true);
    expect(workflowSchema.safeParse({ require_internal_review: true, labels: { idea: "" } }).success).toBe(false);
  });
});
describe("production ownership", () => {
  it("matches existing workspace roles and assignment rules", () => {
    const item = { assignee_id: "creator", created_by: "owner" };
    expect(canWriteItem("editor", "creator", item)).toBe(true);
    expect(canWriteItem("editor", "owner", item)).toBe(false);
    expect(canWriteItem("viewer", "creator", item)).toBe(false);
    expect(canWriteItem("admin", "manager", item)).toBe(true);
    expect(canWriteItem("editor", "owner", { ...item, assignee_id: null })).toBe(true);
  });
  it("includes language variants when comparing revisions", () => {
    expect(changedFields({ caption: "before", language_variants: {} }, { caption: "after", language_variants: { ar: {} } })).toEqual(["caption", "language_variants"]);
    expect(isRTL("ar")).toBe(true); expect(isRTL("ar_tn")).toBe(true); expect(isRTL("fr")).toBe(false);
  });
});
describe("production AI contract", () => {
  it("provides explicit language, strategy, performance and operation", () => {
    const input = productionAISchema.parse({ operation: "translate", content: draft, instruction: "Natural phrasing", target_language: "ar_tn", target_platform: "facebook" });
    const prompt = productionPrompt(input, "Brand identity", "Real saves: 12", "Recent post");
    expect(prompt).toContain("Tunisian Arabic (Derja)"); expect(prompt).toContain("Brand identity"); expect(prompt).toContain("Real saves: 12"); expect(prompt).toContain("translate");
    expect(PRODUCTION_SYSTEM).toContain("Do not produce literal French translations"); expect(PRODUCTION_SYSTEM).toContain("Never fabricate");
  });
  it("requires an editable, complete AI response instead of accepting arbitrary text", () => {
    expect(productionDraftSchema.safeParse({ text: "Here is your caption" }).success).toBe(false);
    expect(productionDraftSchema.safeParse({ content: writingOf(draft), format: "Carousel", alternative_hooks: [], rationale: "Based on strategy", assumptions: [] }).success).toBe(true);
  });
  it("rejects unknown operations and excessive instructions", () => {
    expect(productionAISchema.safeParse({ operation: "publish", content: draft, instruction: "", target_language: "fr", target_platform: "instagram" }).success).toBe(false);
    expect(productionAISchema.safeParse({ operation: "rewrite", content: draft, instruction: "a".repeat(2001), target_language: "fr", target_platform: "instagram" }).success).toBe(false);
  });
});
