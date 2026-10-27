import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Archive, FolderKanban, Globe } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { canEdit, LANGUAGE_LABELS } from "@/lib/domain/constants";
import { cn } from "@/lib/utils";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { listProjects } from "@/server/services/projects";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { new: openNew, archived } = await searchParams;
  const workspace = (await getActiveWorkspace())!;
  const showArchived = archived === "1";
  const projects = (await listProjects(workspace.id, { includeArchived: showArchived })).filter((p) =>
    showArchived ? p.archived_at : !p.archived_at,
  );
  const editable = canEdit(workspace.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Each project is a brand or client with its own strategy, content history, competitors and editorial calendar."
        actions={<CreateProjectDialog defaultOpen={openNew === "1" && editable} disabled={!editable} />}
      />

      <nav aria-label="Project status" className="inline-flex rounded-lg border bg-secondary p-0.5 text-[13px]">
        {[
          { label: "Active", href: "/projects", active: !showArchived },
          { label: "Archived", href: "/projects?archived=1", active: showArchived },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              t.active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {projects.length === 0 ? (
        <EmptyState
          icon={showArchived ? Archive : FolderKanban}
          title={showArchived ? "No archived projects" : "Create your first project"}
          description={
            showArchived
              ? "Archived projects appear here."
              : "Start with one brand. You'll define its identity and strategy, then import past calendars and competitors."
          }
          action={showArchived ? undefined : <CreateProjectDialog disabled={!editable} />}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${p.id}`}
                className="group flex h-full flex-col rounded-xl border bg-card p-4.5 shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-secondary text-[13px] font-semibold text-foreground">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold group-hover:text-primary">{p.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">{p.industry || "No industry set"}</p>
                  </div>
                  <Badge variant="outline">{LANGUAGE_LABELS[p.default_language]}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-muted-foreground">
                  {p.description || "No description yet."}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>Updated {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}</span>
                  {p.website ? (
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      <Globe className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
