import Link from "next/link";
import { cookies } from "next/headers";
import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { CeoView } from "@/components/analytics/ceo-view";
import { ModeSwitch } from "@/components/analytics/mode-switch";
import { MODE_COOKIE } from "@/lib/analytics/mode";
import {
  BalanceSection, DefinitionsSection, InsightsSection, NoContentState, OverviewSection, ProductionSection, SocialSection, TeamSection, periodLabel,
} from "@/components/analytics/sections";
import { loadAnalytics } from "@/server/services/analytics";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("analytics");
  return { title: t("meta.title") };
}

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics">) {
  const { projectId } = await params;
  const sp = await searchParams;
  // CEO view by default; the switch remembers the choice in a cookie. Both views read the same data.
  const urlMode = typeof sp.mode === "string" ? sp.mode : null;
  const mode = (urlMode ?? (await cookies()).get(MODE_COOKIE)?.value) === "expert" ? "expert" : "ceo";
  const data = await loadAnalytics(projectId, sp);
  const [t, fmt] = await Promise.all([getT("analytics"), getFormatter()]);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const suffix = query ? `?${query}` : "";
  const noData = data.counts.allItems === 0 && data.counts.perfRows === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("meta.title")}
        description={mode === "ceo"
          ? t("page.descriptionCeo", { project: data.project.name })
          : t("page.descriptionExpert", { project: data.project.name, period: periodLabel(data.params.period, fmt) })}
        actions={
          <>
            <ModeSwitch mode={mode} />
            {data.access.canExport ? (
              <Button asChild variant="outline" size="sm"><a href={`/p/${projectId}/analytics/export${suffix}`} download><Download className="size-3.5" /> {t("page.exportCsv")}</a></Button>
            ) : null}
            <Button asChild variant="outline" size="sm"><Link href={`/p/${projectId}/analytics/report${suffix}`} target="_blank"><Printer className="size-3.5" /> {t("page.printableReport")}</Link></Button>
          </>
        }
      />
      <AnalyticsFilters
        preset={data.params.preset} period={data.params.period} compare={data.params.compare} filters={{ ...data.params.filters, account: data.params.account ?? "" }}
        options={data.options} simple={mode === "ceo"}
      />
      {noData ? <NoContentState projectId={projectId} /> : (
        <>
          {data.counts.filteredItems !== data.counts.allItems ? (
            <p className="-mt-4 text-xs text-muted-foreground">{t(data.access.canSeeAllContent ? "page.filtersMatch" : "page.filtersMatchVisible", { matched: data.counts.filteredItems, total: data.counts.allItems })}</p>
          ) : !data.access.canSeeAllContent ? (
            <p className="-mt-4 text-xs text-muted-foreground">{t("page.limitedRole")}</p>
          ) : null}
          {mode === "ceo" ? <CeoView data={data} /> : (
            <>
              <OverviewSection data={data} />
              <InsightsSection data={data} />
              <BalanceSection data={data} />
              <ProductionSection data={data} />
              <TeamSection data={data} />
              <SocialSection data={data} />
              <DefinitionsSection />
            </>
          )}
        </>
      )}
    </div>
  );
}
