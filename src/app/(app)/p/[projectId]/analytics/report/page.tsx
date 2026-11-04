import { BackLink } from "@/components/app/page-header";
import { PrintButton } from "@/components/analytics/print-button";
import {
  BalanceSection, DEFINITION_KEYS, InsightsSection, NoContentState, OverviewSection, ProductionSection, SocialSection, TeamSection, periodLabel,
} from "@/components/analytics/sections";
import { FUNNEL_STAGES, type FunnelStage } from "@/lib/domain/constants";
import { contentTypeLabel, platformLabelOf, stageLabelOf } from "@/lib/analytics/compute";
import { loadAnalytics } from "@/server/services/analytics";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("analytics");
  return { title: t("meta.reportTitle") };
}

/** Print-friendly version of the dashboard: same data and filters, with the generation time and metric definitions. */
export default async function ReportPage({ params, searchParams }: PageProps<"/p/[projectId]/analytics/report">) {
  const { projectId } = await params;
  const sp = await searchParams;
  const data = await loadAnalytics(projectId, sp);
  const [t, td, fmt] = await Promise.all([getT("analytics"), getT("domain"), getFormatter()]);
  const f = data.params.filters;
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  const applied = [
    f.pillar && t("report.applied.pillar", { value: f.pillar === "none" ? t("labels.noPillar") : data.pillarNames[f.pillar] ?? "?" }),
    f.funnel && t("report.applied.funnel", { value: (FUNNEL_STAGES as readonly string[]).includes(f.funnel) ? td(`funnel.${f.funnel as FunnelStage}`) : f.funnel }),
    f.platform && t("report.applied.platform", { value: platformLabelOf(td, f.platform) }),
    f.format && t("report.applied.type", { value: contentTypeLabel(t, f.format) }),
    f.campaign && t("report.applied.campaign", { value: data.campaignNames[f.campaign] ?? "?" }),
    f.status && t("report.applied.stage", { value: stageLabelOf(t, f.status) }),
    f.assignee && t("report.applied.collaborator", { value: f.assignee === "none" ? t("labels.unassigned") : data.peopleNames[f.assignee] ?? "?" }),
  ].filter(Boolean);
  const generated = fmt.dateTime(data.nowIso, { timeZone: data.tz, dateStyle: "long", timeStyle: "short" });

  return (
    <article className="mx-auto max-w-5xl space-y-8 print:max-w-none print:space-y-6 print:text-[12px]">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackLink href={`/p/${projectId}/analytics${query ? `?${query}` : ""}`}>{t("meta.title")}</BackLink>
        <PrintButton />
      </div>
      <header className="space-y-1.5 border-b pb-4">
        <p className="eyebrow">{t("report.eyebrow")}</p>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{data.project.name}</h1>
        <p className="text-[13px] text-muted-foreground">
          {data.params.compare
            ? t("report.periodCompared", { period: periodLabel(data.params.period, fmt), previous: periodLabel(data.prevPeriod, fmt), tz: data.tz })
            : t("report.period", { period: periodLabel(data.params.period, fmt), tz: data.tz })}
        </p>
        <p className="text-[13px] text-muted-foreground">{applied.length ? t("report.filters", { list: applied.join(" · ") }) : t("report.filtersNone")}{data.access.canSeeAllContent ? "" : ` ${t("report.limited")}`}</p>
        <p className="text-[13px] text-muted-foreground">{t("report.generated", { date: generated })}</p>
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
        <h2 className="text-[15px] font-semibold">{t("report.definitionsTitle")}</h2>
        <dl className="grid gap-x-6 gap-y-2.5 text-[13px] md:grid-cols-2 print:grid-cols-2">
          {DEFINITION_KEYS.map((k) => <div key={k} className="break-inside-avoid"><dt className="font-medium">{t(`definitions.${k}.term`)}</dt><dd className="text-muted-foreground">{t(`definitions.${k}.text`)}</dd></div>)}
        </dl>
      </section>
    </article>
  );
}
