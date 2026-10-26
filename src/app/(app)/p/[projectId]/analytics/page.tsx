import { BarChart3 } from "lucide-react";
import { ModuleRoadmap } from "@/components/app/module-roadmap";

export const metadata = { title: "Analytics" };

export default async function Page({ params }: PageProps<"/p/[projectId]/analytics">) {
  const { projectId } = await params;
  return (
    <ModuleRoadmap
      title="Analytics"
      description="Strategic analytics: is your plan balanced and is your team shipping?"
      icon={BarChart3}
      phase="Phase 8"
      prerequisite={{ label: "Strengthen the strategy first", href: `/p/${projectId}/strategy` }}
      capabilities={[
        "Pillar, funnel and platform balance vs. targets",
        "Planned vs. historical content mix",
        "Production throughput and overdue items",
        "Performance metrics only when a real data source is connected",
      ]}
    />
  );
}
