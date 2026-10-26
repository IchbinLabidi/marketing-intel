// How provider failures are classified, retried and reported. Pure, so the rules are unit-tested.
//   overloaded  503 / 529 / "high demand" / no answer at all → temporary: retried (2 retries, exponential backoff)
//   rate_limit  429 without quota wording                 → too many requests: not retried, other provider tried
//   quota       429 RESOURCE_EXHAUSTED / quota exceeded     → plan limit reached: not retried, other provider tried
//   billing     no credit left                            → not retried, other provider tried
//   auth        key rejected                              → not retried, other provider tried

import type { AIProvider } from "./models";

export type FailureKind =
  | "not_configured" | "auth" | "billing" | "quota" | "rate_limit" | "overloaded" | "network" | "server" | "bad_request" | "refused" | "truncated" | "invalid_output";

export const KIND_LABELS: Record<FailureKind, string> = {
  not_configured: "not configured", auth: "API key rejected", billing: "no credit left", quota: "quota reached", rate_limit: "rate limited",
  overloaded: "overloaded", network: "network error", server: "server error", bad_request: "request rejected", refused: "declined", truncated: "answer cut off",
  invalid_output: "invalid answer",
};

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

export function failureMessage(provider: AIProvider, kind: FailureKind, detail: { status?: number | null; attempts?: number } = {}) {
  const name = PROVIDER_NAMES[provider];
  const tries = detail.attempts && detail.attempts > 1 ? ` after ${detail.attempts} attempts` : "";
  switch (kind) {
    case "not_configured": return `${name} is not configured (${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} missing).`;
    case "auth": return `${name} rejected the API key. Check ${provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"}.`;
    case "billing": return `${name} has no credit left${provider === "anthropic" ? " (Anthropic Console → Plans & Billing)" : ""}.`;
    case "quota": return `${name} quota is reached${provider === "gemini" ? " (Google AI Studio → plan and billing)" : ""}.`;
    case "rate_limit": return `${name} is rate limiting requests; wait a minute.`;
    case "overloaded": return `${name} is overloaded (high demand${detail.status ? `, HTTP ${detail.status}` : ""})${tries}. This is temporary on the provider's side.`;
    case "network": return `Could not reach ${name}${tries} (network error).`;
    case "server": return `${name} returned an error${detail.status ? ` (HTTP ${detail.status})` : ""}${tries}.`;
    case "bad_request": return `${name} rejected the request${detail.status ? ` (HTTP ${detail.status})` : ""}.`;
    case "refused": return `${name} declined this request.`;
    case "truncated": return `${name}'s answer was too long and got cut off; try a narrower request.`;
    case "invalid_output": return `${name}'s answer did not match the expected format.`;
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
