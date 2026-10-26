"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit } from "@/lib/domain/constants";
import { KIND_LABELS, redactSecrets, type FailureKind } from "@/lib/ai/errors";
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
  if (!ws || !canEdit(ws.role)) return { ok: false, error: "Your role in this workspace is read-only." };
  const db = await createClient();
  const results: AITestResult[] = [];
  for (const provider of AI_PROVIDERS) {
    const model = PROVIDER_MODELS[provider].standard;
    const at = new Date().toISOString();
    if (!providerConfigured(provider)) {
      results.push({ provider, model, ok: false, kind: "not_configured", label: KIND_LABELS.not_configured, message: `${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} is not set.`, latencyMs: 0, attempts: 0, at });
      continue;
    }
    const code = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const started = Date.now();
    let result: AITestResult;
    let usage = null as null | { input: number; output: number; cacheRead: number; cacheWrite: number };
    try {
      const out = await generate(provider, {
        model, effort: "low", schema: testSchema,
        system: "You are a connectivity test. Follow the instruction exactly.",
        prompt: `Return JSON with "reply" set to exactly this code: ${code}`,
      }, "system.ai_test");
      usage = out.usage;
      const parsed = testSchema.safeParse((() => { try { return JSON.parse(out.text); } catch { return null; } })());
      const ok = parsed.success && parsed.data.reply.trim() === code;
      result = ok
        ? { provider, model, ok: true, kind: null, label: "working", message: `Valid answer in ${(out.latencyMs / 1000).toFixed(1)} s.`, latencyMs: out.latencyMs, attempts: out.attempts, at }
        : { provider, model, ok: false, kind: "invalid_output", label: KIND_LABELS.invalid_output, message: "The model answered, but not with the expected JSON code: not counted as working.", latencyMs: out.latencyMs, attempts: out.attempts, at };
    } catch (e) {
      const err = e instanceof AIProviderError ? e : new AIProviderError(e instanceof Error ? e.message : "Unexpected error", provider, "server");
      result = { provider, model, ok: false, kind: err.kind, label: KIND_LABELS[err.kind], message: err.message, latencyMs: err.latencyMs || Date.now() - started, attempts: err.attempts, at };
    }
    results.push(result);
    await db.from("ai_runs").insert({
      workspace_id: ws.id, feature: "system.ai_test", provider, model, tier: "standard", created_by: user.id,
      status: result.ok ? "succeeded" : "failed", attempts: Math.max(1, result.attempts), duration_ms: result.latencyMs,
      input_tokens: usage ? usage.input + usage.cacheWrite : 0, cached_input_tokens: usage?.cacheRead ?? 0, cache_write_tokens: usage?.cacheWrite ?? 0, output_tokens: usage?.output ?? 0,
      cost_usd: usage ? estimateCost(model, usage) : 0,
      error: result.ok ? null : redactSecrets(`[${provider}:${result.kind}] ${result.message}`).slice(0, 500), finished_at: new Date().toISOString(),
    });
  }
  revalidatePath("/ai-usage");
  const working = results.filter((r) => r.ok).length;
  return { ok: true, data: { results }, message: working ? `${working} of ${results.length} provider(s) working` : "No AI provider is working right now" };
}
