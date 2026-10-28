import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { IntegrationsBoard, type ProviderView } from "@/components/integrations/integrations-board";
import { CATALOG } from "@/lib/social/catalog";
import { appUrl, isBackgroundSyncConfigured, isMetaConfigured, metaMissingConfig } from "@/server/meta/config";
import { oauthConfig, youtubeApiKey } from "@/server/social/config";
import { autoSyncStale } from "@/server/social/start";
import { countMetaPosts, getMetaConnection, listSyncRuns } from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { listSocialConnections, listSocialRuns } from "@/server/services/social";
import { hasPermission } from "@/server/services/team";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Integrations" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function IntegrationsPage({ params, searchParams }: PageProps<"/p/[projectId]/integrations">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { project } = await getProjectContext(projectId);
  const canEdit = await hasPermission(project.workspace_id, "intelligence.edit");
  const [meta, metaRuns, metaCounts, social, socialRuns] = await Promise.all([
    getMetaConnection(projectId), listSyncRuns(projectId, 1), countMetaPosts(projectId), listSocialConnections(projectId), listSocialRuns(projectId, 30),
  ]);
  if (social.ready) await autoSyncStale(projectId, social.connections, canEdit);

  // Post counts per connected account (what each sync actually imported).
  const counts: Record<string, number> = {};
  if (social.ready && social.connections.length) {
    const db = await createClient();
    await Promise.all(social.connections.map(async (c) => {
      const { count } = await db.from("historical_content_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("social_connection_id", c.id);
      counts[c.id] = count ?? 0;
    }));
  }

  const url = appUrl();
  const withUrl = (s: string) => s.replaceAll("{APP_URL}", url);
  const providers: ProviderView[] = (["youtube", "linkedin", "tiktok"] as const).map((p) => {
    const cfg = oauthConfig(p);
    return {
      key: p,
      info: { ...CATALOG[p], setup: CATALOG[p].setup.map(withUrl) },
      oauthReady: cfg.missing.length === 0,
      missing: cfg.missing,
      publicReady: p === "youtube" ? Boolean(youtubeApiKey()) : false,
      connections: social.connections.filter((c) => c.provider === p).map((c) => ({ ...c, posts: counts[c.id] ?? 0 })),
      runs: socialRuns.filter((r) => social.connections.some((c) => c.id === r.connection_id && c.provider === p)).slice(0, 5),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect the social accounts this project publishes on. Their real results feed Content history, Analytics and the calendar. Access is read-only, and you never type a social media password here."
      />
      {!social.ready ? (
        <Alert variant="warning" title="YouTube, LinkedIn and TikTok need a database update">
          Migration 0015 hasn&apos;t been applied to this database yet. Meta works as before; the other providers appear once it is applied.
        </Alert>
      ) : null}
      {!isBackgroundSyncConfigured() ? (
        <Alert title="Daily background sync is off on this server">
          Accounts are refreshed when someone who can edit opens this page or Content history and the data is over a day old, or with Sync now.
          Scheduled sync needs SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET in the server settings.
        </Alert>
      ) : null}
      <IntegrationsBoard
        projectId={projectId}
        canEdit={canEdit}
        schemaReady={social.ready}
        flash={{ provider: one(sp.provider), connected: one(sp.connected), error: one(sp.error), detail: one(sp.detail) }}
        meta={{
          info: { ...CATALOG.meta, setup: CATALOG.meta.setup.map(withUrl) },
          configured: isMetaConfigured(), missing: metaMissingConfig(),
          connection: meta ? { status: meta.status, page_name: meta.page_name, ig_username: meta.ig_username, last_sync_at: meta.last_sync_at, last_sync_status: meta.last_sync_status, last_error: meta.last_error, granted_scopes: meta.granted_scopes, declined_scopes: meta.declined_scopes, token_expires_at: meta.token_expires_at } : null,
          running: metaRuns[0]?.status === "running",
          counts: metaCounts,
        }}
        providers={providers}
      />
    </div>
  );
}
