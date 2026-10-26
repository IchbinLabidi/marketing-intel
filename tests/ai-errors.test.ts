import { describe, expect, it } from "vitest";
import { allowsFallback, backoffMs, classifyNetwork, classifyStatus, cooldownMs, failureMessage, isRetryable, MAX_RETRIES, redactSecrets, startWith } from "@/lib/ai/errors";

describe("AI failure classification", () => {
  it("separates temporary overload (503) from rate limits and quota (429)", () => {
    expect(classifyStatus(503, "This model is currently experiencing high demand.")).toBe("overloaded");
    expect(classifyStatus(529, "Overloaded")).toBe("overloaded");
    expect(classifyStatus(429, "Resource has been exhausted (e.g. check quota).")).toBe("quota");
    expect(classifyStatus(429, "RESOURCE_EXHAUSTED: You exceeded your current quota")).toBe("quota");
    expect(classifyStatus(429, "Too many requests, slow down")).toBe("rate_limit");
    expect(classifyStatus(400, "Your credit balance is too low to access the Anthropic API.")).toBe("billing");
    expect(classifyStatus(400, "API key not valid. Please pass a valid API key.")).toBe("auth");
    expect(classifyStatus(401, "")).toBe("auth");
    expect(classifyStatus(400, "Invalid schema")).toBe("bad_request");
    expect(classifyStatus(500, "internal")).toBe("server");
  });

  it("treats a connection that never answers as overload, other network faults as network errors", () => {
    expect(classifyNetwork("UND_ERR_HEADERS_TIMEOUT")).toBe("overloaded");
    expect(classifyNetwork("first_chunk_timeout")).toBe("overloaded");
    expect(classifyNetwork("ECONNRESET")).toBe("network");
    expect(classifyNetwork(undefined)).toBe("network");
  });

  it("retries only temporary failures, and falls back on anything the other provider might serve", () => {
    expect(MAX_RETRIES).toBe(2);
    expect(isRetryable("overloaded")).toBe(true);
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("quota")).toBe(false);
    expect(isRetryable("rate_limit")).toBe(false);
    expect(isRetryable("billing")).toBe(false);
    for (const k of ["overloaded", "quota", "rate_limit", "billing", "auth", "not_configured"] as const) expect(allowsFallback(k)).toBe(true);
    for (const k of ["bad_request", "refused", "truncated", "invalid_output"] as const) expect(allowsFallback(k)).toBe(false);
  });

  it("backs off exponentially with bounded jitter", () => {
    expect(backoffMs(1, () => 0.5)).toBe(2000);
    expect(backoffMs(2, () => 0.5)).toBe(4000);
    expect(backoffMs(1, () => 0)).toBe(1500);
    expect(backoffMs(2, () => 1)).toBe(5000);
  });

  it("keeps lasting failures out of rotation for a while, but not refusals", () => {
    expect(cooldownMs("billing")).toBe(30 * 60_000);
    expect(cooldownMs("quota")).toBe(15 * 60_000);
    expect(cooldownMs("overloaded")).toBe(3 * 60_000);
    expect(cooldownMs("refused")).toBe(0);
  });

  it("falls back to Claude only when it has a key and isn't known to be unavailable; fails fast when both are down", () => {
    expect(startWith(false, { configured: true, down: true })).toBe("primary");
    expect(startWith(true, { configured: true, down: false })).toBe("fallback");
    expect(startWith(true, { configured: true, down: true })).toBe("fail");
    expect(startWith(true, { configured: false, down: false })).toBe("fail");
    expect(startWith(true, null)).toBe("fail");
  });

  it("writes clear messages and never leaks keys", () => {
    expect(failureMessage("gemini", "overloaded", { status: 503, attempts: 3 })).toBe("Gemini is overloaded (high demand, HTTP 503) after 3 attempts. This is temporary on the provider's side.");
    expect(failureMessage("anthropic", "billing")).toMatch(/Claude has no credit left/);
    // fake values in the real formats (never a real key)
    const leaky = "request to https://x/v1?key=AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE00000 failed; header x-api-key: sk-ant-api03-abcdefghijklmnop1234";
    const clean = redactSecrets(leaky);
    expect(clean).not.toMatch(/AIzaSyFAKE|sk-ant-api03-abc/);
    expect(clean).toContain("[redacted]");
  });
});
