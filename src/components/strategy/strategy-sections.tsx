"use client";

import { CalendarRange, Gauge, Layers, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FUNNEL_LABELS, FUNNEL_STAGES, PLATFORMS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { saveBrandVoiceAction, saveFoundationsAction, saveFunnelAction } from "@/server/actions/strategy";
import type { Campaign, ContentPillar, Kpi, Persona, Strategy } from "@/types/domain";
import { EntityList, type EntityField } from "./entity-list";
import { TextSectionForm } from "./text-section-form";

type Common = { projectId: string; readOnly: boolean; aiEnabled: boolean };

const funnelOptions = FUNNEL_STAGES.map((s) => ({ value: s, label: FUNNEL_LABELS[s] }));

export function FoundationsSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
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
        { name: "business_objectives", label: "Business objectives", hint: "What the business must achieve (revenue, markets, launches).", rows: 5 },
        { name: "marketing_objectives", label: "Marketing objectives", hint: "What marketing must deliver to get there. Make them measurable.", rows: 5 },
        { name: "brand_positioning", label: "Brand positioning", hint: "For whom, in which category, with which key benefit, and why believe it.", rows: 5 },
        { name: "value_proposition", label: "Value proposition", hint: "The promise in one or two sentences.", rows: 5 },
      ]}
    />
  );
}

export function BrandVoiceSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
  const v = strategy?.brand_voice ?? {};
  return (
    <TextSectionForm
      {...c}
      section="brand_voice"
      action={saveBrandVoiceAction.bind(null, c.projectId)}
      initial={{ tone: v.tone, do: v.do, dont: v.dont, vocabulary: v.vocabulary, examples: v.examples }}
      columns={2}
      fields={[
        { name: "tone", label: "Tone", hint: "3-5 adjectives and how they show up.", rows: 3 },
        { name: "vocabulary", label: "Signature vocabulary", hint: "Words and expressions the brand owns.", rows: 3 },
        { name: "do", label: "Do", rows: 4 },
        { name: "dont", label: "Don't", rows: 4 },
        { name: "examples", label: "Example lines", hint: "Short captions or hooks that sound exactly like the brand.", rows: 4 },
      ]}
    />
  );
}

export function FunnelSection({ strategy, ...c }: Common & { strategy: Strategy | null }) {
  return (
    <TextSectionForm
      {...c}
      section="funnel"
      action={saveFunnelAction.bind(null, c.projectId)}
      initial={(strategy?.funnel ?? {}) as Record<string, string>}
      columns={2}
      fields={FUNNEL_STAGES.map((s) => ({
        name: s,
        label: FUNNEL_LABELS[s],
        rows: 3,
        placeholder: "Role of content at this stage, formats, target share of the mix…",
      }))}
    />
  );
}

const personaFields: EntityField[] = [
  { name: "name", label: "Name", type: "text", required: true, wide: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "demographics", label: "Demographics", type: "text", wide: true },
  { name: "goals", label: "Goals", type: "textarea" },
  { name: "pain_points", label: "Pain points", type: "textarea" },
  { name: "objections", label: "Objections", type: "textarea" },
  { name: "preferred_platforms", label: "Preferred platforms", type: "checkboxes", options: PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })) },
];

