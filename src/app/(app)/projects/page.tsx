import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Archive, FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { canEdit, LANGUAGE_LABELS } from "@/lib/domain/constants";
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
      <div className="flex gap-3 text-[13px]">
        <Link href="/projects" className={!showArchived ? "font-medium" : "text-muted-foreground hover:text-foreground"}>
          Active
        </Link>
        <Link href="/projects?archived=1" className={showArchived ? "font-medium" : "text-muted-foreground hover:text-foreground"}>
          Archived
        </Link>
      </div>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className="group rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate font-medium group-hover:text-primary">{p.name}</h3>
                <Badge variant="secondary">{LANGUAGE_LABELS[p.default_language]}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 min-h-9 text-[13px] text-muted-foreground">{p.description || p.industry || "No description"}</p>
              <p className="mt-3 text-xs text-muted-foreground">Updated {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
