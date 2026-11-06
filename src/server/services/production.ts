import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentTemplate, ProductionAsset, ProductionEvent, ProductionItem, ProductionVersion } from "@/lib/production/model";
import { listItemTasks, type Task } from "./team";

export async function listProduction(projectId: string): Promise<ProductionItem[]> {
  const db = await createClient();
  const rows: ProductionItem[] = [];
  // Fetch every page: Supabase's default 1,000-row cap must not hide assigned tasks.
  for (let from = 0; ; from += 500) {
    // Backlog ideas (Idea stage, no calendar date, never on the board) and archived ideas live in the Ideas Backlog;
    // a card moved back to Idea from the board stays on the board (on_board)
    const { data, error } = await db.from("content_items").select("*").eq("project_id", projectId).is("archived_at", null)
      .or("production_stage.neq.idea,scheduled_date.not.is.null,on_board.is.true").order("created_at", { ascending: false }).order("id").range(from, from + 499);
    if (error) throw error;
    rows.push(...data as ProductionItem[]);
    if (data.length < 500) break;
  }
  // Manual board order. Read separately (not embedded) so the board still loads if the table is missing.
  const positions = new Map<string, { board_column: string; position: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("content_board_positions").select("content_item_id,board_column,position").eq("project_id", projectId).order("content_item_id").range(from, from + 999);
    if (error) { console.error("board positions", error.message); break; }
    for (const r of data as { content_item_id: string; board_column: string; position: number }[]) positions.set(r.content_item_id, r);
    if (data.length < 1000) break;
  }
  return rows.map((r) => { const p = positions.get(r.id); return p ? { ...r, board_column: p.board_column, board_position: p.position } : r; });
}
export async function listTemplates(projectId: string): Promise<ContentTemplate[]> {
  const db = await createClient();
  const { data, error } = await db.from("content_templates").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data as ContentTemplate[];
}
export type ProductionDetails = { events: ProductionEvent[]; versions: ProductionVersion[]; assets: ProductionAsset[]; item: ProductionItem; tasks: Task[] };
export async function productionDetails(projectId: string, id: string): Promise<ProductionDetails> {
  const db = await createClient();
  const [events, versions, assets] = await Promise.all([
    db.from("content_activity").select("*").eq("project_id", projectId).eq("content_item_id", id).order("created_at", { ascending: false }),
    db.from("content_versions").select("*").eq("project_id", projectId).eq("content_item_id", id).order("revision", { ascending: false }),
    db.from("content_assets").select("id, body, created_at").eq("project_id", projectId).eq("content_item_id", id).eq("kind", "media").order("created_at"),
  ]);
  for (const result of [events, versions, assets]) if (result.error) throw result.error;
  const media = await Promise.all((assets.data as ProductionAsset[]).map(async (asset) => {
    if (!asset.body.path) return asset;
    const { data, error } = await db.storage.from("production-media").createSignedUrl(asset.body.path, 3600);
    if (error) throw error;
    return { ...asset, signedUrl: data.signedUrl };
  }));
  const [{ data: item, error }, tasks] = await Promise.all([
    db.from("content_items").select("*").eq("project_id", projectId).eq("id", id).single(),
    listItemTasks(projectId, id),
  ]);
  if (error) throw error;
  return { events: events.data as ProductionEvent[], versions: versions.data as ProductionVersion[], assets: media, item: item as ProductionItem, tasks };
}
