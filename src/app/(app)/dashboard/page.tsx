import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDashed, FolderKanban, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
        title={firstName ? `Hello, ${firstName}` : "Dashboard"}
        description={`${workspace.name} · ${projects.length} active project${projects.length === 1 ? "" : "s"}`}
        actions={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
      />

      {!isAIConfigured() ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-[13px]">
          <Sparkles className="mt-0.5 size-4 text-warning" />
          <div>
            <p className="font-medium">AI features are not configured</p>
            <p className="text-muted-foreground">
              Add <code className="font-mono text-xs">GEMINI_API_KEY</code> (or <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>) to the server environment to enable strategy suggestions,
              analysis and calendar generation. Everything else works without it.
            </p>
          </div>
        </div>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Set up your first project"
          description="A project holds one brand's identity, strategy, past calendars, competitors and upcoming content."
          action={<CreateProjectDialog disabled={!canEdit(workspace.role)} />}
        />
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Projects</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {details.map(({ project, completeness, channels, pillars }) => {
              const nextStep = !channels
                ? { label: "Add your social channels", href: `/p/${project.id}#channels` }
                : completeness.percent < 100
                  ? { label: "Complete the marketing strategy", href: `/p/${project.id}/strategy` }
                  : { label: "Import past editorial calendars", href: `/p/${project.id}/history` };
              return (
                <Card key={project.id}>
                  <CardHeader>
                    <CardTitle>
                      <Link href={`/p/${project.id}`} className="hover:text-primary">
                        {project.name}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {channels} channel{channels === 1 ? "" : "s"} · {pillars} content pillar{pillars === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="text-muted-foreground">Strategy completeness</span>
                        <span className="font-medium tabular-nums">{completeness.percent}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${completeness.percent}%` }} />
                      </div>
                    </div>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {completeness.checks.slice(0, 8).map((c) => (
                        <li key={c.key} className="flex items-center gap-1.5">
                          {c.done ? <CheckCircle2 className="size-3.5 text-success" /> : <CircleDashed className="size-3.5 text-muted-foreground" />}
                          <span className={c.done ? "" : "text-muted-foreground"}>{c.key}</span>
                        </li>
                      ))}
                    </ul>
                    <Button asChild variant="outline" size="sm" className="w-full justify-between">
                      <Link href={nextStep.href}>
                        Next: {nextStep.label} <ArrowRight />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {projects.length > recent.length ? (
            <Link href="/projects" className="text-[13px] text-muted-foreground hover:text-foreground">
              View all {projects.length} projects →
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
