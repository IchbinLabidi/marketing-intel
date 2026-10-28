import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { BackLink, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StartForm } from "@/components/editorial/start-form";
import { Badge } from "@/components/ui/badge";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { todayInZone } from "@/lib/calendar/time";
import { OBJECTIVE_LABELS, type Objective } from "@/lib/editorial/plan";
import { listEngineCalendars } from "@/server/services/editorial";
import { getProjectContext, listChannels } from "@/server/services/projects";

export const metadata = { title: "Plan a month" };

const STATUS_LABELS: Record<string, string> = { draft: "Opportunities", planned: "Content mix saved", generated: "Review", approved: "Approved", saved: "Saved" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await getProjectContext(projectId);
  const [calendars, channels] = await Promise.all([listEngineCalendars(projectId), listChannels(projectId)]);
  const today = todayInZone(project.timezone || "Africa/Tunis");
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 7);
  const active = [...new Set(channels.filter((c) => c.is_active).map((c) => c.platform))].filter((p) => p !== "other") as Platform[];
  const defaults = (active.length ? active : (["instagram", "facebook"] as Platform[])).map((p) => {
    const ch = channels.find((c) => c.platform === p && c.target_posts_per_week != null);
    return { platform: p, perWeek: ch ? Number(ch.target_posts_per_week) : p === "blog" ? 1 : 3 };
  });

  return (
    <div className="space-y-6">
      <BackLink href={`/p/${projectId}/calendar`}>Editorial Calendar</BackLink>
      <PageHeader title="Plan a month" description="Builds a month of posts from your strategy, past results and content ideas. You review and approve the plan before anything is scheduled." />
      <StartForm projectId={projectId} defaults={{ month: next, platforms: defaults }} readOnly={!canEdit(role)} />
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold">Planned calendars</h2>
        {!calendars.length ? <EmptyState icon={CalendarRange} title="No calendar planned with the engine yet" description="Start with a month above. Calendars created from Content history stay in the Editorial Calendar." /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {calendars.map((c) => (
              <li key={c.id}>
                <Link href={`/p/${projectId}/calendar/plan/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-xs hover:shadow-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.starts_on} → {c.ends_on} · {c.objective ? OBJECTIVE_LABELS[c.objective as Objective] : "—"} · {c.item_count} posts</span>
                  </span>
                  <Badge variant={c.status === "approved" ? "default" : "outline"}>{STATUS_LABELS[c.status] ?? c.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
