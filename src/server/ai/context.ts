import "server-only";
import { LANGUAGE_LABELS, PLATFORM_LABELS } from "@/lib/domain/constants";
import type { BrandProfile, Project, ProjectChannel, StrategyBundle } from "@/types/domain";

const line = (label: string, value: unknown) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
    ? `${label}: (not provided)`
    : `${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;

/**
 * Serialises everything the user has told us about the project into a compact, labelled text block.
 * Missing fields are written as "(not provided)" so the model can't mistake silence for data.
 */
export function buildProjectContext(input: {
  project: Project;
  brand: BrandProfile | null;
  channels: ProjectChannel[];
  strategy: StrategyBundle;
}) {
  const { project, brand, channels, strategy } = input;
  const s = strategy.strategy;
  const parts: string[] = [
    "## Project",
    line("Name", project.name),
    line("Industry", project.industry),
    line("Website", project.website),
    line("Description", project.description),
    line("Default content language", LANGUAGE_LABELS[project.default_language]),
    "",
    "## Brand identity",
    line("Brand name", brand?.brand_name),
    line("Mission", brand?.mission),
    line("Vision", brand?.vision),
    line("Values", brand?.values),
    line("Personality", brand?.personality),
    line("Visual identity", brand?.visual_identity),
    line("Target audience", brand?.target_audience),
    line(
      "Products & services",
      brand?.products_services?.map((p) => (p.description ? `${p.name} (${p.description})` : p.name)),
    ),
    line("Differentiators", brand?.differentiators),
    "",
    "## Channels",
    channels.length
      ? channels
          .map((c) => `- ${PLATFORM_LABELS[c.platform]}${c.handle ? ` @${c.handle}` : ""}${c.target_posts_per_week ? `, target ${c.target_posts_per_week}/week` : ""}`)
          .join("\n")
      : "(none defined)",
    "",
    "## Strategy",
    line("Business objectives", s?.business_objectives),
    line("Marketing objectives", s?.marketing_objectives),
    line("Brand positioning", s?.brand_positioning),
    line("Value proposition", s?.value_proposition),
    line("Brand voice", s && Object.values(s.brand_voice ?? {}).some(Boolean) ? JSON.stringify(s.brand_voice) : null),
    line("Customer journey", s?.customer_journey?.length ? JSON.stringify(s.customer_journey) : null),
    line("Funnel notes", s && Object.values(s.funnel ?? {}).some(Boolean) ? JSON.stringify(s.funnel) : null),
    "",
    "## Personas",
    strategy.personas.length
      ? strategy.personas.map((p) => `- ${p.name}: ${[p.description, p.goals && `goals: ${p.goals}`, p.pain_points && `pains: ${p.pain_points}`].filter(Boolean).join("; ")}`).join("\n")
      : "(none)",
    "",
    "## Content pillars",
    strategy.pillars.length
      ? strategy.pillars.map((p) => `- ${p.name}${p.target_share != null ? ` (${p.target_share}%)` : ""}: ${p.description ?? ""}`).join("\n")
      : "(none)",
    "",
    "## Campaigns",
    strategy.campaigns.length
      ? strategy.campaigns.map((c) => `- ${c.name} [${c.starts_on ?? "?"} → ${c.ends_on ?? "?"}]: ${c.objective ?? ""}`).join("\n")
      : "(none)",
    "",
    "## KPIs",
    strategy.kpis.length ? strategy.kpis.map((k) => `- ${k.name}: ${k.target_value ?? "?"} ${k.unit ?? ""} ${k.period ?? ""}`).join("\n") : "(none)",
  ];
  return parts.join("\n");
}
