import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, CheckCircle2, CircleDashed, Globe } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { FormSection } from "@/components/app/form-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrandProfileForm } from "@/components/projects/brand-profile-form";
import { ChannelsManager } from "@/components/projects/channels-manager";
import { ProjectActions } from "@/components/projects/project-actions";
import { ProjectSnapshot } from "@/components/analytics/project-snapshot";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { getBrandProfile, getProjectContext, listChannels } from "@/server/services/projects";
import { getStrategyBundle, strategyCompleteness } from "@/server/services/strategy";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("projects");
  return { title: t("overview.metaTitle") };
}

export default async function ProjectOverviewPage({ params }: PageProps<"/p/[projectId]">) {
  const { projectId } = await params;
  const [t, ts, td] = await Promise.all([getT("projects"), getT("strategy"), getT("domain")]);
  const { project, role } = await getProjectContext(projectId);
  const [brand, channels, bundle] = await Promise.all([getBrandProfile(projectId), listChannels(projectId), getStrategyBundle(projectId)]);
  const completeness = strategyCompleteness(bundle);
  const readOnly = !canEdit(role);
  const website = project.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("overview.eyebrow")}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {project.name}
            {project.archived_at ? <Badge variant="warning">{t("overview.archived")}</Badge> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {project.industry ? <span>{project.industry}</span> : null}
            <span>{td(`language.${project.default_language}`)}</span>
            {website ? (
              <a
                href={project.website!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <Globe className="size-3.5" aria-hidden />
                {website}
              </a>
            ) : null}
          </span>
        }
        actions={<ProjectActions project={project} canEdit={canEdit(role)} canAdmin={canAdmin(role)} />}
      />

      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" aria-label={t("overview.loadingSummary")} />}>
        <ProjectSnapshot projectId={projectId} workspaceId={project.workspace_id} strategyPercent={completeness.percent} />
      </Suspense>

      <section
        aria-label={t("overview.strategyStatus")}
        className="grid gap-5 rounded-xl border bg-card p-5 shadow-xs md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      >
        <div className="min-w-0 space-y-3">
          <div className="flex items-baseline justify-between gap-3 md:justify-start">
            <p className="text-[14px] font-semibold">{t("overview.strategyTitle")}</p>
            <p className="text-[13px] tabular-nums text-muted-foreground">
              {t.rich("overview.percentComplete", { percent: completeness.percent, strong: (c) => <span className="font-semibold text-foreground">{c}</span> })}
            </p>
          </div>
          <Progress value={completeness.percent} label={t("overview.completeness")} className="max-w-xl" />
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {completeness.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5">
                {c.done ? (
                  <CheckCircle2 className="size-3.5 text-success" aria-label={t("overview.done")} />
                ) : (
                  <CircleDashed className="size-3.5 text-subtle-foreground" aria-label={t("overview.toDo")} />
                )}
                <span className={c.done ? "" : "text-muted-foreground"}>{ts(`completeness.${c.key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("overview.strategyHint")}</p>
        </div>
        <Button asChild variant={completeness.percent < 100 ? "default" : "outline"} className="md:self-center">
          <Link href={`/p/${projectId}/strategy`}>
            {completeness.percent < 100 ? t("overview.completeStrategy") : t("overview.openStrategy")} <ArrowRight />
          </Link>
        </Button>
      </section>

      <div className="divide-y">
        <FormSection
          id="brand"
          title={t("overview.brandTitle")}
          description={t("overview.brandDescription")}
        >
          <BrandProfileForm projectId={projectId} brand={brand} readOnly={readOnly} />
        </FormSection>

        <FormSection
          id="channels"
          title={t("overview.channelsTitle")}
          description={t("overview.channelsDescription")}
        >
          <ChannelsManager projectId={projectId} channels={channels} readOnly={readOnly} />
        </FormSection>
      </div>
    </div>
  );
}
