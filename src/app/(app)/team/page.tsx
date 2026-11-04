import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { Alert } from "@/components/ui/alert";
import { MembersTable } from "@/components/team/members-table";
import { InvitePanel } from "@/components/team/invite-panel";
import { RolesEditor } from "@/components/team/roles-editor";
import { PermissionDenied } from "@/components/app/permission-denied";
import { getFormatter, getT } from "@/i18n/server";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { getPermissions, listAudit, listInvitations, listRoles, listTeam, teamSchemaReady } from "@/server/services/team";

export async function generateMetadata() {
  const t = await getT("team");
  return { title: t("meta.team") };
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, workspace, sp, t, fmt] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams, getT("team"), getFormatter()]);
  const ws = workspace!;
  const [perms, members, roles, ready] = await Promise.all([getPermissions(ws.id), listTeam(ws.id), listRoles(ws.id), teamSchemaReady()]);
  const manage = perms.has("team.manage");
  const tabs = [
    { key: "members", label: t("sections.members"), count: members.length },
    { key: "workload", label: t("sections.workload"), href: "/team/workload" },
    ...(manage ? [{ key: "invitations", label: t("sections.invitations") }] : []),
    { key: "roles", label: t("sections.roles"), count: roles.length },
    ...(manage ? [{ key: "activity", label: t("sections.activity") }] : []),
  ];
  const tab = tabs.some((x) => x.key === sp.tab) ? sp.tab! : "members";
  const [invitations, audit] = await Promise.all([
    tab === "invitations" && manage ? listInvitations(ws.id) : Promise.resolve([]),
    tab === "activity" && manage ? listAudit(ws.id) : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.full_name || (id ? t("page.formerMember") : t("page.system"));
  const actionLabel = (action: string) => (t.has(`audit.${action}`) ? t(`audit.${action}` as Parameters<typeof t>[0]) : action);
  const p = [...perms];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={ws.name} title={t("page.title")} description={t("page.description")} />
      {!ready ? (
        <Alert variant="warning" title={t("page.notReadyTitle")}>
          {t("page.notReadyBody")}
        </Alert>
      ) : null}
      <TabNav label={t("sections.label")} items={tabs.map((x) => ({ key: x.key, label: x.label, href: "href" in x && x.href ? x.href : `/team?tab=${x.key}`, active: tab === x.key, count: "count" in x ? x.count : undefined }))} />

      {tab === "members" ? <MembersTable members={members} roles={roles} perms={p} userId={user.id} /> : null}
      {tab === "invitations" ? (manage ? <InvitePanel roles={roles} invitations={invitations} perms={p} /> : <PermissionDenied what={t("page.deniedInvitations")} />) : null}
      {tab === "roles" ? <RolesEditor roles={roles} members={members} perms={p} /> : null}
      {tab === "activity" ? (
        audit.length ? (
          <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {audit.map((a) => {
              const detail = (a.details.email as string) || (a.details.role as string) || "";
              return (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                  <span>
                    <span className="font-medium">{nameOf(a.actor_id)}</span> {actionLabel(a.action)}{" "}
                    {a.target_user && a.target_user !== a.actor_id ? <span className="font-medium">{nameOf(a.target_user)}</span> : null}
                    {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
                  </span>
                  <time className="text-xs text-muted-foreground">{fmt.dateTime(a.created_at)}</time>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">{t("page.noActivity")}</p>
        )
      ) : null}
    </div>
  );
}
