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

export type NavItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };

export const GLOBAL_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "AI usage", href: "/ai-usage", icon: Gauge },
];

export function projectNav(projectId: string): NavItem[] {
  const base = `/p/${projectId}`;
  return [
    { label: "Overview", href: base, icon: Compass, exact: true },
    { label: "Marketing Strategy", href: `${base}/strategy`, icon: Target },
    { label: "Historical Intelligence", href: `${base}/history`, icon: History },
    { label: "Competitor Intelligence", href: `${base}/competitors`, icon: Swords },
    { label: "SERP Intelligence", href: `${base}/seo`, icon: Search },
    { label: "Content Opportunities", href: `${base}/opportunities`, icon: Lightbulb },
    { label: "Editorial Calendar", href: `${base}/calendar`, icon: CalendarDays },
    { label: "Content Production", href: `${base}/production`, icon: PenSquare },
    { label: "Analytics", href: `${base}/analytics`, icon: BarChart3 },
  ];
}

export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: Settings };
