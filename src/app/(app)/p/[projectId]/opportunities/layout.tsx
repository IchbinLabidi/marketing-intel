import { ModuleGate } from "@/components/app/module-gate";
import { getT } from "@/i18n/server";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getT("opportunities");
  return (
    <ModuleGate projectId={projectId} permission="opportunities.view" what={t("gateWhat")}>
      {children}
    </ModuleGate>
  );
}
