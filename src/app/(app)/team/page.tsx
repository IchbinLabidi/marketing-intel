import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { Alert } from "@/components/ui/alert";
import { MembersTable } from "@/components/team/members-table";
import { InvitePanel } from "@/components/team/invite-panel";
import { RolesEditor } from "@/components/team/roles-editor";
import { PermissionDenied } from "@/components/app/permission-denied";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import { getPermissions, listAudit, listInvitations, listRoles, listTeam, teamSchemaReady } from "@/server/services/team";

export const metadata = { title: "Team" };

const ACTION_LABELS: Record<string, string> = {
  "member.role_changed": "changed the role of",
  "member.removed": "removed",
  "member.left": "left the workspace",
  "invitation.created": "invited",
  "invitation.revoked": "revoked the invitation for",
  "invitation.accepted": "joined the workspace",
  "role.created": "created the role",
  "role.updated": "updated the role",
  "role.deleted": "deleted the role",
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, workspace, sp] = await Promise.all([requireUser(), getActiveWorkspace(), searchParams]);
  const ws = workspace!;
  const [perms, members, roles, ready] = await Promise.all([getPermissions(ws.id), listTeam(ws.id), listRoles(ws.id), teamSchemaReady()]);
  const manage = perms.has("team.manage");
  const tabs = [
    { key: "members", label: "Members", count: members.length },
    { key: "workload", label: "Workload", href: "/team/workload" },
    ...(manage ? [{ key: "invitations", label: "Invitations" }] : []),
    { key: "roles", label: "Roles & permissions", count: roles.length },
    ...(manage ? [{ key: "activity", label: "Activity" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "members";
  const [invitations, audit] = await Promise.all([
    tab === "invitations" && manage ? listInvitations(ws.id) : Promise.resolve([]),
    tab === "activity" && manage ? listAudit(ws.id) : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.full_name || (id ? "Former member" : "System");
  const p = [...perms];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={ws.name} title="Team" description="Members, their roles, and what each role can see and do." />
      {!ready ? (
        <Alert variant="warning" title="Team management is not set up yet">
          Database migration 0013 needs to be applied. Until then, members keep the previous owner / admin / editor / viewer roles.
        </Alert>
      ) : null}
      <TabNav label="Team sections" items={tabs.map((t) => ({ key: t.key, label: t.label, href: "href" in t && t.href ? t.href : `/team?tab=${t.key}`, active: tab === t.key, count: "count" in t ? t.count : undefined }))} />

      {tab === "members" ? <MembersTable members={members} roles={roles} perms={p} userId={user.id} /> : null}
      {tab === "invitations" ? (manage ? <InvitePanel roles={roles} invitations={invitations} perms={p} /> : <PermissionDenied what="invitations" />) : null}
      {tab === "roles" ? <RolesEditor roles={roles} members={members} perms={p} /> : null}
      {tab === "activity" ? (
        audit.length ? (
          <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {audit.map((a) => {
              const detail = (a.details.email as string) || (a.details.role as string) || "";
              return (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                  <span>
                    <span className="font-medium">{nameOf(a.actor_id)}</span> {ACTION_LABELS[a.action] ?? a.action}{" "}
                    {a.target_user && a.target_user !== a.actor_id ? <span className="font-medium">{nameOf(a.target_user)}</span> : null}
                    {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
                  </span>
                  <time className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</time>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">No team activity recorded yet.</p>
        )
      ) : null}
    </div>
  );
}
