import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSocialSync, SocialSyncBusyError } from "@/server/social/sync";
import type { SocialConnection } from "@/server/services/social";

export const maxDuration = 300;

const authorized = (request: NextRequest) => {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
};

/**
 * Scheduled sync of YouTube, LinkedIn and TikTok accounts (Vercel Cron, see vercel.json). Runs with the service-role
 * key because nobody is signed in; it only reads connected accounts and writes their posts and snapshots.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for scheduled sync" }, { status: 501 });

  const dueBefore = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data, error } = await admin.from("social_connections").select("*").neq("provider", "google_drive").eq("status", "connected").eq("auto_sync", true)
    .or(`last_sync_at.is.null,last_sync_at.lt.${dueBefore}`).order("last_sync_at", { ascending: true, nullsFirst: true }).limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const started = Date.now();
  const results: { connection: string; provider: string; status: string }[] = [];
  for (const conn of (data ?? []) as SocialConnection[]) {
    if (Date.now() - started > 240_000) break; // the rest is picked up by the next run
    try {
      const r = await runSocialSync(admin, conn, { trigger: "scheduled", admin: true });
      results.push({ connection: conn.id, provider: conn.provider, status: r.status });
    } catch (e) {
      results.push({ connection: conn.id, provider: conn.provider, status: e instanceof SocialSyncBusyError ? "busy" : "failed" });
    }
  }
  return NextResponse.json({ synced: results.length, results });
}
