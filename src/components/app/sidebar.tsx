"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, FolderKanban, LogOut, Menu, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/server/actions/auth";
import { switchWorkspaceAction } from "@/server/actions/workspaces";
import type { Workspace } from "@/types/domain";
import { BrandMark } from "./brand";
import { GLOBAL_NAV, projectNavSections, SETTINGS_NAV, type NavItem } from "./nav-items";

type SidebarProps = {
  user: { email: string; fullName: string };
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  projects: { id: string; name: string }[];
  activeProjectId: string | null;
};

export function AppSidebar(props: SidebarProps) {
  const pathname = usePathname();
  // The mobile drawer is open only for the path it was opened on, so navigating closes it.
  const [openedOn, setOpenedOn] = React.useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = React.useCallback((value: boolean) => setOpenedOn(value ? pathname : null), [pathname]);
  const activeProject = props.projects.find((p) => p.id === props.activeProjectId) ?? null;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
        <BrandMark />
        {activeProject ? (
          <>
            <span className="text-border-strong" aria-hidden>
              /
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium">{activeProject.name}</span>
          </>
        ) : null}
      </header>
      {open ? <div className="fixed inset-0 z-40 bg-[oklch(0.2_0.02_262/0.32)] animate-fade-in md:hidden" onClick={() => setOpen(false)} /> : null}
      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:translate-x-0 md:self-start",
          open ? "translate-x-0 shadow-lg" : "-translate-x-full",
        )}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-2 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent md:hidden"
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
        <SidebarContent {...props} activeProject={activeProject} />
      </aside>
    </>
  );
}

function SidebarContent({
  user,
  workspaces,
  activeWorkspace,
  projects,
  activeProjectId,
  activeProject,
}: SidebarProps & { activeProject: { id: string; name: string } | null }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/dashboard" className="rounded-md">
          <BrandMark />
        </Link>
      </div>

      <div className="px-2.5 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card px-2 py-1.5 text-left shadow-xs outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[12px] font-semibold text-primary">
              {activeWorkspace.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight text-foreground">{activeWorkspace.name}</span>
              <span className="block text-[11px] capitalize leading-tight text-muted-foreground">{activeWorkspace.role}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onSelect={async () => {
                  await switchWorkspaceAction(w.id);
                  router.push("/dashboard");
                }}
              >
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === activeWorkspace.id ? <Check /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/settings#workspaces")}>
              <Plus /> New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-2.5 pb-3 pt-1">
        <NavList items={GLOBAL_NAV} pathname={pathname} />

        <div className="space-y-2">
          <div className="eyebrow px-2">Project</div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40">
              <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
              <span className={cn("min-w-0 flex-1 truncate font-medium", activeProject ? "text-foreground" : "text-muted-foreground")}>
                {activeProject?.name ?? "Select a project"}
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
              {projects.length === 0 ? <DropdownMenuLabel>No projects yet</DropdownMenuLabel> : <DropdownMenuLabel>Switch project</DropdownMenuLabel>}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => router.push(`/p/${p.id}`)}>
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.id === activeProjectId ? <Check /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/projects?new=1")}>
                <Plus /> New project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {activeProject ? (
            <div className="ml-[15px] space-y-3 border-l border-sidebar-border pl-1.5">
              {projectNavSections(activeProject.id).map((section, i) => (
                <div key={section.label ?? i} className="space-y-1">
                  {section.label ? <div className="eyebrow px-2 pt-0.5">{section.label}</div> : null}
                  <NavList items={section.items} pathname={pathname} />
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 text-xs leading-relaxed text-muted-foreground">
              Open a project to work on its strategy, intelligence and calendar.
            </p>
          )}
        </div>
      </nav>

      <div className="space-y-1 border-t border-sidebar-border p-2.5">
        <NavList items={[SETTINGS_NAV]} pathname={pathname} />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40">
            <Avatar name={user.fullName || user.email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight text-foreground">{user.fullName || "Account"}</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">{user.email}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
            <DropdownMenuItem onSelect={() => signOutAction()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NavList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-px">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-card font-medium text-foreground shadow-xs ring-1 ring-sidebar-border",
              )}
            >
              <item.icon
                className={cn("size-4 shrink-0 transition-colors", active ? "text-primary" : "text-subtle-foreground group-hover:text-muted-foreground")}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
