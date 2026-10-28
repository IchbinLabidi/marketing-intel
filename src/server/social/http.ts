import "server-only";

/** An API error with what the sync needs to decide: retry, ask to reconnect, or report a missing permission. */
export class SocialApiError extends Error {
  constructor(message: string, readonly status: number, readonly provider: string, readonly kind: "auth" | "permission" | "rate_limit" | "not_found" | "server" | "network" | "other") {
    super(message);
  }
  get isAuth() { return this.kind === "auth"; }
  get isPermission() { return this.kind === "permission"; }
}

export type Counter = { calls: number; onCall?: (n: number) => void };

const TIMEOUT_MS = 30_000;
const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const e = b.error as Record<string, unknown> | string | undefined;
  if (typeof e === "string") return (b.error_description as string) || e;
  if (e && typeof e === "object") return (e.message as string) || (e.code as string) || null;
  return (b.message as string) || null;
}

/** Maps HTTP status and provider error codes to a kind. TikTok returns HTTP 200 with error.code ≠ "ok". */
export function classify(status: number, body: unknown): SocialApiError["kind"] {
  const code = String(((body as { error?: { code?: unknown } })?.error?.code ?? (body as { error?: unknown })?.error) ?? "").toLowerCase();
  if (status === 401 || /access_token_invalid|invalid_token|token.*expired|unauthenticated|invalid_grant/.test(code)) return "auth";
  if (status === 429 || /rate_limit|ratelimit|quota/.test(code)) return "rate_limit";
  if (status === 403 || /scope_not_authorized|permission|forbidden|insufficient/.test(code)) return status === 403 && /quota/.test(code) ? "rate_limit" : "permission";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "other";
}

/**
 * JSON request with a timeout and retries for temporary failures (429, 5xx, network), honouring Retry-After.
 * Never logs tokens: URLs and headers stay out of error messages.
 */
export async function requestJson<T>(provider: string, url: string, init: RequestInit = {}, counter?: Counter, okCheck?: (body: unknown) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (counter) { counter.calls++; counter.onCall?.(counter.calls); }
    let res: Response;
    try {
      res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (attempt < RETRIES) { await sleep(1000 * 2 ** attempt); continue; }
      throw new SocialApiError(`${provider} API unreachable (${e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network error"})`, 0, provider, "network");
    }
    const body = await res.json().catch(() => null);
    const failed = !res.ok || (okCheck ? !okCheck(body) : false);
    if (!failed) return body as T;
    const kind = classify(res.status, body);
    if ((kind === "rate_limit" || kind === "server") && attempt < RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new SocialApiError(errorMessage(body) || `${provider} API error (${res.status})`, res.status, provider, kind);
  }
}

export const form = (data: Record<string, string>) => new URLSearchParams(data).toString();
