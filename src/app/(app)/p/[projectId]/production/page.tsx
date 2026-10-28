import { ProductionApp } from "@/components/production/production-app";
import { DEFAULT_WORKFLOW } from "@/lib/production/model";
import { todayInZone } from "@/lib/calendar/time";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";
import { listMembers } from "@/server/services/workspaces";
import { requireUser } from "@/server/services/session";
import { listProduction, listTemplates } from "@/server/services/production";
import { isAIConfigured } from "@/server/ai/client";
import { assignablePeople, getPermissions } from "@/server/services/team";
export const metadata = { title: "Content Production" };
export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ item?: string; view?: string }> }) {
  const { projectId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const [user, bundle, members, items, templates, query, perms, people] = await Promise.all([requireUser(), getStrategyBundle(projectId), listMembers(project.workspace_id), listProduction(projectId), listTemplates(projectId), searchParams, getPermissions(project.workspace_id), assignablePeople(project.workspace_id)]);
  return <ProductionApp projectId={projectId} projectName={project.name} language={project.default_language} tz={project.timezone || "Africa/Tunis"}
    today={todayInZone(project.timezone || "Africa/Tunis")} userId={user.id} role={role} members={members} items={items} templates={templates}
    pillars={bundle.pillars} workflow={project.production_workflow ?? DEFAULT_WORKFLOW} aiEnabled={isAIConfigured()} initialItem={query.item} initialView={query.view} perms={[...perms]} people={people} />;
}
