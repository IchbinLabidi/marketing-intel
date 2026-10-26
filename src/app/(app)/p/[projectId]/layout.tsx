import { getProjectContext } from "@/server/services/projects";

export default async function ProjectLayout({ children, params }: LayoutProps<"/p/[projectId]">) {
  const { projectId } = await params;
  await getProjectContext(projectId); // 404s if the project doesn't exist or isn't accessible
  return children;
}
