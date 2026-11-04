import Link from "next/link";
import { ArrowRight, FileSpreadsheet, History } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarGenerator } from "@/components/history/calendar-generator";
import { ComparePanel } from "@/components/history/compare-panel";
import { ImportStatusBadge } from "@/components/history/import-wizard";
import { ImportUploader } from "@/components/history/import-uploader";
import { HistoryOverview } from "@/components/history/overview";
import { Recommendations } from "@/components/history/recommendations";
import { RecordsTable, type RecordFilters } from "@/components/history/records-table";
import { canEdit } from "@/lib/domain/constants";
import { availablePeriods, comparePeriods, itemsInPeriod, parsePeriod } from "@/lib/history/compare";
import { effectiveDate } from "@/lib/history/analysis";
import { formatLabel, normalizeFormat, platformLabel, statusGroup } from "@/lib/history/parse";
import { normalizeText } from "@/lib/history/text";
import { isAIConfigured } from "@/server/ai/client";
import { isBackgroundSyncConfigured, isMetaConfigured, metaMissingConfig } from "@/server/meta/config";
import { maybeAutoSync } from "@/server/meta/start";
import { listMetaPagesAction } from "@/server/actions/meta";
import { getLatestReport, listHistoryOpportunities, listImportJobs } from "@/server/services/history";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { countMetaPosts, getMetaConnection, listSyncRuns } from "@/server/services/meta";
import { MetaConnectionPanel } from "@/components/history/meta-connection";
import { PerformanceView } from "@/components/history/performance-view";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("history");
  return { title: t("page.title") };
}

