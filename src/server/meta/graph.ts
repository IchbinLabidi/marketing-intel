import "server-only";
import { appSecretProof } from "./crypto";
import { META_GRAPH_HOST, META_GRAPH_VERSION, metaConfig } from "./config";

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly subcode: number | undefined,
    readonly status: number,
  ) {
    super(message);
  }
  /** 190 = invalid/expired token; 102 = session expired; 463/467 subcodes = expired/invalid. */
  get isTokenError() {
    return this.code === 190 || this.code === 102 || this.subcode === 463 || this.subcode === 467;
  }
  /** App, user or Page-level throttling. */
  get isRateLimit() {
    return [4, 17, 32, 613, 80001, 80002].includes(this.code ?? -1);
  }
  get isPermissionError() {
    return this.code === 10 || (this.code !== undefined && this.code >= 200 && this.code < 300);
  }
  /** Invalid parameter, which for insights usually means a metric this media/account doesn't support. */
  get isInvalidParameter() {
    return this.code === 100;
  }
}

/** Counts API calls; `onCall` lets long syncs report progress (heartbeat) while paging. */
export type GraphCounter = { calls: number; onCall?: (calls: number) => void };

const TIMEOUT_MS = 30_000;

function withAuth(url: URL, token: string) {
  url.searchParams.set("access_token", token);
  const { appSecret } = metaConfig();
  if (appSecret) url.searchParams.set("appsecret_proof", appSecretProof(token, appSecret));
  return url;
}

async function request<T>(url: URL, init: RequestInit | undefined, counter?: GraphCounter): Promise<T> {
  if (counter) {
    counter.calls++;
    counter.onCall?.(counter.calls);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000}s` : e instanceof Error ? e.message : "network error";
    throw new MetaApiError(`Meta API unreachable (${reason})`, undefined, undefined, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    throw new MetaApiError(e.message || `Meta API error (${res.status})`, e.code, e.error_subcode, res.status);
  }
  return body as T;
}

export function graphUrl(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(path.startsWith("http") ? path : `${META_GRAPH_HOST}/${META_GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url;
}

export function graphGet<T>(path: string, params: Record<string, string | number | undefined>, token: string, counter?: GraphCounter) {
  return request<T>(withAuth(graphUrl(path, params), token), undefined, counter);
}

type Page<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } } };

/**
 * Follows cursor pagination until `max` items or `stop(item)` returns true (items arrive newest first).
 * Only follows `next` URLs on graph.facebook.com.
 */
export async function graphPaginate<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
  { max, stop, counter }: { max: number; stop?: (item: T) => boolean; counter?: GraphCounter },
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let url: URL | null = withAuth(graphUrl(path, params), token);
  while (url) {
    const page: Page<T> = await request<Page<T>>(url, undefined, counter);
    const data = page.data ?? [];
    for (let k = 0; k < data.length; k++) {
      if (stop?.(data[k])) return { items, truncated: false };
      items.push(data[k]);
      if (items.length >= max) return { items, truncated: k < data.length - 1 || Boolean(page.paging?.next) };
    }
    const next: string | undefined = page.paging?.next;
    url = next && new URL(next).host === new URL(META_GRAPH_HOST).host ? withAuth(new URL(next), token) : null;
  }
  return { items, truncated: false };
}

export type BatchItem = { method: "GET"; relative_url: string };
export type BatchResult<T> = { ok: true; body: T } | { ok: false; error: MetaApiError };

/** Graph batch request (max 50 per call) — one HTTP round trip for many insight reads. */
export async function graphBatch<T>(items: BatchItem[], token: string, counter?: GraphCounter): Promise<BatchResult<T>[]> {
  const out: BatchResult<T>[] = [];
  for (let k = 0; k < items.length; k += 50) {
    const chunk = items.slice(k, k + 50);
    const url = withAuth(graphUrl(""), token);
    const form = new URLSearchParams({ batch: JSON.stringify(chunk), include_headers: "false" });
    for (const [key, value] of url.searchParams) form.set(key, value);
    const responses = await request<{ code: number; body: string }[]>(new URL(`${META_GRAPH_HOST}/${META_GRAPH_VERSION}/`), { method: "POST", body: form }, counter);
    for (const r of responses) {
      const body = (() => { try { return JSON.parse(r?.body ?? "{}"); } catch { return {}; } })();
      if (!r || r.code !== 200 || body?.error) {
        const e = body?.error ?? {};
        out.push({ ok: false, error: new MetaApiError(e.message || `Meta API error (${r?.code ?? "?"})`, e.code, e.error_subcode, r?.code ?? 500) });
      } else out.push({ ok: true, body: body as T });
    }
  }
  return out;
}
