import { PageHeader } from "@/components/app/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JourneyEditor } from "@/components/strategy/journey-editor";
import {
  BrandVoiceSection,
  CampaignsSection,
  FoundationsSection,
  FunnelSection,
  KpisSection,
  PersonasSection,
  PillarsSection,
} from "@/components/strategy/strategy-sections";
import { canEdit } from "@/lib/domain/constants";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle, strategyCompleteness } from "@/server/services/strategy";
import { isAIConfigured } from "@/server/ai/client";

export const metadata = { title: "Marketing strategy" };

export default async function StrategyPage({ params }: PageProps<"/p/[projectId]/strategy">) {
  const { projectId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const bundle = await getStrategyBundle(projectId);
  const completeness = strategyCompleteness(bundle);
  const common = { projectId, readOnly: !canEdit(role), aiEnabled: isAIConfigured() };
  const s = bundle.strategy;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing strategy"
        description={`${project.name} · ${completeness.percent}% complete. The strategy is the brief every AI feature works from: opportunities, calendars and copy all reference it.`}
      />
      <Tabs defaultValue="foundations">
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="foundations">Foundations</TabsTrigger>
            <TabsTrigger value="personas">Personas <Count n={bundle.personas.length} /></TabsTrigger>
            <TabsTrigger value="journey">Journey & funnel</TabsTrigger>
            <TabsTrigger value="pillars">Content pillars <Count n={bundle.pillars.length} /></TabsTrigger>
            <TabsTrigger value="voice">Brand voice</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns <Count n={bundle.campaigns.length} /></TabsTrigger>
            <TabsTrigger value="kpis">KPIs <Count n={bundle.kpis.length} /></TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="foundations">
          <FoundationsSection {...common} strategy={s} />
        </TabsContent>
        <TabsContent value="personas">
          <PersonasSection {...common} personas={bundle.personas} />
        </TabsContent>
        <TabsContent value="journey" className="space-y-10">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Customer journey</h2>
            <JourneyEditor {...common} initial={s?.customer_journey ?? []} />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Marketing funnel</h2>
            <FunnelSection {...common} strategy={s} />
          </section>
        </TabsContent>
        <TabsContent value="pillars">
          <PillarsSection {...common} pillars={bundle.pillars} />
        </TabsContent>
        <TabsContent value="voice">
          <BrandVoiceSection {...common} strategy={s} />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsSection {...common} campaigns={bundle.campaigns} />
        </TabsContent>
        <TabsContent value="kpis">
          <KpisSection {...common} kpis={bundle.kpis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return n ? <span className="rounded bg-secondary px-1 text-[11px] tabular-nums text-muted-foreground">{n}</span> : null;
}