export function PersonasSection({ personas, ...c }: Common & { personas: Persona[] }) {
  return (
    <EntityList
      {...c}
      entity="personas"
      noun="persona"
      icon={Users}
      emptyText="Personas describe who you create content for. Recommendations and copy are tailored to them."
      fields={personaFields}
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
                  <dt className="eyebrow mb-1">Goals</dt>
                  <dd><Lines text={p.goals} /></dd>
                </div>
              ) : null}
              {p.pain_points ? (
                <div>
                  <dt className="eyebrow mb-1">Pain points</dt>
                  <dd><Lines text={p.pain_points} /></dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {p.preferred_platforms?.length ? (
            <div className="flex flex-wrap gap-1">
              {p.preferred_platforms.map((pl) => <Badge key={pl} variant="outline">{PLATFORM_LABELS[pl as Platform]}</Badge>)}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}

const pillarFields: EntityField[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "target_share", label: "Target share (%)", type: "number", hint: "Share of total content, 0-100." },
  { name: "description", label: "Description", type: "textarea" },
  { name: "color", label: "Colour", type: "select", options: ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"].map((c) => ({ value: c, label: c })) },
];

const PILLAR_COLORS: Record<string, string> = {
  indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", sky: "bg-sky-500", violet: "bg-violet-500", slate: "bg-slate-500",
};

const FALLBACK_ORDER = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"];

export function PillarsSection({ pillars: raw, ...c }: Common & { pillars: ContentPillar[] }) {
  // Pillars without a chosen colour get a stable one by position, so the mix bar stays readable.
  const pillars = raw.map((p, i) => ({ ...p, color: p.color ?? FALLBACK_ORDER[i % FALLBACK_ORDER.length] }));
  const total = pillars.reduce((sum, p) => sum + (Number(p.target_share) || 0), 0);
  return (
    <div className="space-y-4">
      {pillars.length ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-muted-foreground">Target content mix</span>
            <span className={total === 100 ? "font-medium text-success" : "font-medium text-warning"}>
              {total}% {total === 100 ? "" : "· shares should add up to 100%"}
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
        noun="pillar"
        icon={Layers}
        emptyText="Content pillars are the recurring themes you publish about. The calendar generator balances content across them."
        fields={pillarFields}
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

const campaignFields: EntityField[] = [
  { name: "name", label: "Name", type: "text", required: true, wide: true },
  { name: "objective", label: "Objective", type: "textarea" },
  { name: "starts_on", label: "Start date", type: "date" },
  { name: "ends_on", label: "End date", type: "date" },
  { name: "funnel_focus", label: "Funnel focus", type: "select", options: funnelOptions },
  { name: "description", label: "Description", type: "textarea" },
];

export function CampaignsSection({ campaigns, ...c }: Common & { campaigns: Campaign[] }) {
  return (
    <EntityList
      {...c}
      entity="campaigns"
      noun="campaign"
      icon={CalendarRange}
      emptyText="Campaigns are time-bound pushes (launches, seasons, promotions). The calendar plans content around them."
      fields={campaignFields}
      items={campaigns}
      renderItem={(k) => (
        <div className="space-y-1 pr-14">
          <p className="font-medium">{k.name}</p>
          <p className="text-xs text-muted-foreground">
            {k.starts_on || k.ends_on ? `${k.starts_on ?? "?"} → ${k.ends_on ?? "?"}` : "No dates"}
            {k.funnel_focus ? ` · ${FUNNEL_LABELS[k.funnel_focus as FunnelStage]}` : ""}
          </p>
          {k.objective ? <p className="text-[13px]">{k.objective}</p> : null}
        </div>
      )}
    />
  );
}

const kpiFields: EntityField[] = [
  { name: "name", label: "KPI", type: "text", required: true, wide: true },
  { name: "target_value", label: "Target", type: "text" },
  { name: "unit", label: "Unit", type: "text", hint: "e.g. %, followers, leads" },
  { name: "period", label: "Period", type: "text", hint: "e.g. per month, Q1 2027" },
  { name: "funnel_stage", label: "Funnel stage", type: "select", options: funnelOptions },
];

export function KpisSection({ kpis, ...c }: Common & { kpis: Kpi[] }) {
  return (
    <EntityList
      {...c}
      entity="kpis"
      noun="KPI"
      icon={Gauge}
      emptyText="KPIs define how success is measured. Targets you enter here are goals, not tracked results."
      fields={kpiFields}
      items={kpis}
      renderItem={(k) => (
        <div className="space-y-3">
          <div className="pr-14">
            <p className="text-[14px] font-semibold leading-snug">{k.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">
              {[k.period?.toLowerCase(), k.funnel_stage ? FUNNEL_LABELS[k.funnel_stage as FunnelStage] : null].filter(Boolean).join(" · ") || "No period set"}
            </p>
          </div>
          {k.target_value ? (
            <p className="flex items-baseline gap-1.5">
              <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{k.target_value}</span>
              {k.unit ? <span className="text-[13px] text-muted-foreground">{k.unit}</span> : null}
              <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Target</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No target set</p>
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
