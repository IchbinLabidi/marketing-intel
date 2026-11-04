import {
  BarChart3,
  CalendarDays,
  Compass,
  FolderKanban,
  Gauge,
  Inbox,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Plug,
  PenSquare,
  Search,
  Settings,
  Swords,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import type { TFor } from "@/i18n/messages";

/** `soon` marks modules that are designed but not built yet (they render a roadmap page). */
/** `hint` is a one-line plain explanation shown on hover. */
export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean; soon?: boolean; permission?: Permission; hint?: string };
export type NavSection = { label?: string; items: NavItem[] };

export const globalNav = (t: TFor<"nav">): NavItem[] => [
  { label: t("global.dashboard"), href: "/dashboard", icon: LayoutDashboard },
  { label: t("global.tasks"), href: "/tasks", icon: ListChecks },
  { label: t("global.projects"), href: "/projects", icon: FolderKanban },
  { label: t("global.team"), href: "/team", icon: Users },
  { label: t("global.aiUsage"), href: "/ai-usage", icon: Gauge, permission: "ai_usage.view" },
];

/** Project modules, grouped in the order the work happens: plan → research → create → measure. */
export function projectNavSections(projectId: string, t: TFor<"nav">): NavSection[] {
  const base = `/p/${projectId}`;
  return [
    {
      items: [
        { label: t("project.overview.label"), hint: t("project.overview.hint"), href: base, icon: Compass, exact: true },
        { label: t("project.strategy.label"), hint: t("project.strategy.hint"), href: `${base}/strategy`, icon: Target, permission: "strategy.view" },
        { label: t("project.integrations.label"), hint: t("project.integrations.hint"), href: `${base}/integrations`, icon: Plug, permission: "intelligence.view" },
      ],
    },
    {
      label: t("sections.learn"),
      items: [
        { label: t("project.history.label"), hint: t("project.history.hint"), href: `${base}/history`, icon: History, permission: "intelligence.view" },
        { label: t("project.competitors.label"), hint: t("project.competitors.hint"), href: `${base}/competitors`, icon: Swords, permission: "intelligence.view" },
        { label: t("project.seo.label"), hint: t("project.seo.hint"), href: `${base}/seo`, icon: Search, permission: "seo.view" },
      ],
    },
    {
      label: t("sections.plan"),
      items: [
        { label: t("project.opportunities.label"), hint: t("project.opportunities.hint"), href: `${base}/opportunities`, icon: Lightbulb, permission: "opportunities.view" },
        { label: t("project.backlog.label"), hint: t("project.backlog.hint"), href: `${base}/backlog`, icon: Inbox },
        { label: t("project.calendar.label"), hint: t("project.calendar.hint"), href: `${base}/calendar`, icon: CalendarDays, permission: "calendar.view" },
        { label: t("project.production.label"), hint: t("project.production.hint"), href: `${base}/production`, icon: PenSquare },
      ],
    },
    {
      label: t("sections.results"),
      items: [{ label: t("project.analytics.label"), hint: t("project.analytics.hint"), href: `${base}/analytics`, icon: BarChart3, permission: "calendar.view" }],
    },
  ];
}

export const settingsNav = (t: TFor<"nav">): NavItem => ({ label: t("global.settings"), href: "/settings", icon: Settings });
