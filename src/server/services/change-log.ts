import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingTeamSchema } from "@/server/services/team";

export type ChangeArea = "strategy" | "content";
export type ChangeEntry = {
  id: string;
  actor_id: string | null;
  area: ChangeArea;
  entity: "strategy" | "brand" | "persona" | "pillar" | "campaign" | "kpi" | "content";
  entity_id: string | null;
  label: string;
  action: "created" | "updated" | "deleted";
  fields: string[];
  created_at: string;
};

export const CHANGE_LOG_LIMIT = 200;

/** Latest changes for a project (RLS hides strategy entries from members without strategy.view). null = migration 0028 not applied. */
export async function listChangeLog(projectId: string, area?: ChangeArea): Promise<ChangeEntry[] | null> {
  const db = await createClient();
  let q = db
    .from("project_change_log")
    .select("id, actor_id, area, entity, entity_id, label, action, fields, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(CHANGE_LOG_LIMIT);
  if (area) q = q.eq("area", area);
  const { data, error } = await q;
  if (error) {
    if (isMissingTeamSchema(error)) return null;
    throw error;
  }
  return data as ChangeEntry[];
}
