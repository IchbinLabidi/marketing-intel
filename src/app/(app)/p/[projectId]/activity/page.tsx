import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { Alert } from "@/components/ui/alert";
import { getProjectContext } from "@/server/services/projects";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { listTeam } from "@/server/services/team";
import { CHANGE_LOG_LIMIT, listChangeLog, type ChangeArea } from "@/server/services/change-log";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("changeLog");
  return { title: t("meta.title") };
}

const AREAS = ["all", "strategy", "content"] as const;

export default async function ChangeLogPage({ params, searchParams }: PageProps<"/p/[projectId]/activity">) {
  const [{ projectId }, sp, t, fmt] = await Promise.all([params, searchParams, getT("changeLog"), getFormatter()]);
  const { project } = await getProjectContext(projectId);
  const raw = typeof sp.area === "string" ? sp.area : "all";
  const area = (AREAS as readonly string[]).includes(raw) ? (raw as (typeof AREAS)[number]) : "all";
  const ws = await getActiveWorkspace();
  const [entries, members] = await Promise.all([
    listChangeLog(projectId, area === "all" ? undefined : (area as ChangeArea)),
    ws ? listTeam(ws.id) : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.full_name || t("page.formerMember") : t("page.system"));
  const fieldLabel = (f: string) => (t.has(`field.${f}`) ? t(`field.${f}` as Parameters<typeof t>[0]) : f.replaceAll("_", " "));
  const base = `/p/${projectId}/activity`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={project.name} title={t("page.title")} description={t("page.description")} />
      {entries === null ? (
        <Alert variant="warning" title={t("page.notReadyTitle")}>
          {t("page.notReadyBody")}
        </Alert>
      ) : (
        <>
          <TabNav
            label={t("page.filters")}
            items={AREAS.map((a) => ({ key: a, label: t(`page.${a}`), href: a === "all" ? base : `${base}?area=${a}`, active: area === a }))}
          />
          {entries.length ? (
            <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
              {entries.map((e) => {
                const href =
                  e.action === "deleted" ? null : e.entity === "content" && e.entity_id ? `/p/${projectId}/production?item=${e.entity_id}` : e.entity === "brand" ? `/p/${projectId}` : e.area === "strategy" ? `/p/${projectId}/strategy` : null;
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                    <span className="min-w-0">
                      <span className="font-medium">{nameOf(e.actor_id)}</span> {t(`action.${e.action}`)} {t(`entity.${e.entity}`)}
                      {e.label ? <span className="font-medium"> « {e.label} »</span> : null}
                      {e.fields.length ? <span className="text-muted-foreground"> · {e.fields.map(fieldLabel).filter((v, i, all) => all.indexOf(v) === i).join(", ")}</span> : null}
                      {href ? (
                        <>
                          {" "}
                          <Link className="text-primary hover:underline" href={href}>
                            {t("page.open")}
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <time className="text-xs text-muted-foreground">{fmt.dateTime(e.created_at)}</time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">{t("page.empty")}</p>
          )}
          {entries.length >= CHANGE_LOG_LIMIT ? <p className="text-xs text-muted-foreground">{t("page.showing", { count: CHANGE_LOG_LIMIT })}</p> : null}
        </>
      )}
    </div>
  );
}
