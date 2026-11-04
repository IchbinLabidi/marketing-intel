import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StrategyEntity } from "@/lib/validation/strategy";
import type { Campaign, ContentPillar, Kpi, Persona, Strategy, StrategyBundle } from "@/types/domain";

export async function getStrategyBundle(projectId: string): Promise<StrategyBundle> {
  const supabase = await createClient();
  const [strategy, personas, pillars, campaigns, kpis] = await Promise.all([
    supabase.from("strategies").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("personas").select("*").eq("project_id", projectId).order("position").order("created_at"),
    supabase.from("content_pillars").select("*").eq("project_id", projectId).is("retired_at", null).order("position").order("created_at"),
    supabase.from("campaigns").select("*").eq("project_id", projectId).order("starts_on", { nullsFirst: false }),
    supabase.from("kpis").select("*").eq("project_id", projectId).order("created_at"),
  ]);
  for (const r of [strategy, personas, pillars, campaigns, kpis]) if (r.error) throw r.error;
  return {
    strategy: strategy.data as Strategy | null,
    personas: (personas.data ?? []) as Persona[],
    pillars: (pillars.data ?? []) as ContentPillar[],
    campaigns: (campaigns.data ?? []) as Campaign[],
    kpis: (kpis.data ?? []) as Kpi[],
  };
}

export async function saveStrategyFields(projectId: string, userId: string, fields: Partial<Omit<Strategy, "project_id" | "updated_at">>) {
  const supabase = await createClient();
  const { error } = await supabase.from("strategies").upsert({ project_id: projectId, updated_by: userId, ...fields });
  if (error) throw error;
}

export async function upsertStrategyEntity(
  entity: StrategyEntity,
  projectId: string,
  id: string | null,
  values: Record<string, unknown>,
) {
  const supabase = await createClient();
  const query = id
    ? supabase.from(entity).update(values).eq("id", id).eq("project_id", projectId)
    : supabase.from(entity).insert({ ...values, project_id: projectId });
  const { error } = await query;
  if (error) throw error;
}

export async function deleteStrategyEntity(entity: StrategyEntity, projectId: string, id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from(entity).delete().eq("id", id).eq("project_id", projectId);
  if (error) throw error;
}

/** Share of strategy sections that have content. Used for dashboards and AI readiness. `key` is a `strategy.completeness.*` message key. */
export function strategyCompleteness(bundle: StrategyBundle) {
  const s = bundle.strategy;
  const checks = [
    { key: "businessObjectives" as const, done: Boolean(s?.business_objectives) },
    { key: "marketingObjectives" as const, done: Boolean(s?.marketing_objectives) },
    { key: "positioning" as const, done: Boolean(s?.brand_positioning) },
    { key: "valueProposition" as const, done: Boolean(s?.value_proposition) },
    { key: "brandVoice" as const, done: Boolean(s && Object.values(s.brand_voice ?? {}).some(Boolean)) },
    { key: "customerJourney" as const, done: Boolean(s && (s.customer_journey ?? []).length > 0) },
    { key: "funnel" as const, done: Boolean(s && Object.values(s.funnel ?? {}).some(Boolean)) },
    { key: "personas" as const, done: bundle.personas.length > 0 },
    { key: "contentPillars" as const, done: bundle.pillars.length > 0 },
    { key: "campaigns" as const, done: bundle.campaigns.length > 0 },
    { key: "kpis" as const, done: bundle.kpis.length > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return { percent: Math.round((done / checks.length) * 100), checks };
}
