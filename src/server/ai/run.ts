import "server-only";
import type { z } from "zod";
import { estimateCost, resolveRoute, type AIRoute, type AIUsage } from "@/lib/ai/models";
import { wellFormed } from "@/lib/history/text";
import { createClient } from "@/lib/supabase/server";
import { PROVIDER_NAMES, redactSecrets, startWith } from "@/lib/ai/errors";
import { AIAllProvidersFailedError, AIBudgetExceededError } from "./client";
import { AIProviderError, generate, providerConfigured, providerHealth, type Effort } from "./providers";

type RunOptions<S extends z.ZodType> = {
  feature: string;
  workspaceId: string;
  projectId?: string;
  userId: string;
  system: string;
  prompt: string;
  schema: S;
  /** Reasoning depth. Defaults by tier: light → low, otherwise medium. */
  effort?: Effort;
  /** Base64 PDFs sent before the prompt (both providers read text, tables and layout natively). */
  pdfs?: string[];
  /** Editorial calendar the request is made for (cost per calendar). */
  calendarId?: string;
};

/** Guard against accidentally sending huge inputs (≈ 100k tokens); callers should send aggregates, not raw history. */
const MAX_PROMPT_CHARS = 400_000;

export function currentRoute(feature: string) {
  return resolveRoute(feature, process.env, { gemini: providerConfigured("gemini"), anthropic: providerConfigured("anthropic") });
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

/**
 * The single entry point for AI in the app. Routes the feature to its provider/model (src/lib/ai/models.ts), returns
 * output validated against the Zod schema, and logs the request in ai_runs: provider, model, tier, tokens, estimated
 * cost, duration, attempts, status and error type. Limits: 2 retries with backoff on temporary failures (overload,
 * server, network), one retry on an invalid answer, one switch to the other provider when the first can't serve
 * (key, credit, quota, rate limit, overload) and the other has a key and isn't known to be unavailable.
 */
export async function runStructured<S extends z.ZodType>(opts: RunOptions<S>): Promise<z.infer<S>> {
  return (await runStructuredWithMeta(opts)).data;
}

/** Same as runStructured, plus the provider and model that actually answered (to store with saved results). */
export async function runStructuredWithMeta<S extends z.ZodType>(opts: RunOptions<S>): Promise<{ data: z.infer<S>; provider: string; model: string }> {
  const route = currentRoute(opts.feature);
  if (!providerConfigured(route.provider)) throw new AIProviderError("AI is not configured. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to the server environment.", route.provider, "not_configured");
  const system = wellFormed(opts.system);
  const prompt = wellFormed(opts.prompt);
  if (prompt.length + system.length > MAX_PROMPT_CHARS) throw new Error("This request is too large to send to the AI. Narrow the selection or period and try again.");

  const supabase = await createClient();
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD);
  if (budget > 0) {
    const { data: spent } = await supabase.rpc("ai_cost_since", { p_workspace: opts.workspaceId, p_from: monthStart() });
    if (Number(spent ?? 0) >= budget) throw new AIBudgetExceededError(budget);
  }

  const started = Date.now();
  const { data: run } = await supabase
    .from("ai_runs")
    .insert({ workspace_id: opts.workspaceId, project_id: opts.projectId ?? null, feature: opts.feature, provider: route.provider, model: route.model, tier: route.tier, created_by: opts.userId, ...(opts.calendarId ? { calendar_id: opts.calendarId } : {}) })
    .select("id")
    .single();

  const total: AIUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost: number | null = 0;
  let attempts = 0;
  let current: AIRoute = route;
  let fallbackFrom: string | null = null;
  const add = (model: string, u?: AIUsage) => {
    if (!u) return;
    for (const k of Object.keys(total) as (keyof AIUsage)[]) total[k] += u[k];
    const c = estimateCost(model, u);
    cost = cost === null || c === null ? null : cost + c;
  };
  const finish = async (fields: Record<string, unknown>) => {
    if (!run) return;
    await supabase.from("ai_runs").update({
      ...fields, provider: current.provider, model: current.model, fallback_from: fallbackFrom, attempts,
      input_tokens: total.input + total.cacheWrite, cached_input_tokens: total.cacheRead, cache_write_tokens: total.cacheWrite, output_tokens: total.output,
      cost_usd: cost, duration_ms: Date.now() - started, finished_at: new Date().toISOString(),
    }).eq("id", run.id);
  };

  const effort = opts.effort ?? (route.tier === "light" ? "low" : "medium");
  const failures: AIProviderError[] = [];
  // the other provider is only used when it has a key and isn't known to be out of credit / quota / overloaded
  const fallbackUsable = () => Boolean(route.fallback && !providerHealth(route.fallback.provider));
  // skip a provider known to be unavailable (no credit, quota, overload) when the other one can answer
  const known = providerHealth(route.provider);
  const start = startWith(Boolean(known), route.fallback ? { configured: true, down: Boolean(providerHealth(route.fallback.provider)) } : null);
  if (known && start === "fail") {
    // every provider failed recently: say so at once instead of waiting minutes for the same failures
    const failed = [new AIProviderError(`${known.message} (recent failure; retry after ${new Date(known.until).toISOString().slice(11, 16)} UTC or run "Retry AI test")`, route.provider, known.kind)];
    const other = route.fallback ? providerHealth(route.fallback.provider) : null;
    if (route.fallback && other) failed.push(new AIProviderError(other.message, route.fallback.provider, other.kind));
    throw failed.length > 1 ? new AIAllProvidersFailedError(failed) : failed[0];
  }
  if (known && start === "fallback") {
    failures.push(new AIProviderError(`${known.message} (skipped: still unavailable)`, route.provider, known.kind));
    fallbackFrom = `${route.provider}:${route.model}`;
    current = route.fallback!;
  }
  let jsonRetried = false;
  try {
    for (;;) {
      try {
        const out = await generate(current.provider, { model: current.model, system, prompt, schema: opts.schema, effort, pdfs: opts.pdfs }, opts.feature);
        attempts += out.attempts;
        add(current.model, out.usage);
        // a response counts only once it parses and matches the schema
        const parsed = opts.schema.safeParse(safeJson(out.text));
        if (parsed.success) {
          await finish({ status: "succeeded" });
          return { data: parsed.data, provider: current.provider, model: current.model };
        }
        if (jsonRetried) throw new AIProviderError(`${PROVIDER_NAMES[current.provider]}'s answer did not match the expected format (${parsed.error.issues[0]?.message ?? "invalid JSON"}).`, current.provider, "invalid_output");
        jsonRetried = true; // one more try on the same model
      } catch (e) {
        const err = e instanceof AIProviderError ? e : new AIProviderError(e instanceof Error ? e.message : "Unexpected AI error.", current.provider, "server");
        // an invalid answer was already counted when it arrived
        if (err.kind !== "invalid_output") attempts += e instanceof AIProviderError ? err.attempts : 1;
        add(current.model, err.usage);
        failures.push(err);
        if (err.unavailable && !fallbackFrom && route.fallback && fallbackUsable()) {
          fallbackFrom = `${current.provider}:${current.model}`;
          current = route.fallback;
          continue;
        }
        // nothing left to try: one message covering every provider that was tried or skipped
        if (!fallbackFrom && route.fallback && !fallbackUsable()) {
          const h = providerHealth(route.fallback.provider)!;
          failures.push(new AIProviderError(`${h.message} (not tried)`, route.fallback.provider, h.kind));
        }
        throw failures.length > 1 ? new AIAllProvidersFailedError(failures) : err;
      }
    }
  } catch (error) {
    const stored = error instanceof AIAllProvidersFailedError
      ? error.failures.map((f) => `[${f.provider}:${f.kind}] ${f.message}`).join(" | ")
      : error instanceof AIProviderError ? `[${error.provider}:${error.kind}] ${error.message}` : error instanceof Error ? error.message : "unknown";
    await finish({ status: "failed", error: redactSecrets(stored).slice(0, 500) });
    throw error;
  }
}

const safeJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
