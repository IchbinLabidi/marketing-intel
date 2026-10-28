"use client";

import * as React from "react";
import { Copy, Link2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/app/form";
import { canGrant } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { inviteMemberAction, revokeInvitationAction } from "@/server/actions/team";
import type { Invitation, TeamRole } from "@/server/services/team";

export function InvitePanel({ roles, invitations, perms }: { roles: TeamRole[]; invitations: Invitation[]; perms: string[] }) {
  const mine = React.useMemo(() => new Set(perms), [perms]);
  const grantable = roles.filter((r) => canGrant(mine, r.permissions));
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState(() => grantable.find((r) => r.key === "content_creator")?.id ?? grantable[0]?.id ?? "");
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Role";
  const [now] = React.useState(() => Date.now());

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await inviteMemberAction({ email, roleId });
    setBusy(false);
    if (!r.ok) return setError(r.fieldErrors?.email ?? r.error);
    setLink(r.data!.link);
    setEmail("");
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  };
  const revoke = async (id: string) => {
    const r = await revokeInvitationAction(id);
    if (r.ok) toast.success(r.message);
    else toast.error(r.error);
  };
  const status = (i: Invitation) =>
    i.accepted_at ? ["Accepted", "success"] as const : i.revoked_at ? ["Revoked", "outline"] as const : Date.parse(i.expires_at) < now ? ["Expired", "warning"] as const : ["Pending", "info"] as const;

  return (
    <div className="space-y-6">
      <form onSubmit={invite} className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">
        <div>
          <h3 className="text-[14px] font-semibold">Invite a team member</h3>
          <p className="text-[13px] text-muted-foreground">
            Creates a single-use link valid for 14 days. Send it yourself; it only works for the email address below.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
          <Field label="Email" htmlFor="invite-email" required>
            <Input id="invite-email" type="email" required autoComplete="off" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error)} />
          </Field>
          <Field label="Role" htmlFor="invite-role" required>
            <NativeSelect id="invite-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {grantable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          </Field>
          <Button type="submit" loading={busy} disabled={!email || !roleId}>
            {busy ? null : <Send />} Create invitation
          </Button>
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {link ? (
          <Alert variant="success" title="Invitation ready" action={<Button size="sm" variant="outline" onClick={() => copy(link)}><Copy /> Copy link</Button>}>
            <span className="flex items-center gap-1.5 break-all font-mono text-xs"><Link2 className="size-3.5 shrink-0" aria-hidden />{link}</span>
            <span className="mt-1 block text-xs">This link is shown once. If it&apos;s lost, create a new invitation (the old one is revoked automatically).</span>
          </Alert>
        ) : null}
      </form>

      <div className="space-y-3">
        <h3 className="text-[14px] font-semibold">Invitations</h3>
        {invitations.length ? (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {invitations.map((i) => {
              const [label, variant] = status(i);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
                  <span className="min-w-0 flex-1 basis-48 truncate font-medium">{i.email}</span>
                  <span className="text-muted-foreground">{roleName(i.role_id)}</span>
                  <Badge variant={variant} dot>{label}</Badge>
                  <span className="w-28 text-xs text-muted-foreground">Sent {formatDate(i.created_at)}</span>
                  {label === "Pending" ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Revoke invitation for ${i.email}`} onClick={() => revoke(i.id)}>
                      <X />
                    </Button>
                  ) : <span className="w-8" />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">No invitations yet.</p>
        )}
      </div>
    </div>
  );
}
