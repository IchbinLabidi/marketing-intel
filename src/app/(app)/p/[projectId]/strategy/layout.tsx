import { ModuleGate } from "@/components/app/module-gate";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ModuleGate projectId={projectId} permission="strategy.view" what="the marketing strategy">
      {children}
    </ModuleGate>
  );
}
