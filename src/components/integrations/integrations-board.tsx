"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plug, Plus, RefreshCcw, Unplug, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { STATE_INFO, type IntegrationState, type ProviderInfo } from "@/lib/social/catalog";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { syncMetaAction } from "@/server/actions/meta";
import { addYouTubeChannelAction, disconnectSocialAction, setSocialAutoSyncAction, syncSocialAction } from "@/server/actions/social";
import type { SocialConnection, SocialSyncRun } from "@/server/services/social";

export type ProviderView = {
  key: "youtube" | "linkedin" | "tiktok";
  info: ProviderInfo;
  oauthReady: boolean;
  missing: string[];
  publicReady: boolean;
  connections: (SocialConnection & { posts: number })[];
  runs: SocialSyncRun[];
};
type MetaView = {
  info: ProviderInfo; configured: boolean; missing: string[]; running: boolean; lastSuccess: string | null; counts: { facebook: number; instagram: number };
  connection: { status: string; page_name: string | null; ig_username: string | null; last_sync_at: string | null; last_sync_status: string | null; last_error: string | null; granted_scopes: string[]; declined_scopes: string[]; token_expires_at: string | null } | null;
};

const ERRORS: Record<string, string> = {
  denied: "The authorization was cancelled. Nothing was connected.",
  state: "The sign-in expired or didn't come from this browser. Start again.",
  not_configured: "This provider isn't configured on the server yet.",
  read_only: "Your role can't manage integrations for this project.",
  no_accounts: "Sign-in worked, but no account you can read was found (for LinkedIn you must be an administrator of the page).",
  provider: "The provider returned an error.",
};
const when = (d: string | null | undefined) => (d ? formatDateTime(d) : "never");

export function connectionState(c: Pick<SocialConnection, "status" | "last_sync_status">): IntegrationState {
  if (c.status === "disconnected") return "disconnected";
  if (c.last_sync_status === "running") return "syncing";
  if (c.status === "permission_denied") return "permission_denied";
  if (c.status === "needs_attention" || c.last_sync_status === "failed") return "needs_attention";
  return "connected";
}

function StateBadge({ state }: { state: IntegrationState }) {
  const s = STATE_INFO[state];
  return <Badge variant={s.tone} dot>{state === "syncing" ? <Loader2 className="animate-spin" /> : null}{s.label}</Badge>;
}

export function IntegrationsBoard({ projectId, canEdit, schemaReady, flash, meta, providers }: {
  projectId: string; canEdit: boolean; schemaReady: boolean; flash: { provider?: string; connected?: string; error?: string; detail?: string }; meta: MetaView; providers: ProviderView[];
}) {
  const router = useRouter();
  const syncing = meta.running || providers.some((p) => p.connections.some((c) => c.last_sync_status === "running"));
  React.useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [syncing, router]);

  const label = (k?: string) => (k === "youtube" ? "YouTube" : k === "linkedin" ? "LinkedIn" : k === "tiktok" ? "TikTok" : "The provider");
  return (
    <div className="space-y-4">
      {flash.connected ? <Alert variant="success" title={`${label(flash.provider)} connected`}>{flash.connected === "1" ? "One account was" : `${flash.connected} accounts were`} connected. The first import has started.</Alert> : null}
      {flash.error ? <Alert variant="destructive" title={`${label(flash.provider)}: not connected`}>{ERRORS[flash.error] ?? "Something went wrong."}{flash.detail ? ` (${flash.detail})` : ""}</Alert> : null}
      <MetaCard projectId={projectId} canEdit={canEdit} meta={meta} />
      {providers.map((p) => <ProviderCard key={p.key} projectId={projectId} canEdit={canEdit} schemaReady={schemaReady} p={p} />)}
    </div>
  );
}

function Shell({ icon, name, connects, state, children, info, hideMeaning }: { icon: string; name: string; connects: string; state: IntegrationState; children: React.ReactNode; info: ProviderInfo; hideMeaning?: boolean }) {
  const s = STATE_INFO[state];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start gap-3 space-y-0">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-secondary"><PlatformIcon platform={icon} className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <CardTitle className="flex flex-wrap items-center gap-2">{name} <StateBadge state={state} /></CardTitle>
          <p className="text-[13px] text-muted-foreground">{connects}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hideMeaning ? null : <p className="text-[13px]"><span className="font-medium">{s.meaning}</span> <span className="text-muted-foreground">{s.next}</span></p>}
        {children}
        <details className="text-[13px]">
          <summary>Metrics, permissions and requirements</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <List title="Imported" items={[...info.metrics, ...(info.extraWithOAuth ?? []).map((m) => `${m} (full access only)`)]} />
            <List title="Not available" items={info.notAvailable} />
            <List title="Permissions requested (read-only)" items={info.permissions} mono />
            <List title="Requirements" items={info.requirements} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function List({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="grid gap-0.5">{items.map((i) => <li key={i} className={cn("text-[13px]", mono && "font-mono text-xs")}>{i}</li>)}</ul>
    </div>
  );
}

