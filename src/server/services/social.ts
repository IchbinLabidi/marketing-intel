import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { SocialProvider } from "@/lib/social/normalize";
import { decryptToken, encryptToken } from "@/server/meta/crypto";
import { socialTokenKey } from "@/server/social/config";
import { SocialApiError } from "@/server/social/http";
import { PROVIDERS } from "@/server/social/providers";
import type { Access, TokenSet } from "@/server/social/types";
import { isMissingTeamSchema } from "./team";

export type SocialConnection = {
  id: string; project_id: string; provider: SocialProvider; auth_type: "api_key" | "oauth"; external_account_id: string;
  account_name: string | null; account_handle: string | null; account_url: string | null; avatar_url: string | null;
  status: "connected" | "needs_attention" | "permission_denied" | "disconnected";
  granted_scopes: string[]; declined_scopes: string[]; token_expires_at: string | null; auto_sync: boolean;
  followers: number | null; followers_updated_at: string | null; backfill_done: boolean;
  last_sync_at: string | null; last_success_at: string | null; last_sync_status: "running" | "succeeded" | "partial" | "failed" | null; last_error: string | null;
  created_at: string;
};
export type SocialSyncRun = { id: string; connection_id: string; trigger: string; status: string; stats: Record<string, number>; errors: { message: string }[]; started_at: string; finished_at: string | null };

/** True while migration 0015 hasn't been applied. */
export const isMissingSocialSchema = (e: unknown) => isMissingTeamSchema(e);

export async function listSocialConnections(projectId: string): Promise<{ connections: SocialConnection[]; ready: boolean }> {
  const db = await createClient();
  // Google Drive authorizations live in the same table but aren't social accounts (no posts to sync)
  const { data, error } = await db.from("social_connections").select("*").eq("project_id", projectId).neq("provider", "google_drive").order("created_at");
  if (error) {
    if (isMissingSocialSchema(error)) return { connections: [], ready: false };
    throw error;
  }
  return { connections: data as SocialConnection[], ready: true };
}

export async function getSocialConnection(projectId: string, id: string): Promise<SocialConnection | null> {
  const db = await createClient();
  const { data, error } = await db.from("social_connections").select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as SocialConnection | null;
}

export async function listSocialRuns(projectId: string, limit = 20): Promise<SocialSyncRun[]> {
  const db = await createClient();
  const { data, error } = await db.from("social_sync_runs").select("id, connection_id, trigger, status, stats, errors, started_at, finished_at").eq("project_id", projectId).order("started_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data as SocialSyncRun[];
}

/** Follower history for audience growth (one row per account and day). */
export async function listSnapshots(projectId: string, from: string, to: string) {
  const db = await createClient();
  const { data, error } = await db.from("social_account_snapshots").select("connection_id, snapshot_date, followers").eq("project_id", projectId).gte("snapshot_date", from).lte("snapshot_date", to).order("snapshot_date");
  if (error) return [];
  return data as { connection_id: string; snapshot_date: string; followers: number | null }[];
}

// ---------------------------------------------------------------------------
// Tokens: encrypted before they reach the database; read back only on the server.
// `admin` = service-role client of the scheduled job (direct table access, RLS bypassed by design).
// ---------------------------------------------------------------------------
export async function storeSocialTokens(db: SupabaseClient, connectionId: string, t: Pick<TokenSet, "access" | "refresh" | "refreshExpiresAt">, admin = false) {
  const key = socialTokenKey();
  const access = encryptToken(t.access, key);
  const refresh = t.refresh ? encryptToken(t.refresh, key) : null;
  if (admin) {
    const { error } = await db.from("social_tokens").upsert({ connection_id: connectionId, access_token_enc: access, ...(refresh ? { refresh_token_enc: refresh } : {}), ...(t.refreshExpiresAt ? { refresh_expires_at: t.refreshExpiresAt } : {}), updated_at: new Date().toISOString() });
    if (error) throw error;
    return;
  }
  const { error } = await db.rpc("social_store_tokens", { p_connection: connectionId, p_access: access, p_refresh: refresh, p_refresh_expires: t.refreshExpiresAt });
  if (error) throw error;
}

export async function readSocialTokens(db: SupabaseClient, connectionId: string, admin = false) {
  const res = admin
    ? await db.from("social_tokens").select("access_token_enc, refresh_token_enc, refresh_expires_at").eq("connection_id", connectionId).maybeSingle()
    : await db.rpc("social_read_tokens", { p_connection: connectionId }).maybeSingle();
  if (res.error) throw res.error;
  const row = res.data as { access_token_enc: string | null; refresh_token_enc: string | null } | null;
  const key = socialTokenKey();
  return { access: row?.access_token_enc ? decryptToken(row.access_token_enc, key) : null, refresh: row?.refresh_token_enc ? decryptToken(row.refresh_token_enc, key) : null };
}

export async function clearSocialTokens(db: SupabaseClient, connectionId: string, admin = false) {
  const { error } = admin ? await db.from("social_tokens").delete().eq("connection_id", connectionId) : await db.rpc("social_clear_tokens", { p_connection: connectionId });
  if (error) throw error;
}

/**
 * Access for a sync. Refreshes an expired (or nearly expired) OAuth token when the provider gave a refresh token;
 * otherwise the connection needs the owner to reconnect.
 */
export async function getAccess(db: SupabaseClient, conn: SocialConnection, admin = false): Promise<Access> {
  if (conn.auth_type === "api_key") return { token: null, scopes: [] };
  const tokens = await readSocialTokens(db, conn.id, admin);
  const expiring = conn.token_expires_at && Date.parse(conn.token_expires_at) < Date.now() + 5 * 60_000;
  if (tokens.access && !expiring) return { token: tokens.access, scopes: conn.granted_scopes };
  if (!tokens.refresh) throw new SocialApiError(tokens.access ? "Access expired. Reconnect the account." : "No access token stored. Reconnect the account.", 401, PROVIDERS[conn.provider].label, "auth");
  const fresh = await PROVIDERS[conn.provider].refresh(tokens.refresh);
  await storeSocialTokens(db, conn.id, fresh, admin);
  await db.from("social_connections").update({ token_expires_at: fresh.expiresAt, ...(fresh.scopes.length ? { granted_scopes: fresh.scopes } : {}) }).eq("id", conn.id);
  return { token: fresh.access, scopes: fresh.scopes.length ? fresh.scopes : conn.granted_scopes };
}
