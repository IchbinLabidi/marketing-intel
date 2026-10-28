import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleDashed, FolderKanban } from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { canEdit } from "@/lib/domain/constants";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { listChannels, listProjects } from "@/server/services/projects";
import { getStrategyBundle, strategyCompleteness } from "@/server/services/strategy";
import { isAIConfigured } from "@/server/ai/client";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={workspace.name}
        title={firstName ? `Hello, ${firstName}` : "Dashboard"}
        description={`${projects.length} active project${projects.length === 1 ? "" : "s"}. Open a project's Analytics to see what needs your attention.`}
        actions={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
      />

      {!isAIConfigured() ? (
        <Alert variant="warning" title="AI features are not configured">
          Add <code className="font-mono text-xs">GEMINI_API_KEY</code> (or <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>) to the
          server environment to enable strategy suggestions, analysis and calendar generation. Everything else works without it.
        </Alert>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Set up your first project"
          description="A project holds one brand's identity, strategy, past calendars, competitors and upcoming content."
          action={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
        />
      ) : (
        <section className="space-y-4">
          <SectionHeader
            title="Projects"
            description="Strategy completeness and the next step for each project."
            actions={
              projects.length > recent.length ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/projects">
                    View all {projects.length} <ArrowRight />
                  </Link>
                </Button>
              ) : null
            }
          />
          <div className="grid gap-4 md:grid-cols-2">
            {details.map(({ project, completeness, channels, pillars }) => {
              const nextStep = !channels
                ? { label: "Add your social channels", href: `/p/${project.id}#channels` }
                : completeness.percent < 100
                  ? { label: "Complete the marketing strategy", href: `/p/${project.id}/strategy` }
                  : { label: "Import past editorial calendars", href: `/p/${project.id}/history` };
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
                        {channels} channel{channels === 1 ? "" : "s"} · {pillars} content pillar{pillars === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Link
                      href={`/p/${project.id}`}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`Open ${project.name}`}
                    >
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </div>

                  <div className="space-y-3 px-5 py-4">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-muted-foreground">Strategy</span>
                      <span className="font-semibold tabular-nums text-foreground">{completeness.percent}%</span>
                    </div>
                    <Progress value={completeness.percent} label={`${project.name} strategy completeness`} />
                    <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 pt-1 text-xs sm:grid-cols-2">
                      {completeness.checks.slice(0, 8).map((c) => (
                        <li key={c.key} className="flex min-w-0 items-center gap-1.5">
                          {c.done ? (
                            <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label="Done" />
                          ) : (
                            <CircleDashed className="size-3.5 shrink-0 text-subtle-foreground" aria-label="To do" />
                          )}
                          <span className={c.done ? "truncate text-foreground" : "truncate text-muted-foreground"}>{c.key}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    href={nextStep.href}
                    className="mt-auto flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/40 px-5 py-3 text-[13px] transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">Next · </span>
                      <span className="font-medium">{nextStep.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {missing.length ? `${missing.length} to do` : null}
                      <ArrowRight className="size-4 text-foreground transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
