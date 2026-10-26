import "server-only";
import { createClient } from "@/lib/supabase/server";

export type UsageRow = {
  day: string; provider: string; model: string; feature: string; created_by: string | null; status: "running" | "succeeded" | "failed";
  requests: number; input_tokens: number; cached_input_tokens: number; output_tokens: number; cost_usd: number; unpriced: number;
};
export type AIRunRow = {
  id: string; project_id: string | null; feature: string; provider: string; model: string; tier: string | null; status: "running" | "succeeded" | "failed";
  input_tokens: number | null; cached_input_tokens: number; output_tokens: number | null; cost_usd: number | null; duration_ms: number | null;
  attempts: number; fallback_from: string | null; error: string | null; created_by: string | null; created_at: string;
};

/** Aggregated usage for a workspace and period (computed in Postgres; RLS limits it to members). */
export async function usageBreakdown(workspaceId: string, from: Date, to: Date): Promise<UsageRow[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("ai_usage_breakdown", { p_workspace: workspaceId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw error;
  return ((data ?? []) as UsageRow[]).map((r) => ({ ...r, requests: Number(r.requests), input_tokens: Number(r.input_tokens), cached_input_tokens: Number(r.cached_input_tokens), output_tokens: Number(r.output_tokens), cost_usd: Number(r.cost_usd), unpriced: Number(r.unpriced) }));
}

export async function monthToDateCost(workspaceId: string) {
  const db = await createClient();
  const d = new Date();
  const { data } = await db.rpc("ai_cost_since", { p_workspace: workspaceId, p_from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() });
  return Number(data ?? 0);
}

/** The request log, newest first. */
export async function recentRuns(workspaceId: string, from: Date, to: Date, opts: { status?: string; limit?: number; offset?: number } = {}) {
  const db = await createClient();
  let q = db.from("ai_runs")
    .select("id, project_id, feature, provider, model, tier, status, input_tokens, cached_input_tokens, output_tokens, cost_usd, duration_ms, attempts, fallback_from, error, created_by, created_at", { count: "exact" })
    .eq("workspace_id", workspaceId).gte("created_at", from.toISOString()).lt("created_at", to.toISOString())
    .order("created_at", { ascending: false }).range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error, count } = await q;
  if (error) throw error;
  return { runs: (data ?? []).map((r) => ({ ...r, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd) })) as AIRunRow[], total: count ?? 0 };
}
