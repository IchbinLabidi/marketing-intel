import "server-only";
import type { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import {
  backoffMs, classifyNetwork, classifyStatus, cooldownMs, failureMessage, isRetryable, MAX_RETRIES, redactSecrets, allowsFallback, type FailureKind,
} from "@/lib/ai/errors";
import { geminiJsonSchema } from "@/lib/ai/json-schema";
import type { AIProvider, AIUsage } from "@/lib/ai/models";

// The only place that talks to AI provider SDKs. Everything else goes through runStructured (./run.ts).

export type Effort = "low" | "medium" | "high" | "xhigh";
export type GenerateInput = { model: string; system: string; prompt: string; schema: z.ZodType; effort: Effort; pdfs?: string[] };
export type GenerateOutput = { text: string; usage: AIUsage; attempts: number; latencyMs: number };

const MAX_OUTPUT_TOKENS = 32000;

export class AIProviderError extends Error {
  attempts = 1;
  latencyMs = 0;
  usage?: AIUsage;
  constructor(message: string, readonly provider: AIProvider, readonly kind: FailureKind, readonly status: number | null = null) {
    super(redactSecrets(message));
  }
  /** The provider can't serve this request (key, credit, quota, rate limit, overload): the other provider may. */
  get unavailable() {
    return allowsFallback(this.kind);
  }
}

export const providerConfigured = (p: AIProvider) => Boolean(p === "gemini" ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY);

// ---- Provider health ---------------------------------------------------------------------------------------------
// After a failure that won't clear in seconds (no credit, quota, overload), the provider is skipped for a while so
// requests fail fast or go straight to the other provider. A successful request or AI test clears it.
const down = new Map<AIProvider, { kind: FailureKind; message: string; until: number }>();
export function providerHealth(p: AIProvider) {
  const d = down.get(p);
  if (d && d.until <= Date.now()) down.delete(p);
  return down.get(p) ?? null;
}
function recordOutcome(p: AIProvider, e: AIProviderError | null) {
  if (!e) return void down.delete(p);
  const ms = cooldownMs(e.kind);
  if (ms) down.set(p, { kind: e.kind, message: e.message, until: Date.now() + ms });
}

/** One structured log line per provider call: provider, model, outcome, error type, status, attempts, latency. No keys. */
export function logAICall(entry: { provider: AIProvider; model: string; feature?: string; ok: boolean; kind?: FailureKind; status?: number | null; attempts: number; latencyMs: number }) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  if (entry.ok) console.info(`[ai] ${line}`);
  else console.warn(`[ai] ${redactSecrets(line)}`);
}

// ---- Anthropic ------------------------------------------------------------------------------------------------------
let anthropic: Anthropic | null = null;

async function anthropicGenerate(i: GenerateInput): Promise<GenerateOutput> {
  if (!providerConfigured("anthropic")) throw new AIProviderError(failureMessage("anthropic", "not_configured"), "anthropic", "not_configured");
  // the SDK retries 408/409/429/5xx itself with exponential backoff (2 retries)
  anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: MAX_RETRIES });
  // Server-side refusal fallback exists for Opus/Sonnet/Fable, not Haiku.
  const fallback = /^claude-(opus|sonnet|fable)/.test(i.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : { betas: [] as string[] };
  const started = Date.now();
  try {
    const message = await anthropic.beta.messages
      .stream({
        model: i.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...fallback,
        output_config: { effort: i.effort, format: betaZodOutputFormat(i.schema) },
        // The system prompt is identical across calls of a feature: cached when long enough (≥ the model's minimum).
        system: [{ type: "text", text: i.system, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: i.pdfs?.length
            ? [...i.pdfs.map((data) => ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } })), { type: "text" as const, text: i.prompt }]
            : i.prompt,
        }],
      })
      .finalMessage();
    const u = message.usage;
    const usage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    if (message.stop_reason === "refusal") throw Object.assign(new AIProviderError(failureMessage("anthropic", "refused"), "anthropic", "refused"), { usage });
    if (message.stop_reason === "max_tokens") throw Object.assign(new AIProviderError(failureMessage("anthropic", "truncated"), "anthropic", "truncated"), { usage });
    return { text: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""), usage, attempts: 1, latencyMs: Date.now() - started };
  } catch (e) {
    throw Object.assign(toProviderError(e, "anthropic", 1), { latencyMs: Date.now() - started });
  }
}

// ---- Gemini ---------------------------------------------------------------------------------------------------------
let gemini: GoogleGenAI | null = null;
const GEMINI_THINKING: Record<Effort, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH, xhigh: ThinkingLevel.HIGH };
/** No first chunk within this delay = the request is queued under load: abort and retry instead of waiting 5 minutes. */
const FIRST_CHUNK_MS = 90_000;
/** One attempt may stream for at most this long. */
const ATTEMPT_MS = 6 * 60_000;
/** No new retry once this much time has passed in total. */
const RETRY_WINDOW_MS = 4 * 60_000;

