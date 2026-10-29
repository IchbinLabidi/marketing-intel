import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { readSocialTokens, storeSocialTokens } from "@/server/services/social";
import { SocialApiError } from "@/server/social/http";
import { refreshDriveToken } from "./google";

export type DriveConnection = { id: string; project_id: string; external_account_id: string; account_name: string | null; status: string; token_expires_at: string | null };

/** The project's Google Drive authorization (one per project, stored like the other connected accounts). */
export async function getDriveConnection(projectId: string): Promise<DriveConnection | null> {
  const db = await createClient();
  const { data, error } = await db.from("social_connections").select("id, project_id, external_account_id, account_name, status, token_expires_at")
    .eq("project_id", projectId).eq("provider", "google_drive").neq("status", "disconnected").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return data as DriveConnection | null;
}

/**
 * A valid access token for the Drive API, refreshed on the server when it is about to expire. The refresh token
 * never leaves the server; only short-lived access tokens are used.
 */
export async function driveAccessToken(db: SupabaseClient, conn: DriveConnection): Promise<string> {
  const tokens = await readSocialTokens(db, conn.id);
  const fresh = conn.token_expires_at && Date.parse(conn.token_expires_at) > Date.now() + 5 * 60_000;
  if (tokens.access && fresh) return tokens.access;
  if (!tokens.refresh) throw new SocialApiError("Google Drive access expired. Reconnect Google Drive.", 401, "Google Drive", "auth");
  const t = await refreshDriveToken(tokens.refresh);
  await storeSocialTokens(db, conn.id, { access: t.access, refresh: t.refresh, refreshExpiresAt: null });
  await db.from("social_connections").update({ token_expires_at: t.expiresAt, status: "connected", last_error: null }).eq("id", conn.id);
  return t.access;
}
