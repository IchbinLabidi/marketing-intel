import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandProfileForm } from "@/components/projects/brand-profile-form";
import { ChannelsManager } from "@/components/projects/channels-manager";
import { ProjectActions } from "@/components/projects/project-actions";
import { canAdmin, canEdit, LANGUAGE_LABELS } from "@/lib/domain/constants";
import { getBrandProfile, getProjectContext, listChannels } from "@/server/services/projects";
import { getStrategyBundle, strategyCompleteness } from "@/server/services/strategy";

export default async function ProjectOverviewPage({ params }: PageProps<"/p/[projectId]">) {
  const { projectId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const [brand, channels, bundle] = await Promise.all([getBrandProfile(projectId), listChannels(projectId), getStrategyBundle(projectId)]);
  const completeness = strategyCompleteness(bundle);
  const readOnly = !canEdit(role);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {project.name}
            {project.archived_at ? <Badge variant="warning">Archived</Badge> : null}
          </span>
        }
        description={[project.industry, LANGUAGE_LABELS[project.default_language], project.website?.replace(/^https?:\/\//, "")]
          .filter(Boolean)
          .join(" · ")}
        actions={<ProjectActions project={project} canEdit={canEdit(role)} canAdmin={canAdmin(role)} />}
      />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-[13px] font-medium">Marketing strategy · {completeness.percent}% complete</p>
            <p className="text-xs text-muted-foreground">
              The strategy feeds every AI feature. Missing: {completeness.checks.filter((c) => !c.done).map((c) => c.key).join(", ") || "nothing"}.
            </p>
          </div>
          <Button asChild size="sm" variant={completeness.percent < 100 ? "default" : "outline"}>
            <Link href={`/p/${projectId}/strategy`}>
              Open strategy <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card id="brand">
        <CardHeader>
          <CardTitle>Brand identity</CardTitle>
          <CardDescription>Who the brand is. Used as context for every AI recommendation and piece of content.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandProfileForm projectId={projectId} brand={brand} readOnly={readOnly} />
        </CardContent>
      </Card>

      <Card id="channels">
        <CardHeader>
          <CardTitle>Social media channels</CardTitle>
          <CardDescription>Platforms this brand publishes on, with the target publishing rhythm.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChannelsManager projectId={projectId} channels={channels} readOnly={readOnly} />
        </CardContent>
      </Card>
    </div>
  );
}
