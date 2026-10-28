import type { Permission } from "@/lib/permissions";
import { getProjectContext } from "@/server/services/projects";
import { hasPermission } from "@/server/services/team";
import { PermissionDenied } from "./permission-denied";

/**
 * Server-side guard for a project module and every route below it. The database enforces the same rule
 * with row-level security; this keeps direct URLs from rendering an empty or broken page.
 */
export async function ModuleGate({ projectId, permission, what, children }: { projectId: string; permission: Permission; what: string; children: React.ReactNode }) {
  const { project } = await getProjectContext(projectId);
  if (!(await hasPermission(project.workspace_id, permission))) return <PermissionDenied what={what} />;
  return <>{children}</>;
}
