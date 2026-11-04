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
import { useFormatter, useT } from "@/i18n/client";
import type { Formatter } from "@/i18n/format";
import type { TFor } from "@/i18n/messages";
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

/** Error codes of the connect callbacks (`?error=`); the text is `integrations.flash.errors.<code>`. */
const ERRORS = ["denied", "state", "not_configured", "read_only", "no_accounts", "provider", "scope"] as const;
type ErrorCode = (typeof ERRORS)[number];
const isErrorCode = (e: string): e is ErrorCode => (ERRORS as readonly string[]).includes(e);
const when = (t: TFor<"integrations">, fmt: Formatter, d: string | null | undefined) => (d ? fmt.dateTime(d) : t("common.never"));

export function connectionState(c: Pick<SocialConnection, "status" | "last_sync_status">): IntegrationState {
  if (c.status === "disconnected") return "disconnected";
  if (c.last_sync_status === "running") return "syncing";
  if (c.status === "permission_denied") return "permission_denied";
  if (c.status === "needs_attention" || c.last_sync_status === "failed") return "needs_attention";
  return "connected";
}

function StateBadge({ state }: { state: IntegrationState }) {
  const t = useT("integrations");
  const s = STATE_INFO[state];
  return <Badge variant={s.tone} dot>{state === "syncing" ? <Loader2 className="animate-spin" /> : null}{t(`states.${state}.label`)}</Badge>;
}

export function IntegrationsBoard({ projectId, canEdit, schemaReady, flash, meta, providers }: {
  projectId: string; canEdit: boolean; schemaReady: boolean; flash: { provider?: string; connected?: string; error?: string; detail?: string }; meta: MetaView; providers: ProviderView[];
}) {
  const router = useRouter();
  const t = useT("integrations");
  const syncing = meta.running || providers.some((p) => p.connections.some((c) => c.last_sync_status === "running"));
  React.useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [syncing, router]);

  const label = (k?: string) => (k === "youtube" ? "YouTube" : k === "linkedin" ? "LinkedIn" : k === "tiktok" ? "TikTok" : k === "google_drive" ? "Google Drive" : t("flash.theProvider"));
  const connectedCount = Number(flash.connected);
  return (
    <div className="space-y-4">
      {flash.connected ? <Alert variant="success" title={t("flash.connectedTitle", { provider: label(flash.provider) })}>{Number.isFinite(connectedCount) ? t("flash.accountsConnected", { count: connectedCount }) : t("flash.accountsConnectedRaw", { count: flash.connected })}{flash.provider === "google_drive" ? t("flash.driveNext") : t("flash.importStarted")}</Alert> : null}
      {flash.error ? <Alert variant="destructive" title={t("flash.errorTitle", { provider: label(flash.provider) })}>{isErrorCode(flash.error) ? t(`flash.errors.${flash.error}`) : t("flash.errors.generic")}{flash.detail ? ` (${flash.detail})` : ""}</Alert> : null}
      <MetaCard projectId={projectId} canEdit={canEdit} meta={meta} />
      {providers.map((p) => <ProviderCard key={p.key} projectId={projectId} canEdit={canEdit} schemaReady={schemaReady} p={p} />)}
    </div>
  );
}

function Shell({ icon, name, connects, state, children, info, hideMeaning }: { icon: string; name: string; connects: string; state: IntegrationState; children: React.ReactNode; info: ProviderInfo; hideMeaning?: boolean }) {
  const t = useT("integrations");
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
        {hideMeaning ? null : <p className="text-[13px]"><span className="font-medium">{t(`states.${state}.meaning`)}</span> <span className="text-muted-foreground">{t(`states.${state}.next`)}</span></p>}
        {children}
        <details className="text-[13px]">
          <summary>{t("shell.details")}</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <List title={t("shell.imported")} items={[...info.metrics, ...(info.extraWithOAuth ?? []).map((m) => t("shell.fullAccessOnly", { metric: m }))]} />
            <List title={t("shell.notAvailable")} items={info.notAvailable} />
            <List title={t("shell.permissions")} items={info.permissions} mono />
            <List title={t("shell.requirements")} items={info.requirements} />
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
  const t = useT("integrations");
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3 text-[13px]">
      <p className="font-medium">{t("setup.needed")} {missing.map((m) => <code key={m} className="mx-0.5 rounded bg-secondary px-1 font-mono text-xs">{m}</code>)}</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">{info.setup.map((s) => <li key={s}>{s}</li>)}</ol>
    </div>
  );
}

