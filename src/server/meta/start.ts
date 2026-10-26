import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MetaConnection, MetaSyncRun } from "@/types/domain";
import { getMetaConnection, readMetaTokens } from "@/server/services/meta";
import { describeMetaError, runMetaSync, SyncBusyError } from "./sync";

const AUTO_SYNC_AFTER_MS = 24 * 3600 * 1000;

/**
 * Fallback for automatic sync when no scheduler is configured: an editor opening a stale page triggers an
 * incremental sync in the background. Returns true when one was started.
 */
export async function maybeAutoSync(projectId: string, conn: MetaConnection | null, latestRun: MetaSyncRun | undefined, canEdit: boolean) {
  if (!canEdit || conn?.status !== "active" || !conn.auto_sync || latestRun?.status === "running") return false;
  if (conn.last_sync_at && Date.now() - Date.parse(conn.last_sync_at) < AUTO_SYNC_AFTER_MS) return false;
  const started = await startMetaSync(projectId, conn.last_sync_at ? "incremental" : "initial", "auto").catch(() => null);
  return Boolean(started?.ok);
}

/**
 * Starts a sync in the background (after the response is sent) and returns immediately; the page polls the run
 * status. The Supabase client is created before `after` so the work keeps the signed-in user's session and RLS.
 * Callers must have checked that the user may edit the project. Not a Server Action.
 */
export async function startMetaSync(projectId: string, kind: MetaSyncRun["kind"], trigger: MetaSyncRun["trigger"]) {
  const conn = await getMetaConnection(projectId);
  if (!conn || conn.status !== "active" || !conn.page_id) return { ok: false as const, error: "Connect a Facebook Page first." };
  const { page } = await readMetaTokens(conn.id);
  if (!page) return { ok: false as const, error: "The Page access token is missing. Reconnect Meta." };
  const db = await createClient();
  // quick pre-check for a friendly message; the database's unique index is the real lock
  const busy = await db
    .from("meta_sync_runs")
    .select("id")
    .eq("connection_id", conn.id)
    .eq("status", "running")
    .gte("heartbeat_at", new Date(Date.now() - 3 * 60000).toISOString())
    .limit(1);
  if (busy.data?.length) return { ok: false as const, error: new SyncBusyError().message };
  after(async () => {
    try {
      await runMetaSync(db, conn, page, { kind, trigger });
    } catch (e) {
      if (!(e instanceof SyncBusyError)) {
        await db.from("meta_connections").update({ last_sync_status: "failed", last_error: describeMetaError(e).slice(0, 1000) }).eq("id", conn.id);
      }
    }
  });
  return { ok: true as const };
}
