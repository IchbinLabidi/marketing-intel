"use client";

import * as React from "react";
import { toast } from "sonner";
import { LogOut, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { confirm } from "@/components/ui/confirm";
import { canGrant } from "@/lib/permissions";
import { removeMemberAction, setMemberRoleAction } from "@/server/actions/team";
import type { TeamMember, TeamRole } from "@/server/services/team";
import { PersonChip } from "./task-badges";

export function MembersTable({ members, roles, perms, userId }: { members: TeamMember[]; roles: TeamRole[]; perms: string[]; userId: string }) {
  const mine = React.useMemo(() => new Set(perms), [perms]);
  const manage = mine.has("team.manage");
  const [busy, setBusy] = React.useState<string | null>(null);
  const roleOf = (m: TeamMember) => roles.find((r) => r.id === m.role_id);

  const change = async (m: TeamMember, roleId: string) => {
    setBusy(m.user_id);
    const r = await setMemberRoleAction(m.user_id, roleId);
    setBusy(null);
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  };
  const remove = async (m: TeamMember) => {
    const self = m.user_id === userId;
    const ok = await confirm({
      title: self ? "Leave this workspace?" : `Remove ${m.full_name || "this member"}?`,
      description: self ? "You lose access to its projects. An admin can invite you again." : "They lose access immediately. Their open tasks go back to the backlog; history is kept.",
      confirmLabel: self ? "Leave workspace" : "Remove member",
      destructive: true,
    });
    if (!ok) return;
    setBusy(m.user_id);
    const r = await removeMemberAction(m.user_id);
    setBusy(null);
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <ul className="divide-y">
        {members.map((m) => {
          const role = roleOf(m);
          const owner = m.role === "owner";
          const self = m.user_id === userId;
          // Same rule as set_member_role(): you can't manage someone with more access than you, or yourself.
          const editable = manage && !owner && !self && (!role || canGrant(mine, role.permissions));
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <PersonChip size="md" name={m.full_name || m.email || "Unnamed member"} role={m.email ?? undefined} />
              </div>
              <div className="flex items-center gap-2">
                {owner ? <Badge variant="default">Owner</Badge> : null}
                {self ? <Badge variant="outline">You</Badge> : null}
              </div>
              <div className="w-full sm:w-52">
                {editable ? (
                  <NativeSelect aria-label={`Role for ${m.full_name || "member"}`} value={m.role_id ?? ""} disabled={busy === m.user_id} onChange={(e) => change(m, e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id} disabled={!canGrant(mine, r.permissions)}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <p className="text-[13px] font-medium">{role?.name ?? (owner ? "Admin" : m.role)}</p>
                )}
              </div>
              <div className="w-8">
                {editable || (self && !owner) ? (
                  <Button variant="ghost" size="icon-sm" aria-label={self ? "Leave workspace" : "Remove member"} disabled={busy === m.user_id} onClick={() => remove(m)}>
                    {self ? <LogOut /> : <UserMinus />}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
