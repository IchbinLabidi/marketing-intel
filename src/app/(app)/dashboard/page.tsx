import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleDashed, FolderKanban } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { DeleteProjectButton } from "@/components/projects/delete-project-dialog";
import { requireUser } from "@/server/services/session";
import { countProjectsByWorkspace, getActiveWorkspace, listWorkspaces } from "@/server/services/workspaces";
import { SwitchWorkspaceButton } from "@/components/app/switch-workspace-button";
import { listChannels, listProjects } from "@/server/services/projects";
import { getStrategyBundle, strategyCompleteness } from "@/server/services/strategy";
import { isAIConfigured } from "@/server/ai/client";
import { getT } from "@/i18n/server";
import { StoragePanel } from "@/components/dashboard/storage-panel";
import { getStorageUsage } from "@/server/services/storage-usage";

export async function generateMetadata() {
  const t = await getT("dashboard");
  return { title: t("meta.title") };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [t, ts] = await Promise.all([getT("dashboard"), getT("strategy")]);
  const workspace = (await getActiveWorkspace())!;
  const projects = await listProjects(workspace.id);
  const recent = projects.slice(0, 6);
  const details = await Promise.all(
    recent.map(async (p) => {
      const [bundle, channels] = await Promise.all([getStrategyBundle(p.id), listChannels(p.id)]);
      return { project: p, completeness: strategyCompleteness(bundle), channels: channels.length, pillars: bundle.pillars.length };
    }),
  );
  const firstName = user.fullName.split(" ")[0];
  const isAdmin = canAdmin(workspace.role);
  const usage = isAdmin ? await getStorageUsage(workspace.id).catch(() => null) : null;
  // An empty workspace while the person belongs to a team that has projects: point them there.
  const otherWithProjects =
    projects.length === 0
      ? await Promise.all([listWorkspaces(), countProjectsByWorkspace()]).then(([all, counts]) =>
          all.filter((w) => w.id !== workspace.id && (counts.get(w.id) ?? 0) > 0).map((w) => ({ ...w, projects: counts.get(w.id) ?? 0 })),
        )
      : [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={workspace.name}
        title={firstName ? t("header.greeting", { name: firstName }) : t("header.title")}
        description={t("header.description", { count: projects.length })}
        actions={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
      />

      {!isAIConfigured() ? (
        <Alert variant="warning" title={t("aiAlert.title")}>
          {t.rich("aiAlert.body", { code: (c) => <code className="font-mono text-xs">{c}</code> })}
        </Alert>
      ) : null}

      {otherWithProjects.map((w) => (
        <Alert
          key={w.id}
          variant="info"
          title={t("otherWorkspace.title", { workspace: w.name })}
          action={<SwitchWorkspaceButton workspaceId={w.id} label={t("otherWorkspace.open", { workspace: w.name })} />}
        >
          {t("otherWorkspace.body", { workspace: w.name, count: w.projects })}
        </Alert>
      ))}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={t("empty.title")}
          description={t("empty.description")}
          action={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
        />
      ) : (
        <section className="space-y-4">
          <SectionHeader
            title={t("projects.title")}
            description={t("projects.description")}
            actions={
              projects.length > recent.length ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/projects">
                    {t("projects.viewAll", { count: projects.length })} <ArrowRight />
                  </Link>
                </Button>
              ) : null
            }
          />
          <div className="grid gap-4 md:grid-cols-2">
            {details.map(({ project, completeness, channels, pillars }) => {
              const nextStep = !channels
                ? { label: t("nextStep.channels"), href: `/p/${project.id}#channels` }
                : completeness.percent < 100
                  ? { label: t("nextStep.strategy"), href: `/p/${project.id}/strategy` }
                  : { label: t("nextStep.history"), href: `/p/${project.id}/history` };
              const missing = completeness.checks.filter((c) => !c.done);
              return (
                <article key={project.id} className="group flex flex-col rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3 px-5 pt-4.5">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                        <Link href={`/p/${project.id}`} className="hover:text-primary">
                          {project.name}
                        </Link>
                      </h3>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {t("card.channels", { count: channels })} · {t("card.pillars", { count: pillars })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {isAdmin ? <DeleteProjectButton project={{ id: project.id, name: project.name }} /> : null}
                      <Link
                        href={`/p/${project.id}`}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label={t("card.open", { name: project.name })}
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-3 px-5 py-4">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-muted-foreground">{t("card.strategy")}</span>
                      <span className="font-semibold tabular-nums text-foreground">{completeness.percent}%</span>
                    </div>
                    <Progress value={completeness.percent} label={t("card.completeness", { name: project.name })} />
                    <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 pt-1 text-xs sm:grid-cols-2">
                      {completeness.checks.slice(0, 8).map((c) => (
                        <li key={c.key} className="flex min-w-0 items-center gap-1.5">
                          {c.done ? (
                            <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label={t("card.done")} />
                          ) : (
                            <CircleDashed className="size-3.5 shrink-0 text-subtle-foreground" aria-label={t("card.toDo")} />
                          )}
                          <span className={c.done ? "truncate text-foreground" : "truncate text-muted-foreground"}>{ts(`completeness.${c.key}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    href={nextStep.href}
                    className="mt-auto flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/40 px-5 py-3 text-[13px] transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{t("card.next")} · </span>
                      <span className="font-medium">{nextStep.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {missing.length ? t("card.missing", { count: missing.length }) : null}
                      <ArrowRight className="size-4 text-foreground transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {usage ? <StoragePanel usage={usage} /> : null}
    </div>
  );
}
