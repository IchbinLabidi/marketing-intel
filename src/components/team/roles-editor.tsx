"use client";

import * as React from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirm } from "@/components/ui/confirm";
import { Field } from "@/components/app/form";
import { PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { deleteRoleAction, saveRoleAction } from "@/server/actions/team";
import type { TeamMember, TeamRole } from "@/server/services/team";
import { useT } from "@/i18n/client";

export function RolesEditor({ roles, members, perms }: { roles: TeamRole[]; members: TeamMember[]; perms: string[] }) {
  const t = useT("team");
  const mine = React.useMemo(() => new Set(perms), [perms]);
  const manage = mine.has("roles.manage");
  const [editing, setEditing] = React.useState<TeamRole | "new" | null>(null);
  const count = (id: string) => members.filter((m) => m.role_id === id).length;

  const remove = async (r: TeamRole) => {
    if (!(await confirm({ title: t("roles.confirmDeleteTitle", { name: r.name }), description: t("roles.confirmDeleteBody"), confirmLabel: t("roles.confirmDeleteLabel"), destructive: true }))) return;
    const res = await deleteRoleAction(r.id);
    if (res.ok) toast.success(res.message);
    else toast.error(res.error);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          {t("roles.intro")}
        </p>
        {manage ? <Button size="sm" onClick={() => setEditing("new")}><Plus /> {t("roles.newRole")}</Button> : null}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-col rounded-xl border bg-card p-4.5 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[14px] font-semibold">
                  {r.name}
                  {r.is_system ? <Badge variant="outline">{t("roles.system")}</Badge> : <Badge variant="info">{t("roles.custom")}</Badge>}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{r.description || t("roles.noDescription")}</p>
              </div>
              {manage && !(r.is_system && r.key === "admin") ? (
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={t("roles.edit", { name: r.name })} onClick={() => setEditing(r)}><Pencil /></Button>
                  {!r.is_system ? <Button variant="ghost" size="icon-sm" aria-label={t("roles.delete", { name: r.name })} onClick={() => remove(r)}><Trash2 /></Button> : null}
                </div>
              ) : r.key === "admin" ? <Lock className="size-4 text-subtle-foreground" aria-label={t("roles.adminLocked")} /> : null}
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 mt-4 text-xs text-muted-foreground">
              <span>{t("roles.permissionCount", { count: r.permissions.length })}</span>
              <span>{t("roles.memberCount", { count: count(r.id) })}</span>
            </div>
          </li>
        ))}
      </ul>
      {editing ? <RoleDialog role={editing === "new" ? null : editing} mine={mine} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function RoleDialog({ role, mine, onClose }: { role: TeamRole | null; mine: ReadonlySet<string>; onClose: () => void }) {
  const t = useT("team");
  const td = useT("domain");
  const tc = useT("common");
  const [name, setName] = React.useState(role?.name ?? "");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(new Set(role?.permissions ?? ["strategy.view"]));
  const [busy, setBusy] = React.useState(false);
  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const save = async () => {
    setBusy(true);
    const r = await saveRoleAction(role?.id ?? null, { name, description, permissions: [...selected] as Permission[] });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? t("roles.dialogEdit", { name: role.name }) : t("roles.dialogNew")}</DialogTitle>
          <DialogDescription>{t("roles.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("roles.name")} htmlFor="role-name" required>
            <Input id="role-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={role?.is_system} />
          </Field>
          <Field label={t("roles.description")} htmlFor="role-description" optional>
            <Textarea id="role-description" rows={1} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-4">
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.key} className="space-y-2">
              <legend className="eyebrow mb-2">{td(`permissionGroup.${g.key}`)}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.permissions.map((p) => {
                  const allowed = mine.has(p.key);
                  return (
                    <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors has-[:checked]:border-primary/30 has-[:checked]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                      <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={selected.has(p.key)} disabled={!allowed} onChange={() => toggle(p.key)} />
                      <span>
                        <span className="block font-medium">{td(`permission.${p.key}`)}</span>
                        <span className="block font-mono text-[11px] text-subtle-foreground">{p.key}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button>
          <Button onClick={save} loading={busy} disabled={!name.trim()}>{role ? t("roles.save") : t("roles.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
