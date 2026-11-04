import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { BackLink, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StartForm } from "@/components/editorial/start-form";
import { Badge } from "@/components/ui/badge";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { todayInZone } from "@/lib/calendar/time";
import { OBJECTIVES, type Objective } from "@/lib/editorial/plan";
import { listEngineCalendars } from "@/server/services/editorial";
import { getProjectContext, listChannels } from "@/server/services/projects";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("editorial");
  return { title: t("list.title") };
}

const STATUSES = ["draft", "planned", "generated", "approved", "saved"] as const;

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getT("editorial");
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
      <BackLink href={`/p/${projectId}/calendar`}>{t("list.back")}</BackLink>
      <PageHeader title={t("list.title")} description={t("list.description")} />
      <StartForm projectId={projectId} defaults={{ month: next, platforms: defaults }} readOnly={!canEdit(role)} />
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold">{t("list.planned")}</h2>
        {!calendars.length ? <EmptyState icon={CalendarRange} title={t("list.emptyTitle")} description={t("list.emptyDescription")} /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {calendars.map((c) => (
              <li key={c.id}>
                <Link href={`/p/${projectId}/calendar/plan/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-xs hover:shadow-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.starts_on} → {c.ends_on} · {c.objective && (OBJECTIVES as readonly string[]).includes(c.objective) ? t(`objectives.${c.objective as Objective}`) : "—"} · {t("list.posts", { count: c.item_count })}</span>
                  </span>
                  <Badge variant={c.status === "approved" ? "default" : "outline"}>{(STATUSES as readonly string[]).includes(c.status) ? t(`list.status.${c.status as (typeof STATUSES)[number]}`) : c.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
