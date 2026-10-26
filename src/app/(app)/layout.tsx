import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app/sidebar";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/supabase/proxy";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace, listWorkspaces } from "@/server/services/workspaces";
import { listProjects } from "@/server/services/projects";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [workspaces, activeWorkspace] = await Promise.all([listWorkspaces(), getActiveWorkspace()]);
  if (!activeWorkspace) redirect("/setup?reason=no-workspace");
  const projects = await listProjects(activeWorkspace.id);
  const cookieProject = (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value ?? null;
  const activeProjectId = projects.some((p) => p.id === cookieProject) ? cookieProject : null;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar
        user={user}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        activeProjectId={activeProjectId}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
