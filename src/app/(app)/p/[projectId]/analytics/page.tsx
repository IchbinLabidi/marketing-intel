import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AnalyticsFilters } from "@/components/analytics/filters";
import {
  BalanceSection, DefinitionsSection, InsightsSection, NoContentState, OverviewSection, ProductionSection, SocialSection, TeamSection, periodLabel,
} from "@/components/analytics/sections";
import { loadAnalytics } from "@/server/services/analytics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const data = await loadAnalytics(projectId, sp);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const suffix = query ? `?${query}` : "";
  const noData = data.counts.allItems === 0 && data.counts.perfRows === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={<>Planning, production and performance for {data.project.name}, calculated from the content and data in this workspace. {periodLabel(data.params.period)}.</>}
        actions={
          <>
            {data.access.canExport ? (
              <Button asChild variant="outline" size="sm"><a href={`/p/${projectId}/analytics/export${suffix}`} download><Download className="size-3.5" /> Export CSV</a></Button>
            ) : null}
            <Button asChild variant="outline" size="sm"><Link href={`/p/${projectId}/analytics/report${suffix}`} target="_blank"><Printer className="size-3.5" /> Printable report</Link></Button>
          </>
        }
      />
      <AnalyticsFilters
        preset={data.params.preset} period={data.params.period} compare={data.params.compare} filters={data.params.filters}
        options={data.options}
      />
      {noData ? <NoContentState projectId={projectId} /> : (
        <>
          {data.counts.filteredItems !== data.counts.allItems ? (
            <p className="-mt-4 text-xs text-muted-foreground">Filters match {data.counts.filteredItems} of {data.counts.allItems} content items{data.access.canSeeAllContent ? "" : " you can see"}.</p>
          ) : !data.access.canSeeAllContent ? (
            <p className="-mt-4 text-xs text-muted-foreground">Your role shows only content you created or are assigned to, so totals cover that content.</p>
          ) : null}
          <OverviewSection data={data} />
          <InsightsSection data={data} />
          <BalanceSection data={data} />
          <ProductionSection data={data} />
          <TeamSection data={data} />
          <SocialSection data={data} />
          <DefinitionsSection />
        </>
      )}
    </div>
  );
}
