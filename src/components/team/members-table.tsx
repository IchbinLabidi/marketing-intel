"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, LogOut, Pencil, UserMinus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { confirm } from "@/components/ui/confirm";
import { canGrant } from "@/lib/permissions";
import { removeMemberAction, renameMemberAction, setMemberRoleAction } from "@/server/actions/team";
import type { TeamMember, TeamRole } from "@/server/services/team";
import { PersonChip } from "./task-badges";
import { useT } from "@/i18n/client";

export function MembersTable({ members, roles, perms, userId }: { members: TeamMember[]; roles: TeamRole[]; perms: string[]; userId: string }) {
  const t = useT("team");
  const td = useT("domain");
  const mine = React.useMemo(() => new Set(perms), [perms]);
  const manage = mine.has("team.manage");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const roleOf = (m: TeamMember) => roles.find((r) => r.id === m.role_id);

  const startRename = (m: TeamMember) => {
    setDraft(m.full_name);
    setEditing(m.user_id);
  };
  const saveRename = async (m: TeamMember) => {
    const name = draft.trim();
    if (!name || name === m.full_name) return setEditing(null);
    setBusy(m.user_id);
    const r = await renameMemberAction(m.user_id, name);
    setBusy(null);
    if (r.ok) {
      toast.success(r.message);
      setEditing(null);
    } else toast.error(r.error);
  };

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
      title: self ? t("members.confirmLeaveTitle") : t("members.confirmRemoveTitle", { name: m.full_name || t("members.thisMember") }),
      description: self ? t("members.confirmLeaveBody") : t("members.confirmRemoveBody"),
      confirmLabel: self ? t("members.leave") : t("members.remove"),
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
          // renameMemberAction() applies the same rule, and also lets a manager fix their own name here.
          const renamable = editable || (manage && self);
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="flex min-w-0 flex-1 basis-56 items-center gap-1">
                {editing === m.user_id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveRename(m);
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label={t("members.nameLabel")}
                      value={draft}
                      maxLength={80}
                      disabled={busy === m.user_id}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("members.saveName")} disabled={busy === m.user_id || !draft.trim()}>
                      <Check />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("members.cancel")} onClick={() => setEditing(null)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  <>
                    <PersonChip size="md" name={m.full_name || m.email || t("members.unnamed")} role={m.email ?? undefined} />
                    {renamable ? (
                      <Button variant="ghost" size="icon-sm" aria-label={t("members.rename", { name: m.full_name || t("members.memberFallback") })} onClick={() => startRename(m)}>
                        <Pencil />
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {owner ? <Badge variant="default">{td("role.owner")}</Badge> : null}
                {self ? <Badge variant="outline">{t("members.you")}</Badge> : null}
              </div>
              <div className="w-full sm:w-52">
                {editable ? (
                  <NativeSelect aria-label={t("members.roleFor", { name: m.full_name || t("members.memberFallback") })} value={m.role_id ?? ""} disabled={busy === m.user_id} onChange={(e) => change(m, e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id} disabled={!canGrant(mine, r.permissions)}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <p className="text-[13px] font-medium">{role?.name ?? (owner ? td("role.admin") : td(`role.${m.role}`))}</p>
                )}
              </div>
              <div className="w-8">
                {editable || (self && !owner) ? (
                  <Button variant="ghost" size="icon-sm" aria-label={self ? t("members.leave") : t("members.remove")} disabled={busy === m.user_id} onClick={() => remove(m)}>
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
