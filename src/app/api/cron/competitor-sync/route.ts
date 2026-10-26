import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDue } from "@/server/competitors/start";
import { envCredentials } from "@/server/competitors/providers";
import { CompetitorSyncBusyError, runCompetitorSync } from "@/server/competitors/sync";
import { isMetaConfigured, metaConfig } from "@/server/meta/config";
import { decryptToken } from "@/server/meta/crypto";
import type { Competitor } from "@/server/services/competitors";

export const maxDuration = 300;

const authorized = (request: NextRequest) => {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
};

/**
 * Scheduled competitor monitoring (Vercel Cron, see vercel.json, or any scheduler sending `Authorization: Bearer
 * CRON_SECRET`). Collects the competitors whose daily/weekly monitoring is due, oldest first, within the time budget.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required" }, { status: 501 });

  const { data, error } = await admin.from("competitors").select("*").neq("monitoring", "manual").order("last_synced_at", { ascending: true, nullsFirst: true }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const due = ((data ?? []) as Competitor[]).filter(isDue);

  const metaByProject = new Map<string, { igUserId: string | null; pageToken: string } | null>();
  const env = envCredentials();
  const started = Date.now();
  const results: { competitor: string; status: string }[] = [];
  for (const c of due) {
    if (Date.now() - started > 240_000) break; // the rest runs next time
    if (!metaByProject.has(c.project_id)) {
      let meta: { igUserId: string | null; pageToken: string } | null = null;
      if (isMetaConfigured()) {
        const { data: conn } = await admin.from("meta_connections").select("id, status, ig_user_id").eq("project_id", c.project_id).maybeSingle();
        if (conn?.status === "active") {
          const { data: tok } = await admin.from("meta_tokens").select("page_token_enc").eq("connection_id", conn.id).maybeSingle();
          if (tok?.page_token_enc) meta = { igUserId: conn.ig_user_id, pageToken: decryptToken(tok.page_token_enc, metaConfig().tokenKey) };
        }
      }
      metaByProject.set(c.project_id, meta);
    }
    try {
      const r = await runCompetitorSync(admin, c, { meta: metaByProject.get(c.project_id) ?? null, ...env }, { trigger: "scheduled", userId: null });
      results.push({ competitor: c.id, status: r.status });
    } catch (e) {
      results.push({ competitor: c.id, status: e instanceof CompetitorSyncBusyError ? "busy" : "failed" });
    }
  }
  return NextResponse.json({ due: due.length, collected: results.length, results });
}
