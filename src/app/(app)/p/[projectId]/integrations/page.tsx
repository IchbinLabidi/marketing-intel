import { nowMs } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { IntegrationsBoard, type ProviderView } from "@/components/integrations/integrations-board";
import { CATALOG, localizeProvider } from "@/lib/social/catalog";
import { getT } from "@/i18n/server";
import { appUrl, isBackgroundSyncConfigured, isMetaConfigured, metaMissingConfig } from "@/server/meta/config";
import { oauthConfig, youtubeApiKey } from "@/server/social/config";
import { autoSyncStale } from "@/server/social/start";
import { countMetaPosts, getMetaConnection, listSyncRuns } from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { listSocialConnections, listSocialRuns } from "@/server/services/social";
import { hasPermission } from "@/server/services/team";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getT("integrations");
  return { title: t("page.title") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function IntegrationsPage({ params, searchParams }: PageProps<"/p/[projectId]/integrations">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const t = await getT("integrations");
  const { project } = await getProjectContext(projectId);
  const canEdit = await hasPermission(project.workspace_id, "intelligence.edit");
  const [meta, metaRuns, metaCounts, social, socialRuns] = await Promise.all([
    getMetaConnection(projectId), listSyncRuns(projectId, 10), countMetaPosts(projectId), listSocialConnections(projectId), listSocialRuns(projectId, 30),
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
      info: (() => { const info = localizeProvider(CATALOG[p], t); return { ...info, setup: info.setup.map(withUrl) }; })(),
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
        title={t("page.title")}
        description={t("page.description")}
      />
      {!social.ready ? (
        <Alert variant="warning" title={t("page.migrationTitle")}>
          {t("page.migrationBody")}
        </Alert>
      ) : null}
      {!isBackgroundSyncConfigured() ? (
        <Alert title={t("page.backgroundTitle")}>
          {t("page.backgroundBody")}
          {" "}{t("page.backgroundEnv")}
        </Alert>
      ) : null}
      <IntegrationsBoard
        projectId={projectId}
        canEdit={canEdit}
        schemaReady={social.ready}
        flash={{ provider: one(sp.provider), connected: one(sp.connected), error: one(sp.error), detail: one(sp.detail) }}
        meta={{
          info: (() => { const info = localizeProvider(CATALOG.meta, t); return { ...info, setup: info.setup.map(withUrl) }; })(),
          configured: isMetaConfigured(), missing: metaMissingConfig(),
          connection: meta ? { status: meta.status, page_name: meta.page_name, ig_username: meta.ig_username, last_sync_at: meta.last_sync_at, last_sync_status: meta.last_sync_status, last_error: meta.last_error, granted_scopes: meta.granted_scopes, declined_scopes: meta.declined_scopes, token_expires_at: meta.token_expires_at } : null,
          // A run whose heartbeat stopped more than 3 minutes ago was interrupted; it isn't shown as running.
          running: metaRuns[0]?.status === "running" && nowMs() - Date.parse((metaRuns[0] as { heartbeat_at?: string | null }).heartbeat_at ?? metaRuns[0].started_at) < 3 * 60_000,
          lastSuccess: meta?.last_sync_at ?? metaRuns.find((r) => r.status === "succeeded" || r.status === "partial")?.finished_at ?? null,
          counts: metaCounts,
        }}
        providers={providers}
      />
    </div>
  );
}