function SetupHelp({ info, missing }: { info: ProviderInfo; missing: string[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3 text-[13px]">
      <p className="font-medium">Server settings needed: {missing.map((m) => <code key={m} className="mx-0.5 rounded bg-secondary px-1 font-mono text-xs">{m}</code>)}</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">{info.setup.map((s) => <li key={s}>{s}</li>)}</ol>
    </div>
  );
}

function MetaCard({ projectId, canEdit, meta }: { projectId: string; canEdit: boolean; meta: MetaView }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const c = meta.connection;
  const state: IntegrationState = !meta.configured ? "not_configured" : !c || c.status === "disconnected" ? (c ? "disconnected" : "ready")
    : c.status === "pending_page" ? "awaiting" : meta.running ? "syncing" : c.status === "expired" || c.status === "error" || c.last_sync_status === "failed" ? "needs_attention" : "connected";
  const connectHref = `/api/meta/connect?project=${projectId}`;
  return (
    <Shell icon="facebook" name="Meta (Facebook and Instagram)" connects={meta.info.connects} state={state} info={meta.info}>
      {!meta.configured ? <SetupHelp info={meta.info} missing={meta.missing} /> : null}
      {c && c.status !== "disconnected" ? (
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          <Row k="Page">{c.page_name ?? "Not chosen yet"}</Row>
          <Row k="Instagram">{c.ig_username ? `@${c.ig_username}` : "Not linked"}</Row>
          <Row k="Imported posts">{meta.counts.facebook} Facebook · {meta.counts.instagram} Instagram</Row>
          <Row k="Last successful sync">{when(meta.lastSuccess)}</Row>
          {c.token_expires_at ? <Row k="Access expires">{when(c.token_expires_at)}</Row> : null}
          {c.declined_scopes.length ? <Row k="Declined permissions"><span className="text-destructive">{c.declined_scopes.join(", ")}</span></Row> : null}
        </dl>
      ) : null}
      {c?.last_error && state === "needs_attention" ? <Alert variant="warning">{c.last_error}</Alert> : null}
      {meta.configured && canEdit ? (
        <div className="flex flex-wrap gap-2">
          {!c || c.status === "disconnected" || state === "needs_attention" || state === "awaiting" ? (
            <Button asChild size="sm"><a href={c?.status === "pending_page" ? `/p/${projectId}/history?tab=imports` : connectHref}><Plug className="size-3.5" /> {c && c.status !== "disconnected" ? (state === "awaiting" ? "Choose the Page" : "Reconnect") : "Connect Meta"}</a></Button>
          ) : null}
          {c?.status === "active" ? (
            <Button size="sm" variant="outline" disabled={busy || meta.running} onClick={async () => { setBusy(true); const r = await syncMetaAction(projectId, "incremental"); setBusy(false); if (r.ok) toast.success(r.message ?? "Started"); else toast.error(r.error); router.refresh(); }}>
              <RefreshCcw className={cn("size-3.5", (busy || meta.running) && "animate-spin")} /> Sync now
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost"><Link href={`/p/${projectId}/history`}>Manage in Content history <ExternalLink className="size-3.5" /></Link></Button>
        </div>
      ) : null}
    </Shell>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-2"><dt className="w-36 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0">{children}</dd></div>;
}

function ProviderCard({ projectId, canEdit, schemaReady, p }: { projectId: string; canEdit: boolean; schemaReady: boolean; p: ProviderView }) {
  const live = p.connections.filter((c) => c.status !== "disconnected");
  const states = live.map(connectionState);
  const order: IntegrationState[] = ["syncing", "permission_denied", "needs_attention", "connected"];
  const configured = p.oauthReady || p.publicReady;
  const state: IntegrationState = !schemaReady || !configured ? "not_configured" : states.length ? order.find((s) => states.includes(s))! : p.connections.length ? "disconnected" : "ready";
  return (
    <Shell icon={p.key} name={p.info.name} connects={p.info.connects} state={state} info={p.info} hideMeaning={!schemaReady && configured}>
      {!schemaReady ? <p className="text-[13px] text-muted-foreground">Available once database migration 0015 is applied{configured ? "; the server settings are ready" : ""}.</p> : null}
      {!configured ? <SetupHelp info={p.info} missing={p.missing} /> : null}
      {schemaReady && p.key === "youtube" && p.publicReady && !p.oauthReady ? (
        <p className="text-[13px] text-muted-foreground">Public data is available now with the server&apos;s YouTube API key. Full access (watch time, shares, subscribers gained) needs <code className="font-mono text-xs">{p.missing.join(", ")}</code>.</p>
      ) : null}
      {p.connections.length ? (
        <ul className="divide-y rounded-lg border">
          {p.connections.map((c) => <AccountRow key={c.id} projectId={projectId} canEdit={canEdit} c={c} oauthReady={p.oauthReady} provider={p.key} lastRun={p.runs.find((r) => r.connection_id === c.id)} />)}
        </ul>
      ) : null}
      {canEdit && schemaReady && configured ? (
        <div className="flex flex-wrap items-start gap-2">
          {p.oauthReady ? <Button asChild size="sm"><a href={`/api/integrations/${p.key}/connect?project=${projectId}`}><Plug className="size-3.5" /> {live.some((c) => c.auth_type === "oauth") ? "Connect another account" : `Connect ${p.info.name}`}</a></Button> : null}
          {p.key === "youtube" && p.publicReady ? <AddPublicChannel projectId={projectId} /> : null}
        </div>
      ) : null}
    </Shell>
  );
}

function AccountRow({ projectId, canEdit, c, oauthReady, provider, lastRun }: { projectId: string; canEdit: boolean; c: SocialConnection & { posts: number }; oauthReady: boolean; provider: string; lastRun?: SocialSyncRun }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [disconnect, setDisconnect] = React.useState(false);
  const [deletePosts, setDeletePosts] = React.useState(false);
  const state = connectionState(c);
  const run = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error ?? "Failed");
    router.refresh();
  };
  return (
    <li className="space-y-2 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {c.account_url ? <a href={c.account_url} target="_blank" rel="noreferrer" className="hover:underline">{c.account_name ?? c.external_account_id}</a> : c.account_name ?? c.external_account_id}
            {c.account_handle ? <span className="font-normal text-muted-foreground">{c.account_handle}</span> : null}
            <StateBadge state={state} />
            <Badge variant="outline">{c.auth_type === "api_key" ? "Public data" : "Full access"}</Badge>
          </p>
          <p className="text-muted-foreground">
            {c.posts} {provider === "youtube" ? "videos" : "posts"} imported · {c.followers != null ? <><Users className="inline size-3.5" /> {c.followers.toLocaleString("en")} {provider === "youtube" ? "subscribers" : "followers"} · </> : null}
            Last successful sync {when(c.last_success_at)}{lastRun?.status === "partial" ? " (partial)" : ""}
            {c.token_expires_at && c.auth_type === "oauth" ? ` · access renews ${when(c.token_expires_at)}` : ""}
          </p>
          {c.declined_scopes.length ? <p className="text-destructive">Permissions not granted: {c.declined_scopes.join(", ")}</p> : null}
        </div>
        {canEdit && c.status !== "disconnected" ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy || state === "syncing"} onClick={() => run(() => syncSocialAction(projectId, c.id))}>
              <RefreshCcw className={cn("size-3.5", (busy || state === "syncing") && "animate-spin")} /> Sync now
            </Button>
            {c.auth_type === "oauth" && oauthReady && (state === "needs_attention" || state === "permission_denied") ? (
              <Button asChild size="sm"><a href={`/api/integrations/${provider}/connect?project=${projectId}`}>Reconnect</a></Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setDisconnect(true)}><Unplug className="size-3.5" /> Disconnect</Button>
          </div>
        ) : null}
      </div>
      {c.last_error && state !== "connected" ? <Alert variant={state === "permission_denied" ? "destructive" : "warning"}>{c.last_error}</Alert> : null}
      {canEdit && c.status !== "disconnected" ? (
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={c.auto_sync} disabled={busy} onChange={(e) => run(() => setSocialAutoSyncAction(projectId, c.id, e.target.checked))} /> Sync daily
        </label>
      ) : null}
      <Dialog open={disconnect} onOpenChange={setDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {c.account_name ?? "this account"}?</DialogTitle>
            <DialogDescription>{c.auth_type === "oauth" ? "Access is revoked with the provider and the stored token is deleted." : "The channel stops being synchronized."} Imported posts stay in Content history unless you delete them below.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={deletePosts} onChange={(e) => setDeletePosts(e.target.checked)} /> Also delete the {c.posts} imported posts</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnect(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { setDisconnect(false); await run(() => disconnectSocialAction(projectId, c.id, deletePosts)); }}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function AddPublicChannel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add a channel (public data)</Button>;
  return (
    <form className="flex w-full flex-wrap gap-2 sm:w-auto" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await addYouTubeChannelAction(projectId, value);
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success(r.message ?? "Added");
      setOpen(false); setValue("");
      router.refresh();
    }}>
      <Input autoFocus className="h-8 w-72 max-w-full text-[13px]" placeholder="youtube.com/@yourchannel or @handle" value={value} onChange={(e) => setValue(e.target.value)} aria-label="YouTube channel URL or handle" />
      <Button size="sm" type="submit" loading={busy} disabled={!value.trim()}>Add</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}
