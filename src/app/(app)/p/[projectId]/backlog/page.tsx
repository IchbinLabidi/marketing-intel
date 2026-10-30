import { BacklogApp } from "@/components/backlog/backlog-app";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { normalizeWeights } from "@/lib/backlog/score";
import { normalizeMix } from "@/lib/backlog/audience";
import { todayInZone } from "@/lib/calendar/time";
import { isAIConfigured } from "@/server/ai/client";
import { listPresetsAction } from "@/server/actions/backlog";
import { listIdeas, listTags } from "@/server/services/backlog";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";
import { hasPermission } from "@/server/services/team";

export const metadata = { title: "Ideas Backlog" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const [initial, bundle, tags, presets, create, manage] = await Promise.all([
    listIdeas(projectId, { planning: "backlog", sort: "score" }),
    getStrategyBundle(projectId),
    listTags(projectId),
    listPresetsAction(projectId),
    hasPermission(project.workspace_id, "content.create"),
    hasPermission(project.workspace_id, "projects.manage"),
  ]);
  return (
    <BacklogApp
      projectId={projectId} projectName={project.name} tz={project.timezone || "Africa/Tunis"}
      canEdit={canEdit(role) && create} canAdmin={canAdmin(role) || manage}
      initial={initial} pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name, segment: p.audience_segment, target_share: p.target_share }))} audienceMix={normalizeMix(project.audience_mix)} tags={tags}
      presets={presets.ok ? presets.data ?? [] : []} weights={normalizeWeights(project.idea_score_weights as Record<string, unknown> | null)}
      aiEnabled={isAIConfigured()} today={todayInZone(project.timezone || "Africa/Tunis")}
    />
  );
}
