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
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("strategy");
  return { title: t("meta.title") };
}

export default async function StrategyPage({ params }: PageProps<"/p/[projectId]/strategy">) {
  const { projectId } = await params;
  const t = await getT("strategy");
  const { project, role } = await getProjectContext(projectId);
  const bundle = await getStrategyBundle(projectId);
  const completeness = strategyCompleteness(bundle);
  const common = { projectId, readOnly: !canEdit(role), aiEnabled: isAIConfigured() };
  const s = bundle.strategy;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("page.eyebrow", { project: project.name, percent: completeness.percent })}
        title={t("page.title")}
        description={t("page.description")}
      />
      <Tabs defaultValue="foundations">
        <TabsList>
            <TabsTrigger value="foundations">{t("page.tabs.foundations")}</TabsTrigger>
            <TabsTrigger value="personas">{t("page.tabs.personas")} <Count n={bundle.personas.length} /></TabsTrigger>
            <TabsTrigger value="journey">{t("page.tabs.journey")}</TabsTrigger>
            <TabsTrigger value="pillars">{t("page.tabs.pillars")} <Count n={bundle.pillars.length} /></TabsTrigger>
            <TabsTrigger value="voice">{t("page.tabs.voice")}</TabsTrigger>
            <TabsTrigger value="campaigns">{t("page.tabs.campaigns")} <Count n={bundle.campaigns.length} /></TabsTrigger>
            <TabsTrigger value="kpis">{t("page.tabs.kpis")} <Count n={bundle.kpis.length} /></TabsTrigger>
          </TabsList>
        <TabsContent value="foundations">
          <FoundationsSection {...common} strategy={s} />
        </TabsContent>
        <TabsContent value="personas">
          <PersonasSection {...common} personas={bundle.personas} />
        </TabsContent>
        <TabsContent value="journey" className="space-y-10">
          <section className="space-y-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t("page.journeyTitle")}</h2>
            <JourneyEditor {...common} initial={s?.customer_journey ?? []} />
          </section>
          <section className="space-y-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t("page.funnelTitle")}</h2>
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
