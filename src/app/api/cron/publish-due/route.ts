import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublishTarget } from "@/lib/publishing/rules";
import { followUp, loadAssets, prepareSenders, sendClaimed, syncItemStatus, type Env, type PendingPublication, type Publication } from "@/server/publishing/core";
import type { ContentItem } from "@/types/domain";
import { translatorFor } from "@/i18n/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;

/**
 * Scheduled publishing: sends the Instagram, TikTok and YouTube posts queued for a time that has come (those APIs can't
 * schedule themselves), then follows up on posts the networks are still finishing: Instagram and TikTok videos still
 * processing are published once ready, and Facebook posts scheduled on Facebook are marked published once live. Called every 5 minutes by a Supabase pg_cron job. It takes no input and only ever sends posts
 * the team already scheduled, at or after their time, each row claimed once; so calling it early or twice is harmless.
 * Runs with the service-role key because nobody is signed in.
 */
export async function GET() {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required for scheduled publishing" }, { status: 501 });
  // nobody is signed in: messages stored on failed publications stay in English (no request language)
  const t = translatorFor("en", "publishing");
  const env: Env = { db: admin, admin: true, t };
  const now = new Date().toISOString();
  // due posts, plus temporary failures of scheduled posts whose retry time has come
  const { data: due, error } = await admin.from("content_publications").select("*")
    .not("scheduled_for", "is", null).lte("scheduled_for", now)
    .or(`status.eq.queued,and(status.eq.failed,error_kind.eq.transient,next_attempt_at.lte.${now},attempts.lt.${MAX_ATTEMPTS})`)
    .neq("provider", "facebook").order("scheduled_for").limit(8);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const started = Date.now();
  const results: { id: string; provider: string; status: string }[] = [];
  for (const row of (due ?? []) as (Publication & { project_id: string; media_asset_ids: string[] | null; allow_temp_link: boolean })[]) {
    if (Date.now() - started > 200_000) break; // the rest goes in the next run
    // claim: only one run sends a given row
    const { data: claimed } = await admin.from("content_publications").update({ status: "uploading", error: null, error_kind: null })
      .eq("id", row.id).eq("status", row.status).select("id, attempts").maybeSingle();
    if (!claimed) continue;
    const fail = async (message: string) => {
      const { data } = await admin.from("content_publications").update({ status: "failed", error: message, error_kind: "validation", attempts: claimed.attempts + 1 }).eq("id", row.id).select("*").single();
      return data as Publication;
    };
    let pub: Publication;
    const { data: item } = await admin.from("content_items").select("*").eq("id", row.content_item_id).eq("project_id", row.project_id).maybeSingle();
    const target = row.provider as PublishTarget;
    if (!item || !["approved", "scheduled"].includes((item as ContentItem).status)) {
      pub = await fail(t("core.notApprovedAnymore"));
    } else {
      const prep = await prepareSenders(env, row.project_id, [target]);
      const loaded = await loadAssets(env, row.project_id, row.content_item_id, row.media_asset_ids ?? []);
      if (!prep.ok) pub = await fail(prep.error);
      else if (!loaded.ok) pub = await fail(loaded.error);
      else pub = await sendClaimed(env, prep.senders, { projectId: row.project_id, item: item as ContentItem, target, assets: loaded.assets, claimed, scheduleAt: null, allowTemporaryLink: row.allow_temp_link });
    }
    results.push({ id: row.id, provider: row.provider, status: pub.status });
    const { data: all } = await admin.from("content_publications").select("*").eq("content_item_id", row.content_item_id);
    await syncItemStatus(admin, row.project_id, row.content_item_id, (all ?? []) as Publication[]);
  }

  // follow-ups: nothing else would ever look at these rows again (Facebook asked about up to 3 days after its time)
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: pending } = await admin.from("content_publications").select("*")
    .or(`and(status.eq.processing,container_id.not.is.null,provider.in.(instagram,tiktok)),and(status.eq.scheduled,provider.eq.facebook,platform_post_id.not.is.null,scheduled_for.lte.${now},scheduled_for.gte.${since})`)
    .order("updated_at").limit(10);
  const followed: { id: string; provider: string; status: string }[] = [];
  for (const row of (pending ?? []) as PendingPublication[]) {
    if (Date.now() - started > 240_000) break;
    const r = await followUp(env, row, 15_000);
    followed.push({ id: row.id, provider: row.provider, status: r.publication.status });
    if (!r.changed) continue;
    const { data: all } = await admin.from("content_publications").select("*").eq("content_item_id", row.content_item_id);
    await syncItemStatus(admin, row.project_id, row.content_item_id, (all ?? []) as Publication[]);
  }
  return NextResponse.json({ sent: results.length, results, followed });
}
