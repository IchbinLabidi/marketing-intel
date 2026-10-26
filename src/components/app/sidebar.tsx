"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Menu, Plus, X } from "lucide-react";
import { siteConfig } from "@/config/site";
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
import { GLOBAL_NAV, projectNav, SETTINGS_NAV, type NavItem } from "./nav-items";

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
  const setOpen = (value: boolean) => setOpenedOn(value ? pathname : null);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background px-3 md:hidden">
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-accent" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
        <span className="text-sm font-semibold">{siteConfig.name}</span>
      </header>
      {open ? <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} /> : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:sticky md:top-0 md:h-screen md:self-start md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button onClick={() => setOpen(false)} className="absolute -right-11 top-2 rounded-md bg-background p-1.5 shadow md:hidden" aria-label="Close navigation">
          <X className="size-4" />
        </button>
        <SidebarContent {...props} />
      </aside>
    </>
  );
}

function SidebarContent({ user, workspaces, activeWorkspace, projects, activeProjectId }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent outline-none">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              {activeWorkspace.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground">{activeWorkspace.name}</span>
              <span className="block text-[11px] capitalize text-muted-foreground">{activeWorkspace.role}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
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

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        <NavGroup items={GLOBAL_NAV} pathname={pathname} />

        <div>
          <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Project</div>
          <DropdownMenu>
            <DropdownMenuTrigger className="mb-1 flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 py-1.5 text-left text-[13px] outline-none hover:bg-sidebar-accent">
              <span className={cn("min-w-0 flex-1 truncate", !activeProject && "text-muted-foreground")}>
                {activeProject?.name ?? "Select a project"}
              </span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {projects.length === 0 ? <DropdownMenuLabel>No projects yet</DropdownMenuLabel> : null}
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
            <NavGroup items={projectNav(activeProject.id)} pathname={pathname} />
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground">Open a project to access strategy, intelligence and calendar modules.</p>
          )}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <NavGroup items={[SETTINGS_NAV]} pathname={pathname} />
        <DropdownMenu>
          <DropdownMenuTrigger className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent">
            <Avatar name={user.fullName || user.email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{user.fullName || "Account"}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem onSelect={() => signOutAction()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-sidebar-accent font-medium text-foreground",
              )}
            >
              <item.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
