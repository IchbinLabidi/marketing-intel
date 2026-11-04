// How provider failures are classified, retried and reported. Pure, so the rules are unit-tested.
//   overloaded  503 / 529 / "high demand" / no answer at all → temporary: retried (2 retries, exponential backoff)
//   rate_limit  429 without quota wording                 → too many requests: not retried, other provider tried
//   quota       429 RESOURCE_EXHAUSTED / quota exceeded     → plan limit reached: not retried, other provider tried
//   billing     no credit left                            → not retried, other provider tried
//   auth        key rejected                              → not retried, other provider tried

import type { AIProvider } from "./models";
import { createTranslator, type MessageTree } from "@/i18n/core";
import type { KeysOf, TFor } from "@/i18n/messages";
import enErrors from "@/i18n/locales/en/errors";

export type FailureKind =
  | "not_configured" | "auth" | "billing" | "quota" | "rate_limit" | "overloaded" | "network" | "server" | "bad_request" | "refused" | "truncated" | "invalid_output";

/** English translator, used when no translator is passed (logs, stored messages, code running outside a request). */
const EN_ERRORS: TFor<"errors"> = createTranslator<KeysOf["errors"]>("en", "errors", enErrors as unknown as MessageTree);

/** English labels (kept for existing callers); use `kindLabel(kind, t)` to show one in the viewer's language. */
export const KIND_LABELS: Record<FailureKind, string> = enErrors.ai.kind;

/** Short label of a failure kind, in the language of `t` (English by default). */
export const kindLabel = (kind: FailureKind, t: TFor<"errors"> = EN_ERRORS) => t(`ai.kind.${kind}`);

export const PROVIDER_NAMES: Record<AIProvider, string> = { gemini: "Gemini", anthropic: "Claude" };

/** Temporary failures worth retrying on the same provider. */
export const isRetryable = (k: FailureKind) => k === "overloaded" || k === "server" || k === "network";
/** Failures where the other provider may still answer. */
export const allowsFallback = (k: FailureKind) => ["not_configured", "auth", "billing", "quota", "rate_limit", "overloaded", "network", "server"].includes(k);
/** How long a provider is skipped after a failure that won't go away by itself in seconds (ms). */
export function cooldownMs(k: FailureKind) {
  return k === "billing" || k === "auth" ? 30 * 60_000 : k === "quota" ? 15 * 60_000 : k === "overloaded" ? 3 * 60_000 : k === "rate_limit" ? 60_000 : 0;
}

export const MAX_RETRIES = 2;
/** Exponential backoff with ±25% jitter: ~2 s, ~4 s. `random` is injectable for tests. */
export function backoffMs(retry: number, random: () => number = Math.random) {
  return Math.round(2000 * 2 ** (retry - 1) * (0.75 + random() * 0.5));
}

/** Classifies an HTTP status + provider message (both providers use the same rules). */
export function classifyStatus(status: number | null | undefined, message: string): FailureKind {
  const m = message.toLowerCase();
  if (/credit balance is too low/.test(m)) return "billing";
  if (status === 401 || status === 403 || /api key not valid|api_key_invalid|invalid x-api-key|authentication/.test(m)) return "auth";
  if (status === 429) return /resource_exhausted|quota|exceeded your current|billing|check your plan/.test(m) ? "quota" : "rate_limit";
  if (status === 503 || status === 529 || /overloaded|high demand|unavailable/.test(m)) return "overloaded";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status != null && status >= 500) return "server";
  return "server";
}

/** Network-level failures (fetch failed). A connection that gets no answer at all is treated as overload. */
export function classifyNetwork(code: string | null | undefined): FailureKind {
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "first_chunk_timeout" ? "overloaded" : "network";
}

/** User-facing failure message, in the language of `t` (English by default, e.g. for logs and stored errors). */
export function failureMessage(
  provider: AIProvider,
  kind: FailureKind,
  detail: { status?: number | null; attempts?: number } = {},
  t: TFor<"errors"> = EN_ERRORS,
) {
  const name = PROVIDER_NAMES[provider];
  const envVar = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  const tries = detail.attempts && detail.attempts > 1 ? t("ai.tries", { count: detail.attempts }) : "";
  switch (kind) {
    case "not_configured": return t("ai.failure.not_configured", { name, envVar });
    case "auth": return t("ai.failure.auth", { name, envVar });
    case "billing": return t(provider === "anthropic" ? "ai.failure.billingAnthropic" : "ai.failure.billing", { name });
    case "quota": return t(provider === "gemini" ? "ai.failure.quotaGemini" : "ai.failure.quota", { name });
    case "rate_limit": return t("ai.failure.rate_limit", { name });
    case "overloaded": return t("ai.failure.overloaded", { name, status: detail.status ? `, HTTP ${detail.status}` : "", tries });
    case "network": return t("ai.failure.network", { name, tries });
    case "server": return t("ai.failure.server", { name, status: detail.status ? ` (HTTP ${detail.status})` : "", tries });
    case "bad_request": return t("ai.failure.bad_request", { name, status: detail.status ? ` (HTTP ${detail.status})` : "" });
    case "refused": return t("ai.failure.refused", { name });
    case "truncated": return t("ai.failure.truncated", { name });
    case "invalid_output": return t("ai.failure.invalid_output", { name });
  }
}

/**
 * Which provider to call first, given what is known about each one right now (null = no recent lasting failure):
 * the routed one, the other one directly (routed one known unavailable), or none (both known unavailable → fail fast
 * with a combined message instead of waiting minutes for the same failures).
 */
export function startWith(primaryDown: boolean, fallback: { configured: boolean; down: boolean } | null): "primary" | "fallback" | "fail" {
  const fallbackUsable = Boolean(fallback?.configured && !fallback.down);
  if (!primaryDown) return "primary";
  return fallbackUsable ? "fallback" : "fail";
}

/** Removes anything that looks like an API key or bearer token before a message is logged or stored. */
export function redactSecrets(text: string) {
  return text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/sk-ant-[0-9A-Za-z_-]{10,}/g, "[redacted]")
    .replace(/(key=|api[_-]?key["':\s]+|bearer\s+)[0-9A-Za-z._-]{16,}/gi, "$1[redacted]");
}
