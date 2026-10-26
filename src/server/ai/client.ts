import "server-only";
import { KIND_LABELS, PROVIDER_NAMES } from "@/lib/ai/errors";
import { AIProviderError, providerConfigured } from "./providers";

export class AIBudgetExceededError extends Error {
  constructor(readonly budget: number) {
    super(`This workspace reached its monthly AI budget ($${budget}). AI features resume next month, or raise AI_MONTHLY_BUDGET_USD.`);
  }
}

/** Every provider that could answer failed (or is known to be unavailable): one message naming each one. */
export class AIAllProvidersFailedError extends Error {
  constructor(readonly failures: AIProviderError[]) {
    super(`No AI provider could answer. ${failures.map((f) => `${PROVIDER_NAMES[f.provider]}: ${KIND_LABELS[f.kind]} — ${f.message}`).join(" ")} Try again later${failures.some((f) => f.kind === "billing" || f.kind === "quota") ? ", or add credit / raise the quota" : ""}.`);
  }
}

/** True when at least one AI provider has an API key (Gemini or Anthropic). Keys stay on the server. */
export function isAIConfigured() {
  return providerConfigured("gemini") || providerConfigured("anthropic");
}

/** Translates provider errors into messages that are safe and useful to show to end users. */
export function describeAIError(error: unknown): string {
  if (error instanceof AIProviderError || error instanceof AIBudgetExceededError || error instanceof AIAllProvidersFailedError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected AI error.";
}
