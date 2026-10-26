import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { projectCredentials, type Competitor } from "@/server/services/competitors";
import { CompetitorSyncBusyError, runCompetitorSync } from "./sync";

const DUE_MS = { daily: 20 * 3600_000, weekly: 6.5 * 86400_000 } as const;

export const isDue = (c: Pick<Competitor, "monitoring" | "last_synced_at" | "sync_status">) =>
  c.monitoring !== "manual" && c.sync_status !== "synchronizing" && (!c.last_synced_at || Date.now() - Date.parse(c.last_synced_at) > DUE_MS[c.monitoring]);

/**
 * Starts a collection after the response is sent (the page polls the status). The Supabase client is created first so
 * the work keeps the signed-in user's session and RLS. Callers check edit rights. Not a Server Action.
 */
export async function startCompetitorSync(projectId: string, competitor: Competitor, trigger: "manual" | "scheduled" | "initial", userId: string | null, channelIds?: string[]) {
  const db = await createClient();
  const busy = await db.from("competitor_sync_runs").select("id").eq("competitor_id", competitor.id).eq("status", "running")
    .gte("heartbeat_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(1);
  if (busy.data?.length) return { ok: false as const, error: new CompetitorSyncBusyError().message };
  const creds = await projectCredentials(projectId);
  after(async () => {
    try {
      await runCompetitorSync(db, competitor, creds, { trigger, userId, channelIds });
    } catch {
      // the run row records the failure; nothing else to do after the response
    }
  });
  return { ok: true as const };
}

/**
 * Fallback when no scheduler is configured (no CRON_SECRET/service key): an editor opening the page starts the
 * collections that are due. With a scheduler, /api/cron/competitor-sync does this without anyone signed in.
 */
export async function maybeAutoCollect(projectId: string, competitors: Competitor[], canEdit: boolean, userId: string) {
  if (!canEdit) return 0;
  let started = 0;
  for (const c of competitors.filter(isDue).slice(0, 2)) {
    const r = await startCompetitorSync(projectId, c, "scheduled", userId).catch(() => null);
    if (r?.ok) started++;
  }
  return started;
}
