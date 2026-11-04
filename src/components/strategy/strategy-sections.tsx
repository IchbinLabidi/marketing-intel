"use client";

import { CalendarRange, Gauge, Layers, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FUNNEL_STAGES, PLATFORMS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { saveBrandVoiceAction, saveFoundationsAction, saveFunnelAction } from "@/server/actions/strategy";
import type { Campaign, ContentPillar, Kpi, Persona, Strategy } from "@/types/domain";
import { EntityList, type EntityField } from "./entity-list";
import { TextSectionForm } from "./text-section-form";
import { useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";

type T = TFor<"strategy">;
type TD = TFor<"domain">;

type Common = { projectId: string; readOnly: boolean; aiEnabled: boolean };

const funnelOptions = (td: TD) => FUNNEL_STAGES.map((s) => ({ value: s, label: td(`funnel.${s}`) }));

export function FoundationsSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
  const t = useT("strategy");
  return (
    <TextSectionForm
      {...c}
      section="foundations"
      action={saveFoundationsAction.bind(null, c.projectId)}
      initial={{
        business_objectives: strategy?.business_objectives,
        marketing_objectives: strategy?.marketing_objectives,
        brand_positioning: strategy?.brand_positioning,
        value_proposition: strategy?.value_proposition,
      }}
      columns={2}
      fields={[
        { name: "business_objectives", label: t("foundations.businessObjectives"), hint: t("foundations.businessObjectivesHint"), rows: 5 },
        { name: "marketing_objectives", label: t("foundations.marketingObjectives"), hint: t("foundations.marketingObjectivesHint"), rows: 5 },
        { name: "brand_positioning", label: t("foundations.brandPositioning"), hint: t("foundations.brandPositioningHint"), rows: 5 },
        { name: "value_proposition", label: t("foundations.valueProposition"), hint: t("foundations.valuePropositionHint"), rows: 5 },
      ]}
    />
  );
}

export function BrandVoiceSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
  const t = useT("strategy");
  const v = strategy?.brand_voice ?? {};
  return (
    <TextSectionForm
      {...c}
      section="brand_voice"
      action={saveBrandVoiceAction.bind(null, c.projectId)}
      initial={{ tone: v.tone, do: v.do, dont: v.dont, vocabulary: v.vocabulary, examples: v.examples }}
      columns={2}
      fields={[
        { name: "tone", label: t("brandVoice.tone"), hint: t("brandVoice.toneHint"), rows: 3 },
        { name: "vocabulary", label: t("brandVoice.vocabulary"), hint: t("brandVoice.vocabularyHint"), rows: 3 },
        { name: "do", label: t("brandVoice.do"), rows: 4 },
        { name: "dont", label: t("brandVoice.dont"), rows: 4 },
        { name: "examples", label: t("brandVoice.examples"), hint: t("brandVoice.examplesHint"), rows: 4 },
      ]}
    />
  );
}

export function FunnelSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
  const t = useT("strategy");
  const td = useT("domain");
  return (
    <TextSectionForm
      {...c}
      section="funnel"
      action={saveFunnelAction.bind(null, c.projectId)}
      initial={(strategy?.funnel ?? {}) as Record<string, string>}
      columns={2}
      fields={FUNNEL_STAGES.map((s) => ({
        name: s,
        label: td(`funnel.${s}`),
        rows: 3,
        placeholder: t("funnel.placeholder"),
      }))}
    />
  );
}

const personaFields = (t: T, td: TD): EntityField[] => [
  { name: "name", label: t("persona.name"), type: "text", required: true, wide: true },
  { name: "description", label: t("persona.description"), type: "textarea" },
  { name: "demographics", label: t("persona.demographics"), type: "text", wide: true },
  { name: "goals", label: t("persona.goals"), type: "textarea" },
  { name: "pain_points", label: t("persona.painPoints"), type: "textarea" },
  { name: "objections", label: t("persona.objections"), type: "textarea" },
  { name: "preferred_platforms", label: t("persona.preferredPlatforms"), type: "checkboxes", options: PLATFORMS.map((p) => ({ value: p, label: td(`platform.${p}`) })) },
];

