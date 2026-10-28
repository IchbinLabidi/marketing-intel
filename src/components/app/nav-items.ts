import {
  BarChart3,
  CalendarDays,
  Compass,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  PenSquare,
  Search,
  Settings,
  Swords,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

/** `soon` marks modules that are designed but not built yet (they render a roadmap page). */
export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean; soon?: boolean; permission?: Permission };
export type NavSection = { label?: string; items: NavItem[] };

export const GLOBAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "My tasks", href: "/tasks", icon: ListChecks },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Team", href: "/team", icon: Users },
  { label: "AI usage", href: "/ai-usage", icon: Gauge, permission: "ai_usage.view" },
];

/** Project modules, grouped in the order the work happens: plan → research → create → measure. */
export function projectNavSections(projectId: string): NavSection[] {
  const base = `/p/${projectId}`;
  return [
    {
      items: [
        { label: "Overview", href: base, icon: Compass, exact: true },
        { label: "Strategy", href: `${base}/strategy`, icon: Target, permission: "strategy.view" },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "Content history", href: `${base}/history`, icon: History, permission: "intelligence.view" },
        { label: "Competitors", href: `${base}/competitors`, icon: Swords, permission: "intelligence.view" },
        { label: "Search (SERP)", href: `${base}/seo`, icon: Search, permission: "seo.view" },
      ],
    },
    {
      label: "Content",
      items: [
        { label: "Opportunities", href: `${base}/opportunities`, icon: Lightbulb, permission: "opportunities.view" },
        { label: "Calendar", href: `${base}/calendar`, icon: CalendarDays, permission: "calendar.view" },
        { label: "Production", href: `${base}/production`, icon: PenSquare },
      ],
    },
    {
      label: "Measure",
      items: [{ label: "Analytics", href: `${base}/analytics`, icon: BarChart3, permission: "calendar.view" }],
    },
  ];
}

export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: Settings };
