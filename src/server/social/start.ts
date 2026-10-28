import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSocialConnection, type SocialConnection } from "@/server/services/social";
import { describeSocialError, runSocialSync, SocialSyncBusyError } from "./sync";

const AUTO_SYNC_AFTER_MS = 24 * 3600 * 1000;

/**
 * Starts a sync after the response is sent, with the signed-in user's session (RLS applies). Callers check that
 * the user may edit intelligence on the project. Not a Server Action.
 */
export async function startSocialSync(projectId: string, connectionId: string, trigger: "manual" | "auto" | "connect") {
  const conn = await getSocialConnection(projectId, connectionId);
  if (!conn || conn.status === "disconnected") return { ok: false as const, error: "This account is not connected." };
  if (conn.last_sync_status === "running" && conn.last_sync_at && Date.now() - Date.parse(conn.last_sync_at) < 3 * 60_000) return { ok: false as const, error: new SocialSyncBusyError().message };
  const db = await createClient();
  after(async () => {
    try {
      await runSocialSync(db, conn, { trigger });
    } catch (e) {
      if (!(e instanceof SocialSyncBusyError)) await db.from("social_connections").update({ last_sync_status: "failed", last_error: describeSocialError(e).slice(0, 1000) }).eq("id", conn.id);
    }
  });
  return { ok: true as const };
}

/** Fallback when no scheduler runs: opening the integrations page refreshes accounts not synced for a day. */
export async function autoSyncStale(projectId: string, connections: SocialConnection[], canEdit: boolean) {
  if (!canEdit) return 0;
  let n = 0;
  for (const c of connections) {
    if (c.status !== "connected" || !c.auto_sync || c.last_sync_status === "running") continue;
    if (c.last_sync_at && Date.now() - Date.parse(c.last_sync_at) < AUTO_SYNC_AFTER_MS) continue;
    if ((await startSocialSync(projectId, c.id, "auto").catch(() => null))?.ok) n++;
  }
  return n;
}