async function geminiOnce(i: GenerateInput): Promise<Omit<GenerateOutput, "attempts" | "latencyMs">> {
  // retries are ours (below), so the SDK makes a single attempt
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { retryOptions: { attempts: 1 } } });
  const abort = new AbortController();
  let reason: "first_chunk_timeout" | "attempt_timeout" | null = null;
  const firstTimer = setTimeout(() => { reason = "first_chunk_timeout"; abort.abort(); }, FIRST_CHUNK_MS);
  const totalTimer = setTimeout(() => { reason = "attempt_timeout"; abort.abort(); }, ATTEMPT_MS);
  try {
    // Streamed: thought summaries keep the connection alive while the model reasons; only answer parts are kept.
    const stream = await gemini.models.generateContentStream({
      model: i.model,
      contents: [{ role: "user", parts: [...(i.pdfs ?? []).map((data) => ({ inlineData: { mimeType: "application/pdf", data } })), { text: i.prompt }] }],
      config: {
        abortSignal: abort.signal,
        // Stable system instruction first: Gemini caches repeated prefixes implicitly (reported as cached tokens).
        systemInstruction: i.system,
        responseMimeType: "application/json",
        responseJsonSchema: geminiJsonSchema(i.schema),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // thinkingLevel exists on Gemini 3+; 2.5 models use their default thinking budget
        ...(/^gemini-[34]/.test(i.model) ? { thinkingConfig: { thinkingLevel: GEMINI_THINKING[i.effort], includeThoughts: true } } : {}),
      },
    });
    let text = "";
    let m: NonNullable<GenerateContentResponse["usageMetadata"]> = {};
    let finish: FinishReason | undefined;
    for await (const chunk of stream) {
      clearTimeout(firstTimer);
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) if (part.text && !part.thought) text += part.text;
      if (chunk.usageMetadata) m = chunk.usageMetadata;
      finish = chunk.candidates?.[0]?.finishReason ?? finish;
    }
    const cached = m.cachedContentTokenCount ?? 0;
    const usage = { input: Math.max(0, (m.promptTokenCount ?? 0) - cached), output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0), cacheRead: cached, cacheWrite: 0 };
    if (finish === FinishReason.MAX_TOKENS) throw Object.assign(new AIProviderError(failureMessage("gemini", "truncated"), "gemini", "truncated"), { usage });
    if (!text || (finish && finish !== FinishReason.STOP)) throw Object.assign(new AIProviderError(failureMessage("gemini", "refused"), "gemini", "refused"), { usage });
    return { text, usage };
  } catch (e) {
    if (reason) throw new AIProviderError(failureMessage("gemini", "overloaded"), "gemini", classifyNetwork("first_chunk_timeout"));
    throw toProviderError(e, "gemini", 1);
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
  }
}

/** Gemini with up to 2 retries (exponential backoff) on temporary failures; quota / rate limits are not retried. */
async function geminiGenerate(i: GenerateInput): Promise<GenerateOutput> {
  if (!providerConfigured("gemini")) throw new AIProviderError(failureMessage("gemini", "not_configured"), "gemini", "not_configured");
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const t = Date.now();
    try {
      const out = await geminiOnce(i);
      return { ...out, attempts: attempt, latencyMs: Date.now() - started };
    } catch (e) {
      const err = e instanceof AIProviderError ? e : (toProviderError(e, "gemini", attempt) as AIProviderError);
      const retry = isRetryable(err.kind) && attempt <= MAX_RETRIES && Date.now() - started < RETRY_WINDOW_MS;
      logAICall({ provider: "gemini", model: i.model, ok: false, kind: err.kind, status: err.status, attempts: attempt, latencyMs: Date.now() - t });
      if (!retry) {
        // the final message says how many attempts were made
        const final = err.kind === "overloaded" || err.kind === "server" || err.kind === "network"
          ? Object.assign(new AIProviderError(failureMessage("gemini", err.kind, { status: err.status, attempts: attempt }), "gemini", err.kind, err.status), { usage: err.usage })
          : err;
        throw Object.assign(final, { attempts: attempt, latencyMs: Date.now() - started });
      }
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
}

function toProviderError(e: unknown, provider: AIProvider, attempts: number): AIProviderError {
  if (e instanceof AIProviderError) return e;
  const status = e instanceof ApiError ? e.status : e instanceof Anthropic.APIError ? e.status ?? null : null;
  if (status != null) {
    const kind = classifyStatus(status, e instanceof Error ? e.message : "");
    return new AIProviderError(failureMessage(provider, kind, { status, attempts }), provider, kind, status);
  }
  // network-level failures (DNS, reset, timeout) surface as a bare "fetch failed" TypeError
  if (e instanceof Error && (e instanceof Anthropic.APIConnectionError || /fetch failed|network|socket|ECONN/i.test(e.message))) {
    const kind = classifyNetwork((e as { cause?: { code?: string } }).cause?.code);
    return new AIProviderError(failureMessage(provider, kind, { attempts }), provider, kind);
  }
  return new AIProviderError(e instanceof Error ? e.message : "Unexpected AI error.", provider, "server");
}

/**
 * Calls one provider. Every call is logged (provider, model, outcome, error type, latency) and updates the provider's
 * health; failures always carry their kind, status, attempts and latency.
 */
export async function generate(provider: AIProvider, input: GenerateInput, feature?: string): Promise<GenerateOutput> {
  try {
    const out = provider === "gemini" ? await geminiGenerate(input) : await anthropicGenerate(input);
    recordOutcome(provider, null);
    logAICall({ provider, model: input.model, feature, ok: true, attempts: out.attempts, latencyMs: out.latencyMs });
    return out;
  } catch (e) {
    const err = e instanceof AIProviderError ? e : toProviderError(e, provider, 1);
    recordOutcome(provider, err);
    if (provider === "anthropic") logAICall({ provider, model: input.model, feature, ok: false, kind: err.kind, status: err.status, attempts: err.attempts, latencyMs: err.latencyMs });
    throw err;
  }
}