function MetaCard({ projectId, canEdit, meta }: { projectId: string; canEdit: boolean; meta: MetaView }) {
  const router = useRouter();
  const t = useT("integrations");
  const fmt = useFormatter();
  const [busy, setBusy] = React.useState(false);
  const c = meta.connection;
  const state: IntegrationState = !meta.configured ? "not_configured" : !c || c.status === "disconnected" ? (c ? "disconnected" : "ready")
    : c.status === "pending_page" ? "awaiting" : meta.running ? "syncing" : c.status === "expired" || c.status === "error" || c.last_sync_status === "failed" ? "needs_attention" : "connected";
  const connectHref = `/api/meta/connect?project=${projectId}`;
  return (
    <Shell icon="facebook" name={t("meta.name")} connects={meta.info.connects} state={state} info={meta.info}>
      {!meta.configured ? <SetupHelp info={meta.info} missing={meta.missing} /> : null}
      {c && c.status !== "disconnected" ? (
        <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          <Row k={t("meta.page")}>{c.page_name ?? t("meta.notChosen")}</Row>
          <Row k="Instagram">{c.ig_username ? `@${c.ig_username}` : t("meta.notLinked")}</Row>
          <Row k={t("meta.importedPosts")}>{t("meta.counts", { facebook: meta.counts.facebook, instagram: meta.counts.instagram })}</Row>
          <Row k={t("meta.lastSuccess")}>{when(t, fmt, meta.lastSuccess)}</Row>
          {c.token_expires_at ? <Row k={t("meta.accessExpires")}>{when(t, fmt, c.token_expires_at)}</Row> : null}
          {c.declined_scopes.length ? <Row k={t("meta.declined")}><span className="text-destructive">{c.declined_scopes.join(", ")}</span></Row> : null}
        </dl>
      ) : null}
      {c?.last_error && state === "needs_attention" ? <Alert variant="warning">{c.last_error}</Alert> : null}
      {meta.configured && canEdit ? (
        <div className="flex flex-wrap gap-2">
          {!c || c.status === "disconnected" || state === "needs_attention" || state === "awaiting" ? (
            <Button asChild size="sm"><a href={c?.status === "pending_page" ? `/p/${projectId}/history?tab=imports` : connectHref}><Plug className="size-3.5" /> {c && c.status !== "disconnected" ? (state === "awaiting" ? t("meta.choosePage") : t("common.reconnect")) : t("meta.connect")}</a></Button>
          ) : null}
          {c?.status === "active" ? (
            <Button size="sm" variant="outline" disabled={busy || meta.running} onClick={async () => { setBusy(true); const r = await syncMetaAction(projectId, "incremental"); setBusy(false); if (r.ok) toast.success(r.message ?? t("common.started")); else toast.error(r.error); router.refresh(); }}>
              <RefreshCcw className={cn("size-3.5", (busy || meta.running) && "animate-spin")} /> {t("common.syncNow")}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost"><Link href={`/p/${projectId}/history`}>{t("meta.manage")} <ExternalLink className="size-3.5" /></Link></Button>
        </div>
      ) : null}
    </Shell>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-2"><dt className="w-36 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0">{children}</dd></div>;
}

function ProviderCard({ projectId, canEdit, schemaReady, p }: { projectId: string; canEdit: boolean; schemaReady: boolean; p: ProviderView }) {
  const t = useT("integrations");
  const live = p.connections.filter((c) => c.status !== "disconnected");
  const states = live.map(connectionState);
  const order: IntegrationState[] = ["syncing", "permission_denied", "needs_attention", "connected"];
  const configured = p.oauthReady || p.publicReady;
  const state: IntegrationState = !schemaReady || !configured ? "not_configured" : states.length ? order.find((s) => states.includes(s))! : p.connections.length ? "disconnected" : "ready";
  return (
    <Shell icon={p.key} name={p.info.name} connects={p.info.connects} state={state} info={p.info} hideMeaning={!schemaReady && configured}>
      {!schemaReady ? <p className="text-[13px] text-muted-foreground">{configured ? t("provider.migrationReady") : t("provider.migration")}</p> : null}
      {!configured ? <SetupHelp info={p.info} missing={p.missing} /> : null}
      {schemaReady && p.key === "youtube" && p.publicReady && !p.oauthReady ? (
        <p className="text-[13px] text-muted-foreground">{t.rich("provider.youtubePublic", { code: () => <code className="font-mono text-xs">{p.missing.join(", ")}</code> })}</p>
      ) : null}
      {p.connections.length ? (
        <ul className="divide-y rounded-lg border">
          {p.connections.map((c) => <AccountRow key={c.id} projectId={projectId} canEdit={canEdit} c={c} oauthReady={p.oauthReady} provider={p.key} lastRun={p.runs.find((r) => r.connection_id === c.id)} />)}
        </ul>
      ) : null}
      {canEdit && schemaReady && configured ? (
        <div className="flex flex-wrap items-start gap-2">
          {p.oauthReady ? <Button asChild size="sm"><a href={`/api/integrations/${p.key}/connect?project=${projectId}`}><Plug className="size-3.5" /> {live.some((c) => c.auth_type === "oauth") ? t("provider.connectAnother") : t("provider.connect", { name: p.info.name })}</a></Button> : null}
          {p.key === "youtube" && p.publicReady ? <AddPublicChannel projectId={projectId} /> : null}
        </div>
      ) : null}
    </Shell>
  );
}

function AccountRow({ projectId, canEdit, c, oauthReady, provider, lastRun }: { projectId: string; canEdit: boolean; c: SocialConnection & { posts: number }; oauthReady: boolean; provider: string; lastRun?: SocialSyncRun }) {
  const router = useRouter();
  const t = useT("integrations");
  const tc = useT("common");
  const fmt = useFormatter();
  const [busy, setBusy] = React.useState(false);
  const [disconnect, setDisconnect] = React.useState(false);
  const [deletePosts, setDeletePosts] = React.useState(false);
  const state = connectionState(c);
  const run = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) toast.success(r.message ?? t("common.done")); else toast.error(r.error ?? t("common.failed"));
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
            <Badge variant="outline">{c.auth_type === "api_key" ? t("account.publicData") : t("account.fullAccess")}</Badge>
          </p>
          <p className="text-muted-foreground">
            {provider === "youtube" ? t("account.videosImported", { count: c.posts }) : t("account.postsImported", { count: c.posts })} · {c.followers != null ? <><Users className="inline size-3.5" /> {provider === "youtube" ? t("account.subscribers", { count: c.followers }) : t("account.followers", { count: c.followers })} · </> : null}
            {t("account.lastSuccess", { when: when(t, fmt, c.last_success_at) })}{lastRun?.status === "partial" ? t("account.partial") : ""}
            {c.token_expires_at && c.auth_type === "oauth" ? t("account.renews", { when: when(t, fmt, c.token_expires_at) }) : ""}
          </p>
          {c.declined_scopes.length ? <p className="text-destructive">{t("account.notGranted", { scopes: c.declined_scopes.join(", ") })}</p> : null}
        </div>
        {canEdit && c.status !== "disconnected" ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy || state === "syncing"} onClick={() => run(() => syncSocialAction(projectId, c.id))}>
              <RefreshCcw className={cn("size-3.5", (busy || state === "syncing") && "animate-spin")} /> {t("common.syncNow")}
            </Button>
            {c.auth_type === "oauth" && oauthReady && (state === "needs_attention" || state === "permission_denied") ? (
              <Button asChild size="sm"><a href={`/api/integrations/${provider}/connect?project=${projectId}`}>{t("common.reconnect")}</a></Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setDisconnect(true)}><Unplug className="size-3.5" /> {t("account.disconnect")}</Button>
          </div>
        ) : null}
      </div>
      {c.last_error && state !== "connected" ? <Alert variant={state === "permission_denied" ? "destructive" : "warning"}>{c.last_error}</Alert> : null}
      {canEdit && c.status !== "disconnected" ? (
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={c.auto_sync} disabled={busy} onChange={(e) => run(() => setSocialAutoSyncAction(projectId, c.id, e.target.checked))} /> {t("account.syncDaily")}
        </label>
      ) : null}
      <Dialog open={disconnect} onOpenChange={setDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.account_name ? t("account.disconnectTitle", { name: c.account_name }) : t("account.disconnectThis")}</DialogTitle>
            <DialogDescription>{c.auth_type === "oauth" ? t("account.revokeOauth") : t("account.revokeKey")} {t("account.keptPosts")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={deletePosts} onChange={(e) => setDeletePosts(e.target.checked)} /> {t("account.alsoDelete", { count: c.posts })}</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnect(false)}>{tc("actions.cancel")}</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { setDisconnect(false); await run(() => disconnectSocialAction(projectId, c.id, deletePosts)); }}>{t("account.disconnect")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function AddPublicChannel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const t = useT("integrations");
  const tc = useT("common");
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="size-3.5" /> {t("addChannel.open")}</Button>;
  return (
    <form className="flex w-full flex-wrap gap-2 sm:w-auto" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await addYouTubeChannelAction(projectId, value);
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success(r.message ?? t("addChannel.added"));
      setOpen(false); setValue("");
      router.refresh();
    }}>
      <Input autoFocus className="h-8 w-72 max-w-full text-[13px]" placeholder={t("addChannel.placeholder")} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("addChannel.label")} />
      <Button size="sm" type="submit" loading={busy} disabled={!value.trim()}>{t("addChannel.add")}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
    </form>
  );
}
