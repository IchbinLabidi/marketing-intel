import { BackLink } from "@/components/app/page-header";
import { PrintButton } from "@/components/analytics/print-button";
import {
  BalanceSection, DEFINITIONS, InsightsSection, NoContentState, OverviewSection, ProductionSection, SocialSection, TeamSection, periodLabel,
} from "@/components/analytics/sections";
import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { STAGE_LABELS, type ProductionStage } from "@/lib/production/model";
import { loadAnalytics } from "@/server/services/analytics";

export const metadata = { title: "Analytics report" };

/** Print-friendly version of the dashboard: same data and filters, with the generation time and metric definitions. */
export default async function ReportPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics/report">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const data = await loadAnalytics(projectId, sp);
  const f = data.params.filters;
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const applied = [
    f.pillar && `Pillar: ${f.pillar === "none" ? "No pillar" : data.pillarNames[f.pillar] ?? "?"}`,
    f.funnel && `Funnel: ${FUNNEL_LABELS[f.funnel as FunnelStage] ?? f.funnel}`,
    f.platform && `Platform: ${PLATFORM_LABELS[f.platform as Platform] ?? f.platform}`,
    f.format && `Type: ${f.format}`,
    f.campaign && `Campaign: ${data.campaignNames[f.campaign] ?? "?"}`,
    f.status && `Stage: ${STAGE_LABELS[f.status as ProductionStage] ?? f.status}`,
    f.assignee && `Collaborator: ${f.assignee === "none" ? "Unassigned" : data.peopleNames[f.assignee] ?? "?"}`,
  ].filter(Boolean);
  const generated = new Date(data.nowIso).toLocaleString("en-GB", { timeZone: data.tz, dateStyle: "long", timeStyle: "short" });

  return (
    <article className="mx-auto max-w-5xl space-y-8 print:max-w-none print:space-y-6 print:text-[12px]">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackLink href={`/p/${projectId}/analytics${query ? `?${query}` : ""}`}>Analytics</BackLink>
        <PrintButton />
      </div>
      <header className="space-y-1.5 border-b pb-4">
        <p className="eyebrow">Analytics report</p>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{data.project.name}</h1>
        <p className="text-[13px] text-muted-foreground">
          Period {periodLabel(data.params.period)}{data.params.compare ? `, compared with ${periodLabel(data.prevPeriod)}` : ""}. Time zone {data.tz}.
        </p>
        <p className="text-[13px] text-muted-foreground">Filters: {applied.length ? applied.join(" · ") : "none"}.{data.access.canSeeAllContent ? "" : " Limited to content the viewer can access."}</p>
        <p className="text-[13px] text-muted-foreground">Generated {generated}.</p>
      </header>
      {data.counts.allItems === 0 && data.counts.perfRows === 0 ? <NoContentState projectId={projectId} /> : (
        <>
          <OverviewSection data={data} />
          <InsightsSection data={data} />
          <BalanceSection data={data} />
          <ProductionSection data={data} />
          <TeamSection data={data} />
          <SocialSection data={data} />
        </>
      )}
      <section className="space-y-3 break-before-page">
        <h2 className="text-[15px] font-semibold">Metric definitions</h2>
        <dl className="grid gap-x-6 gap-y-2.5 text-[13px] md:grid-cols-2 print:grid-cols-2">
          {DEFINITIONS.map(([t, d]) => <div key={t} className="break-inside-avoid"><dt className="font-medium">{t}</dt><dd className="text-muted-foreground">{d}</dd></div>)}
        </dl>
      </section>
    </article>
  );
}