const TABS = [
  { key: "performance" },
  { key: "overview" },
  { key: "recommendations" },
  { key: "compare" },
  { key: "records" },
  { key: "imports" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const PAGE_SIZE = 100;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function HistoryPage({ params, searchParams }: PageProps<"/p/[projectId]/history">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const [t, td, fmt] = await Promise.all([getT("history"), getT("domain"), getFormatter()]);
  const { role, items, bundle, channels, stats, performance, pillarName } = await loadHistoryAnalysis(projectId);
  const [jobs, report, opportunities, connection, runs, metaCounts] = await Promise.all([
    listImportJobs(projectId),
    getLatestReport(projectId, "historical"),
    listHistoryOpportunities(projectId),
    getMetaConnection(projectId),
    listSyncRuns(projectId, 8),
    countMetaPosts(projectId),
  ]);
  const readOnly = !canEdit(role);
  const aiEnabled = isAIConfigured();

  const autoStarted = await maybeAutoSync(projectId, connection, runs[0], !readOnly);
  if (autoStarted) runs.unshift({ id: "pending", kind: "incremental", trigger: "auto", status: "running", stats: {}, errors: [], started_at: connection?.last_sync_at ?? "", finished_at: null });
  const pageChoice = connection?.status === "pending_page" && !readOnly ? await listMetaPagesAction(projectId) : null;

  const tab: Tab = (TABS.find((x) => x.key === one(sp.tab))?.key ?? (performance.length ? "performance" : items.length ? "overview" : "performance")) as Tab;
  const base = `/p/${projectId}/history`;
  const titleOf = (i: (typeof items)[number]) => i.title ?? i.topic ?? i.caption?.slice(0, 90) ?? i.description?.slice(0, 90) ?? t("common.untitled");
  const importLabels = jobs.map((j) => ({ id: j.id, label: j.label || j.file_name }));
  const { fb_user_id: _fbUserId, ...publicConnection } = connection ?? ({} as NonNullable<typeof connection>);
  void _fbUserId;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          !readOnly ? (
            <>
              {items.length ? (
                <CalendarGenerator
                  projectId={projectId}
                  channels={channels}
                  pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name, target_share: p.target_share }))}
                  aiEnabled={aiEnabled}
                  hasHistory={items.length > 0}
                  hasRecommendations={opportunities.length > 0}
                />
              ) : null}
            </>
          ) : null
        }
      />

      <MetaConnectionPanel
        projectId={projectId}
        configured={isMetaConfigured()}
        missing={metaMissingConfig()}
        backgroundSync={isBackgroundSyncConfigured()}
        connection={connection ? publicConnection : null}
        runs={runs}
        counts={metaCounts}
        readOnly={readOnly}
        flash={{ meta: one(sp.meta), error: one(sp.meta_error), message: one(sp.meta_message) }}
        initialPages={pageChoice?.ok ? pageChoice.data ?? [] : null}
        pagesError={pageChoice && !pageChoice.ok ? pageChoice.error : null}
      />

      <TabNav
        label={t("page.sections")}
        items={TABS.map((x) => ({
          key: x.key,
          label: t(`page.tabs.${x.key}`),
          href: `${base}?tab=${x.key}`,
          active: tab === x.key,
          count: x.key === "imports" ? jobs.length : x.key === "records" ? items.length : x.key === "recommendations" ? opportunities.length : undefined,
        }))}
      />

      {tab !== "imports" && !items.length ? (
        <EmptyState
          icon={History}
          title={t("page.emptyTitle")}
          description={
            <>
              {t.rich("page.emptyDescription", { link: (c) => <Link className="text-primary hover:underline" href={`${base}?tab=imports`}>{c}</Link> })}
            </>
          }
        />
      ) : null}

      {tab === "performance" && items.length ? (
        <PerformanceView
          projectId={projectId}
          performance={performance}
          unassignedPillars={items.filter((i) => !i.pillar_id && i.pillar_assigned_by !== "ai" && (i.caption || i.title)).length}
          aiPillars={items.filter((i) => i.pillar_assigned_by === "ai").length}
          hasPillars={bundle.pillars.length > 0}
          readOnly={readOnly}
          aiEnabled={aiEnabled}
        />
      ) : null}

      {tab === "overview" && items.length ? (
        <HistoryOverview
          stats={stats}
          projectId={projectId}
          items={Object.fromEntries(
            stats.repetitions.flatMap((c) => c.ids).map((id) => {
              const i = items.find((x) => x.id === id)!;
              return [id, { id, title: titleOf(i), date: effectiveDate(i) }];
            }),
          )}
        />
      ) : null}

      {tab === "recommendations" && items.length ? (
        <Recommendations
          projectId={projectId}
          opportunities={opportunities}
          itemTitles={Object.fromEntries(items.map((i) => [i.id, { title: titleOf(i), date: effectiveDate(i) }]))}
          pillarNames={Object.fromEntries(bundle.pillars.map((p) => [p.id, p.name]))}
          personaNames={Object.fromEntries(bundle.personas.map((p) => [p.id, p.name]))}
          topicGaps={((report?.result?.topic_gaps as { topic: string; why: string; pillar: string | null }[]) ?? [])}
          reportDate={report?.created_at ?? null}
          metricsImported={stats.metrics.coverage.length > 0}
          hasHistory={items.length > 0}
          aiEnabled={aiEnabled}
          readOnly={readOnly}
        />
      ) : null}

      {tab === "compare" && items.length ? (() => {
        const periods = availablePeriods(items, jobs.filter((j) => j.status === "imported" || j.imported_count > 0), t);
        const a = parsePeriod(one(sp.a));
        const b = parsePeriod(one(sp.b));
        const label = (key?: string) => periods.find((p) => p.key === key)?.label;
        return (
          <ComparePanel
            projectId={projectId}
            periods={periods}
            a={one(sp.a)}
            b={one(sp.b)}
            labelA={label(one(sp.a))}
            labelB={label(one(sp.b))}
            result={a && b ? comparePeriods(itemsInPeriod(items, a), itemsInPeriod(items, b), pillarName, t, td) : null}
          />
        );
      })() : null}

      {tab === "records" && items.length ? (() => {
        const f: RecordFilters = {
          from: one(sp.from), to: one(sp.to), platform: one(sp.platform), format: one(sp.format), pillar: one(sp.pillar),
          campaign: one(sp.campaign), status: one(sp.status), import: one(sp.import), q: one(sp.q),
        };
        const q = normalizeText(f.q);
        const filtered = items.filter((i) => {
          const d = effectiveDate(i);
          if (f.from && (!d || d < f.from)) return false;
          if (f.to && (!d || d > f.to)) return false;
          if (f.platform && i.platform !== f.platform) return false;
          if (f.format && normalizeFormat(i.format) !== f.format) return false;
          if (f.pillar && (f.pillar === "none" ? Boolean(i.pillar_id) : i.pillar_id !== f.pillar)) return false;
          if (f.campaign && normalizeText(i.campaign) !== f.campaign) return false;
          if (f.status && statusGroup(i.publication_status) !== f.status) return false;
          if (f.import && i.import_job_id !== f.import) return false;
          if (q && !normalizeText([i.title, i.topic, i.caption, i.description].join(" ")).includes(q)) return false;
          return true;
        });
        const page = Math.max(1, Number(one(sp.page)) || 1);
        const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        const uniq = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
        return (
          <RecordsTable
            projectId={projectId}
            items={filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
            total={filtered.length}
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            filters={f}
            readOnly={readOnly}
            pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name }))}
            campaigns={bundle.campaigns.map((c) => ({ id: c.id, name: c.name }))}
            imports={importLabels}
            options={{
              platforms: uniq(items.map((i) => i.platform)).map((p) => ({ value: p, label: platformLabel(td, p) })),
              formats: uniq(items.map((i) => normalizeFormat(i.format))).map((v) => ({ value: v, label: formatLabel(t, v) })),
              campaigns: [...new Map(items.filter((i) => i.campaign).map((i) => [normalizeText(i.campaign), i.campaign!])).entries()].map(([value, label]) => ({ value, label })),
              statuses: [
                { value: "published", label: t("records.statuses.published") }, { value: "planned", label: t("records.statuses.planned") }, { value: "idea", label: t("records.statuses.idea") },
                { value: "cancelled", label: t("records.statuses.cancelled") }, { value: "unknown", label: t("records.statuses.unknown") },
              ],
            }}
          />
        );
      })() : null}

      {tab === "imports" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {t("page.importsFallback")}
          </p>
          {!readOnly ? <ImportUploader projectId={projectId} aiEnabled={aiEnabled} variant="outline" /> : null}
        </div>
      ) : null}

      {tab === "imports" ? (
        jobs.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium"><FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" /> {j.label || j.file_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{j.file_name}{j.sheet_name ? ` · ${j.sheet_name}` : ""}</p>
                  </div>
                  <ImportStatusBadge status={j.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("page.job.period")}</dt><dd className="tabular-nums">{j.period_start ? `${j.period_start} → ${j.period_end}` : "—"}</dd>
                  <dt className="text-muted-foreground">{t("page.job.records")}</dt><dd className="tabular-nums">{j.imported_count}</dd>
                  <dt className="text-muted-foreground">{t("page.job.importedOn")}</dt><dd>{j.imported_at ? fmt.dateTime(j.imported_at) : t("page.job.notYet")}</dd>
                  {j.reference_year ? (<><dt className="text-muted-foreground">{t("page.job.referenceYear")}</dt><dd>{j.reference_year}</dd></>) : null}
                </dl>
                {j.error ? <p className="mt-2 text-xs text-destructive">{j.error}</p> : null}
                <div className="mt-3 flex justify-end gap-2">
                  {j.imported_count ? <Button asChild variant="ghost" size="sm"><Link href={`${base}?tab=records&import=${j.id}`}>{t("page.job.records")}</Link></Button> : null}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`${base}/imports/${j.id}`}>{j.status === "imported" ? t("page.job.manage") : j.status === "failed" ? t("page.job.seeError") : t("page.job.continue")} <ArrowRight /></Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FileSpreadsheet}
            title={t("page.noImportsTitle")}
            description={
              <>
                {t("page.noImportsDescription")} <Badge variant="secondary">{t("page.columnNamesDiffer")}</Badge>
              </>
            }
          />
        )
      ) : null}
    </div>
  );
}
