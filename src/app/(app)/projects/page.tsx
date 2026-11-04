import Link from "next/link";
import { Archive, FolderKanban, Globe } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SegmentedNav } from "@/components/app/segmented-nav";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { canEdit } from "@/lib/domain/constants";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { listProjects } from "@/server/services/projects";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("projects");
  return { title: t("list.metaTitle") };
}

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { new: openNew, archived } = await searchParams;
  const [t, td, fmt] = await Promise.all([getT("projects"), getT("domain"), getFormatter()]);
  const workspace = (await getActiveWorkspace())!;
  const showArchived = archived === "1";
  const projects = (await listProjects(workspace.id, { includeArchived: showArchived })).filter((p) =>
    showArchived ? p.archived_at : !p.archived_at,
  );
  const editable = canEdit(workspace.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={<CreateProjectDialog defaultOpen={openNew === "1" && editable} disabled={!editable} />}
      />

      <SegmentedNav
        label={t("list.statusNav")}
        items={[
          { label: t("list.active"), href: "/projects", active: !showArchived },
          { label: t("list.archived"), href: "/projects?archived=1", active: showArchived },
        ]}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={showArchived ? Archive : FolderKanban}
          title={showArchived ? t("list.emptyArchivedTitle") : t("list.emptyTitle")}
          description={
            showArchived
              ? t("list.emptyArchivedDescription")
              : t("list.emptyDescription")
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
                    <p className="truncate text-xs text-muted-foreground">{p.industry || t("list.noIndustry")}</p>
                  </div>
                  <Badge variant="outline">{td(`language.${p.default_language}`)}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-muted-foreground">
                  {p.description || t("list.noDescription")}
                </p>
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>{t("list.updated", { when: fmt.relative(new Date(p.updated_at)) })}</span>
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