export function PersonasSection({ personas, ...c }: Common & { personas: Persona[] }) {
  const t = useT("strategy");
  const td = useT("domain");
  return (
    <EntityList
      {...c}
      entity="personas"
      icon={Users}
      fields={personaFields(t, td)}
      items={personas}
      renderItem={(p) => (
        <div className="space-y-3">
          <div className="flex items-start gap-3 pr-14">
            <Avatar name={p.name} className="size-9 bg-primary-soft text-[12px]" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold leading-snug">{p.name}</p>
              {p.demographics ? (
                <Facts text={p.demographics} />
              ) : null}
            </div>
          </div>
          {p.description ? <p className="text-[13px] leading-relaxed">{p.description}</p> : null}
          {p.goals || p.pain_points ? (
            <dl className="grid gap-3 border-t pt-3 text-xs leading-relaxed sm:grid-cols-2">
              {p.goals ? (
                <div>
                  <dt className="eyebrow mb-1">{t("persona.goals")}</dt>
                  <dd><Lines text={p.goals} /></dd>
                </div>
              ) : null}
              {p.pain_points ? (
                <div>
                  <dt className="eyebrow mb-1">{t("persona.painPoints")}</dt>
                  <dd><Lines text={p.pain_points} /></dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {p.preferred_platforms?.length ? (
            <div className="flex flex-wrap gap-1">
              {p.preferred_platforms.map((pl) => <Badge key={pl} variant="outline">{td(`platform.${pl as Platform}`)}</Badge>)}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}

const pillarFields = (t: T): EntityField[] => [
  { name: "name", label: t("pillar.name"), type: "text", required: true },
  { name: "target_share", label: t("pillar.targetShare"), type: "number", hint: t("pillar.targetShareHint") },
  { name: "description", label: t("pillar.description"), type: "textarea" },
  { name: "color", label: t("pillar.color"), type: "select", options: (["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"] as const).map((c) => ({ value: c, label: t(`pillar.colors.${c}`) })) },
];

const PILLAR_COLORS: Record<string, string> = {
  indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", sky: "bg-sky-500", violet: "bg-violet-500", slate: "bg-slate-500",
};

const FALLBACK_ORDER = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"];

export function PillarsSection({ pillars: raw, ...c }: Common & { pillars: ContentPillar[] }) {
  const t = useT("strategy");
  // Pillars without a chosen colour get a stable one by position, so the mix bar stays readable.
  const pillars = raw.map((p, i) => ({ ...p, color: p.color ?? FALLBACK_ORDER[i % FALLBACK_ORDER.length] }));
  const total = pillars.reduce((sum, p) => sum + (Number(p.target_share) || 0), 0);
  return (
    <div className="space-y-4">
      {pillars.length ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-muted-foreground">{t("pillar.targetMix")}</span>
            <span className={total === 100 ? "font-medium text-success" : "font-medium text-warning"}>
              {total}% {total === 100 ? "" : t("pillar.sharesWarning")}
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
            {pillars.map((p) => (
              <div key={p.id} title={`${p.name} ${p.target_share ?? 0}%`} className={PILLAR_COLORS[p.color ?? ""] ?? "bg-primary"} style={{ width: `${Math.min(Number(p.target_share) || 0, 100)}%` }} />
            ))}
          </div>
        </div>
      ) : null}
      <EntityList
        {...c}
        entity="content_pillars"
        icon={Layers}
        fields={pillarFields(t)}
        items={pillars}
        renderItem={(p) => (
          <div className="space-y-1 pr-14">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${PILLAR_COLORS[p.color ?? ""] ?? "bg-primary"}`} />
              <p className="font-medium">{p.name}</p>
              {p.target_share != null ? <Badge variant="secondary">{p.target_share}%</Badge> : null}
            </div>
            {p.description ? <p className="text-[13px] text-muted-foreground">{p.description}</p> : null}
          </div>
        )}
      />
    </div>
  );
}

const campaignFields = (t: T, td: TD): EntityField[] => [
  { name: "name", label: t("campaign.name"), type: "text", required: true, wide: true },
  { name: "objective", label: t("campaign.objective"), type: "textarea" },
  { name: "starts_on", label: t("campaign.startsOn"), type: "date" },
  { name: "ends_on", label: t("campaign.endsOn"), type: "date" },
  { name: "funnel_focus", label: t("campaign.funnelFocus"), type: "select", options: funnelOptions(td) },
  { name: "description", label: t("campaign.description"), type: "textarea" },
];

export function CampaignsSection({ campaigns, ...c }: Common & { campaigns: Campaign[] }) {
  const t = useT("strategy");
  const td = useT("domain");
  return (
    <EntityList
      {...c}
      entity="campaigns"
      icon={CalendarRange}
      fields={campaignFields(t, td)}
      items={campaigns}
      renderItem={(k) => (
        <div className="space-y-1 pr-14">
          <p className="font-medium">{k.name}</p>
          <p className="text-xs text-muted-foreground">
            {k.starts_on || k.ends_on ? `${k.starts_on ?? "?"} → ${k.ends_on ?? "?"}` : t("campaign.noDates")}
            {k.funnel_focus ? ` · ${td(`funnel.${k.funnel_focus as FunnelStage}`)}` : ""}
          </p>
          {k.objective ? <p className="text-[13px]">{k.objective}</p> : null}
        </div>
      )}
    />
  );
}

const kpiFields = (t: T, td: TD): EntityField[] => [
  { name: "name", label: t("kpi.name"), type: "text", required: true, wide: true },
  { name: "target_value", label: t("kpi.target"), type: "text" },
  { name: "unit", label: t("kpi.unit"), type: "text", hint: t("kpi.unitHint") },
  { name: "period", label: t("kpi.period"), type: "text", hint: t("kpi.periodHint") },
  { name: "funnel_stage", label: t("kpi.funnelStage"), type: "select", options: funnelOptions(td) },
];

export function KpisSection({ kpis, ...c }: Common & { kpis: Kpi[] }) {
  const t = useT("strategy");
  const td = useT("domain");
  return (
    <EntityList
      {...c}
      entity="kpis"
      icon={Gauge}
      fields={kpiFields(t, td)}
      items={kpis}
      renderItem={(k) => (
        <div className="space-y-3">
          <div className="pr-14">
            <p className="text-[14px] font-semibold leading-snug">{k.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">
              {[k.period?.toLowerCase(), k.funnel_stage ? td(`funnel.${k.funnel_stage as FunnelStage}`) : null].filter(Boolean).join(" · ") || t("kpi.noPeriod")}
            </p>
          </div>
          {k.target_value ? (
            <p className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{k.target_value}</span>
              {k.unit ? <span className="text-[13px] text-muted-foreground">{k.unit}</span> : null}
              <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{t("kpi.target")}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("kpi.noTarget")}</p>
          )}
        </div>
      )}
    />
  );
}

/** "Age: 13–18 Location: Tunisia …" → label/value pairs, when the text follows that shape; otherwise plain text. */
function Facts({ text }: { text: string }) {
  const parts = text.split(/\s*(?=\b[A-Z][A-Za-z]+:\s)/).map((t) => t.trim()).filter(Boolean);
  const pairs = parts.map((t) => t.match(/^([^:]{1,24}):\s*([\s\S]+)$/));
  if (parts.length < 2 || pairs.some((m) => !m)) return <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{text}</p>;
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs leading-relaxed">
      {pairs.map((m, i) => (
        <div key={i} className="contents">
          <dt className="text-subtle-foreground">{m![1]}</dt>
          <dd className="text-muted-foreground">{m![2]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Multi-line text as a compact bullet list (single line stays a paragraph). */
function Lines({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  if (lines.length < 2) return <p>{text}</p>;
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}
