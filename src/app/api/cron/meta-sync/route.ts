import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaConnection } from "@/types/domain";
import { isMetaConfigured, metaConfig } from "@/server/meta/config";
import { decryptToken } from "@/server/meta/crypto";
import { runMetaSync, SyncBusyError } from "@/server/meta/sync";

export const maxDuration = 300;

const authorized = (request: NextRequest) => {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
};

/**
 * Scheduled incremental sync (Vercel Cron, see vercel.json, or any scheduler sending `Authorization: Bearer CRON_SECRET`).
 * Runs with the service-role key because no user is signed in; it only touches Meta connections and their posts.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin || !isMetaConfigured()) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY and Meta settings are required" }, { status: 501 });

  const dueBefore = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data, error } = await admin
    .from("meta_connections")
    .select("*")
    .eq("status", "active")
    .eq("auto_sync", true)
    .or(`last_sync_at.is.null,last_sync_at.lt.${dueBefore}`)
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const started = Date.now();
  const results: { project: string; status: string }[] = [];
  for (const conn of (data ?? []) as MetaConnection[]) {
    if (Date.now() - started > 240_000) break; // leave room before maxDuration; the rest runs next time
    const { data: tok } = await admin.from("meta_tokens").select("page_token_enc").eq("connection_id", conn.id).maybeSingle();
    if (!tok?.page_token_enc) continue;
    try {
      const r = await runMetaSync(admin, conn, decryptToken(tok.page_token_enc, metaConfig().tokenKey), { kind: conn.last_sync_at ? "incremental" : "initial", trigger: "scheduled" });
      results.push({ project: conn.project_id, status: r.status });
    } catch (e) {
      results.push({ project: conn.project_id, status: e instanceof SyncBusyError ? "busy" : "failed" });
    }
  }
  return NextResponse.json({ synced: results.length, results });
}
