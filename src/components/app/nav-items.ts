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
/** `hint` is a one-line plain explanation shown on hover. */
export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean; soon?: boolean; permission?: Permission; hint?: string };
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
        { label: "Overview", hint: "Brand profile, channels and where to start", href: base, icon: Compass, exact: true },
        { label: "Strategy", hint: "Goals, audiences, content themes and targets", href: `${base}/strategy`, icon: Target, permission: "strategy.view" },
      ],
    },
    {
      label: "Learn",
      items: [
        { label: "Content history", hint: "How your past posts performed", href: `${base}/history`, icon: History, permission: "intelligence.view" },
        { label: "Competitors", hint: "What competitors publish and how it performs", href: `${base}/competitors`, icon: Swords, permission: "intelligence.view" },
        { label: "Google search", hint: "What people search for on Google", href: `${base}/seo`, icon: Search, permission: "seo.view" },
      ],
    },
    {
      label: "Plan & produce",
      items: [
        { label: "Opportunities", hint: "Ranked ideas for what to create next", href: `${base}/opportunities`, icon: Lightbulb, permission: "opportunities.view" },
        { label: "Calendar", hint: "What gets published, when and where", href: `${base}/calendar`, icon: CalendarDays, permission: "calendar.view" },
        { label: "Production", hint: "Content being written, reviewed and approved", href: `${base}/production`, icon: PenSquare },
      ],
    },
    {
      label: "Results",
      items: [{ label: "Analytics", hint: "Is the plan delivered, and what needs your attention", href: `${base}/analytics`, icon: BarChart3, permission: "calendar.view" }],
    },
  ];
}

export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: Settings };
