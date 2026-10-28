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

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics">) {
  const { projectId } = await params;
  const sp = await searchParams;
  // CEO view by default; the switch remembers the choice in a cookie. Both views read the same data.
  const urlMode = typeof sp.mode === "string" ? sp.mode : null;
  const mode = (urlMode ?? (await cookies()).get(MODE_COOKIE)?.value) === "expert" ? "expert" : "ceo";
  const data = await loadAnalytics(projectId, sp);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const suffix = query ? `?${query}` : "";
  const noData = data.counts.allItems === 0 && data.counts.perfRows === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={mode === "ceo"
          ? <>Is the marketing plan being delivered, and what needs your decision? Everything here is calculated from {data.project.name}&apos;s real content and results.</>
          : <>All planning, production and performance metrics for {data.project.name}, with breakdowns and formulas. {periodLabel(data.params.period)}.</>}
        actions={
          <>
            <ModeSwitch mode={mode} />
            {data.access.canExport ? (
              <Button asChild variant="outline" size="sm"><a href={`/p/${projectId}/analytics/export${suffix}`} download><Download className="size-3.5" /> Export CSV</a></Button>
            ) : null}
            <Button asChild variant="outline" size="sm"><Link href={`/p/${projectId}/analytics/report${suffix}`} target="_blank"><Printer className="size-3.5" /> Printable report</Link></Button>
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
            <p className="-mt-4 text-xs text-muted-foreground">Filters match {data.counts.filteredItems} of {data.counts.allItems} content items{data.access.canSeeAllContent ? "" : " you can see"}.</p>
          ) : !data.access.canSeeAllContent ? (
            <p className="-mt-4 text-xs text-muted-foreground">Your role shows only content you created or are assigned to, so totals cover that content.</p>
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
