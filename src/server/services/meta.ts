import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { MetaConnection, MetaSyncRun } from "@/types/domain";
import { metaConfig } from "@/server/meta/config";
import { decryptToken, encryptToken } from "@/server/meta/crypto";

export async function getMetaConnection(projectId: string): Promise<MetaConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("meta_connections").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as MetaConnection | null;
}

export async function upsertMetaConnection(projectId: string, values: Partial<MetaConnection> & { connected_by?: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meta_connections")
    .upsert({ ...values, project_id: projectId }, { onConflict: "project_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as MetaConnection;
}

export async function updateMetaConnection(projectId: string, values: Partial<MetaConnection>) {
  const supabase = await createClient();
  const { error } = await supabase.from("meta_connections").update(values).eq("project_id", projectId);
  if (error) throw error;
}

/** Tokens are encrypted here, then written through a role-checked security-definer function. */
export async function storeMetaTokens(connectionId: string, tokens: { user?: string | null; page?: string | null }, db?: SupabaseClient) {
  const key = metaConfig().tokenKey;
  const supabase = db ?? (await createClient());
  const { error } = await supabase.rpc("meta_store_tokens", {
    p_connection: connectionId,
    p_user_token: tokens.user ? encryptToken(tokens.user, key) : null,
    p_page_token: tokens.page ? encryptToken(tokens.page, key) : null,
  });
  if (error) throw error;
}

export async function readMetaTokens(connectionId: string): Promise<{ user: string | null; page: string | null }> {
  const key = metaConfig().tokenKey;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meta_read_tokens", { p_connection: connectionId });
  if (error) throw error;
  const row = (data as { user_token_enc: string | null; page_token_enc: string | null }[] | null)?.[0];
  return {
    user: row?.user_token_enc ? decryptToken(row.user_token_enc, key) : null,
    page: row?.page_token_enc ? decryptToken(row.page_token_enc, key) : null,
  };
}

export async function clearMetaTokens(connectionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("meta_clear_tokens", { p_connection: connectionId });
  if (error) throw error;
}

export async function listSyncRuns(projectId: string, limit = 10): Promise<MetaSyncRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("meta_sync_runs").select("*").eq("project_id", projectId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as MetaSyncRun[];
}

export async function countMetaPosts(projectId: string) {
  const supabase = await createClient();
  const count = async (platform: string) =>
    (await supabase.from("historical_content_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("source", "meta_api").eq("platform", platform)).count ?? 0;
  const [facebook, instagram] = await Promise.all([count("facebook"), count("instagram")]);
  return { facebook, instagram };
}

export async function deleteMetaPosts(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("historical_content_items").delete().eq("project_id", projectId).eq("source", "meta_api");
  if (error) throw error;
}
