import {
  BarChart3,
  CalendarDays,
  Compass,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  Lightbulb,
  PenSquare,
  Search,
  Settings,
  Swords,
  Target,
  type LucideIcon,
} from "lucide-react";

/** `soon` marks modules that are designed but not built yet (they render a roadmap page). */
export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean; soon?: boolean };
export type NavSection = { label?: string; items: NavItem[] };

export const GLOBAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "AI usage", href: "/ai-usage", icon: Gauge },
];

/** Project modules, grouped in the order the work happens: plan → research → create → measure. */
export function projectNavSections(projectId: string): NavSection[] {
  const base = `/p/${projectId}`;
  return [
    {
      items: [
        { label: "Overview", href: base, icon: Compass, exact: true },
        { label: "Strategy", href: `${base}/strategy`, icon: Target },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "Content history", href: `${base}/history`, icon: History },
        { label: "Competitors", href: `${base}/competitors`, icon: Swords },
        { label: "Search (SERP)", href: `${base}/seo`, icon: Search },
      ],
    },
    {
      label: "Content",
      items: [
        { label: "Opportunities", href: `${base}/opportunities`, icon: Lightbulb },
        { label: "Calendar", href: `${base}/calendar`, icon: CalendarDays },
        { label: "Production", href: `${base}/production`, icon: PenSquare },
      ],
    },
    {
      label: "Measure",
      items: [{ label: "Analytics", href: `${base}/analytics`, icon: BarChart3, soon: true }],
    },
  ];
}

export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: Settings };
