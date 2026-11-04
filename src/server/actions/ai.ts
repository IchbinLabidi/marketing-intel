"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit } from "@/lib/domain/constants";
import { failureMessage, kindLabel, redactSecrets, type FailureKind } from "@/lib/ai/errors";
import { getFormatter, getT } from "@/i18n/server";
import { AI_PROVIDERS, estimateCost, PROVIDER_MODELS, type AIProvider } from "@/lib/ai/models";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/validation/common";
import { AIProviderError, generate, providerConfigured } from "@/server/ai/providers";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";

export type AITestResult = {
  provider: AIProvider; model: string; ok: boolean; kind: FailureKind | null; label: string; message: string;
  latencyMs: number; attempts: number; at: string;
};

const testSchema = z.object({ reply: z.string() });

/**
 * Tests each configured provider with one tiny request (its standard model). A test passes only when the model
 * returns valid JSON that echoes a random code. Every test is logged in the AI request log with its error type and
 * latency; a passing test also clears the provider's "unavailable" state.
 */
export async function testAIAction(): Promise<ActionResult<{ results: AITestResult[] }>> {
  const user = await requireUser();
  const ws = await getActiveWorkspace();
  const [t, fmt] = await Promise.all([getT("errors"), getFormatter()]);
  if (!ws || !canEdit(ws.role)) return { ok: false, error: t("aiTest.readOnly") };
  const db = await createClient();
  const results: AITestResult[] = [];
  for (const provider of AI_PROVIDERS) {
    const model = PROVIDER_MODELS[provider].standard;
    const at = new Date().toISOString();
    if (!providerConfigured(provider)) {
      results.push({ provider, model, ok: false, kind: "not_configured", label: kindLabel("not_configured", t), message: t("aiTest.notSet", { envVar: provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY" }), latencyMs: 0, attempts: 0, at });
      continue;
    }
    const code = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const started = Date.now();
    let result: AITestResult;
    // The request log keeps the English wording; the result shown to the viewer is in their language.
    let logMessage = "";
    let usage = null as null | { input: number; output: number; cacheRead: number; cacheWrite: number };
    try {
      const out = await generate(provider, {
        model, effort: "low", schema: testSchema,
        system: "You are a connectivity test. Follow the instruction exactly.",
        prompt: `Return JSON with "reply" set to exactly this code: ${code}`,
      }, "system.ai_test");
      usage = out.usage;
      logMessage = "The model answered, but not with the expected JSON code: not counted as working.";
      const parsed = testSchema.safeParse((() => { try { return JSON.parse(out.text); } catch { return null; } })());
      const ok = parsed.success && parsed.data.reply.trim() === code;
      result = ok
        ? { provider, model, ok: true, kind: null, label: t("aiTest.working"), message: t("aiTest.validAnswer", { seconds: fmt.number(out.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), latencyMs: out.latencyMs, attempts: out.attempts, at }
        : { provider, model, ok: false, kind: "invalid_output", label: kindLabel("invalid_output", t), message: t("aiTest.invalidJson"), latencyMs: out.latencyMs, attempts: out.attempts, at };
    } catch (e) {
      const err = e instanceof AIProviderError ? e : new AIProviderError(e instanceof Error ? e.message : t("aiTest.unexpected"), provider, "server");
      logMessage = err.message;
      // Failures built by failureMessage are re-worded in the viewer's language; other errors keep the provider's own text.
      const known = err.message === failureMessage(provider, err.kind, { status: err.status, attempts: err.attempts });
      const message = known ? failureMessage(provider, err.kind, { status: err.status, attempts: err.attempts }, t) : err.message;
      result = { provider, model, ok: false, kind: err.kind, label: kindLabel(err.kind, t), message, latencyMs: err.latencyMs || Date.now() - started, attempts: err.attempts, at };
    }
    results.push(result);
    await db.from("ai_runs").insert({
      workspace_id: ws.id, feature: "system.ai_test", provider, model, tier: "standard", created_by: user.id,
      status: result.ok ? "succeeded" : "failed", attempts: Math.max(1, result.attempts), duration_ms: result.latencyMs,
      input_tokens: usage ? usage.input + usage.cacheWrite : 0, cached_input_tokens: usage?.cacheRead ?? 0, cache_write_tokens: usage?.cacheWrite ?? 0, output_tokens: usage?.output ?? 0,
      cost_usd: usage ? estimateCost(model, usage) : 0,
      error: result.ok ? null : redactSecrets(`[${provider}:${result.kind}] ${logMessage || result.message}`).slice(0, 500), finished_at: new Date().toISOString(),
    });
  }
  revalidatePath("/ai-usage");
  const working = results.filter((r) => r.ok).length;
  return { ok: true, data: { results }, message: working ? t("aiTest.summary", { working, total: results.length }) : t("aiTest.noneWorking") };
}
