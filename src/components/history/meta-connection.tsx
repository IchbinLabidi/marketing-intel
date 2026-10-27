"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera as Instagram, CheckCircle2, Flag as Facebook, Loader2, Plug, RefreshCcw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { disconnectMetaAction, listMetaPagesAction, selectMetaPageAction, setMetaAutoSyncAction, syncMetaAction } from "@/server/actions/meta";
import type { MetaConnection, MetaSyncRun } from "@/types/domain";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDate } from "@/lib/format";
import { confirm } from "@/components/ui/confirm";

type Props = {
  projectId: string;
  configured: boolean;
  missing: string[];
  backgroundSync: boolean;
  connection: Omit<MetaConnection, "fb_user_id"> | null;
  runs: MetaSyncRun[];
  counts: { facebook: number; instagram: number };
  readOnly: boolean;
  flash: { meta?: string; error?: string; message?: string };
  /** Pages available for selection, loaded on the server while the connection waits for a Page. */
  initialPages: { id: string; name: string; instagram: string | null; canAnalyze: boolean }[] | null;
  pagesError: string | null;
};

const ERRORS: Record<string, string> = {
  not_configured: "Meta is not configured on this server yet.",
  denied: "The Facebook authorization was cancelled.",
  state: "The Facebook login expired or didn't match this browser. Try again.",
  oauth: "Facebook returned an error during login. Try again.",
  exchange: "Facebook login worked but the token exchange failed.",
  read_only: "Your role in this workspace is read-only.",
};

const fmt = (d: string | null | undefined) => (d ? formatDateTime(d) : "never");

export function MetaConnectionPanel(props: Props) {
  const { projectId, configured, missing, connection: c, runs, counts, readOnly, flash, backgroundSync, initialPages, pagesError } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pages, setPages] = React.useState(initialPages);
  const [loadingPages, setLoadingPages] = React.useState(false);
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  const [deletePosts, setDeletePosts] = React.useState(false);
  const running = runs[0]?.status === "running";
  const connectHref = `/api/meta/connect?project=${projectId}`;

  // Poll while a sync runs in the background.
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [running, router]);

  React.useEffect(() => {
    if (flash.error) toast.error(`${ERRORS[flash.error] ?? "Meta connection failed."}${flash.message ? ` ${flash.message}` : ""}`);
    else if (flash.meta === "reconnected") toast.success("Meta reconnected");
  }, [flash.error, flash.meta, flash.message]);

  const loadPages = React.useCallback(async () => {
    setLoadingPages(true);
    const r = await listMetaPagesAction(projectId);
    setLoadingPages(false);
    if (r.ok) setPages(r.data ?? []);
    else toast.error(r.error);
  }, [projectId]);


  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error);
    });

  const connected = c && (c.status === "active" || c.status === "expired" || c.status === "error");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2"><Plug className="size-4" /> Meta · Facebook & Instagram</CardTitle>
          <CardDescription>
            Posts and their available metrics are retrieved automatically with the official Meta Graph API. Only metrics Meta returns for your account are stored.
          </CardDescription>
        </div>
        {connected && !readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || running || c.status !== "active"} onClick={() => run(() => syncMetaAction(projectId, "incremental"))}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {running ? "Syncing…" : "Sync now"}
            </Button>
            <Button size="sm" variant="outline" disabled={pending || running || c.status !== "active"} onClick={() => run(() => syncMetaAction(projectId, "refresh"))} title="Re-reads metrics of all synced posts and re-checks which metrics Meta supports">
              Refresh all metrics
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warning" /> Setup required before connecting</p>
            <p className="mt-1 text-xs">
              Add {missing.map((m) => <code key={m} className="mx-0.5 rounded bg-background px-1">{m}</code>)} to the server environment, then restart. The step-by-step Meta app setup is in <code className="rounded bg-background px-1">docs/META_SETUP.md</code>.
            </p>
          </div>
        ) : null}

        {(!c || c.status === "disconnected") && configured ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">
              Connect the Facebook account that manages your Page. You will choose the Page; its linked Instagram Business or Creator account is detected automatically. Access is read-only.
            </p>
            {!readOnly ? (
              <Button asChild>
                <a href={connectHref}><Facebook /> Connect Meta</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {c?.status === "pending_page" ? (
          <div className="space-y-3">
            <p className="text-[13px]">Connected as <span className="font-medium">{c.fb_user_name}</span>. Choose the Facebook Page for this project:</p>
            {pagesError ? <p className="text-xs text-destructive">{pagesError}</p> : null}
            {pages && !pages.length ? (
              <p className="text-xs text-warning">No Page was shared with this app. Reconnect and select at least one Page in the Facebook dialog, or check that you have a role on the Page.</p>
            ) : null}
            <ul className="grid gap-2 sm:grid-cols-2">
              {pages?.map((p) => (
                <li key={p.id}>
                  <button
                    disabled={pending || readOnly}
                    onClick={() => run(() => selectMetaPageAction(projectId, p.id))}
                    className="flex w-full items-start gap-3 rounded-lg border p-3 text-left text-[13px] transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
                  >
                    <Facebook className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.instagram ? <>Instagram: @{p.instagram}</> : "No Instagram professional account linked"}
                      </span>
                      {!p.canAnalyze ? <span className="block text-xs text-warning">Your Page role can’t read insights (needs the Analyze task)</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!readOnly ? <Button asChild variant="ghost" size="sm"><a href={connectHref}>Use another Facebook account</a></Button> : null}
          </div>
        ) : null}

        {connected ? (
          <>
            {c.status !== "active" ? (
              <Alert
                variant="destructive"
                title={c.status === "expired" ? "Meta access expired or was revoked." : "The connection has an error."}
                action={!readOnly ? <Button asChild size="sm"><a href={connectHref}>Reconnect Meta</a></Button> : null}
              >
                {c.last_error}
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Account icon={Facebook} title={c.page_name ?? "Facebook Page"} subtitle={`Facebook Page · ${counts.facebook} posts synced`} ok={c.status === "active"} />
              <Account
                icon={Instagram}
                title={c.ig_username ? `@${c.ig_username}` : "No Instagram account"}
                subtitle={c.ig_user_id ? `Instagram professional account · ${counts.instagram} posts synced` : "Link an Instagram Business or Creator account to this Page in Meta Business Suite, then reconnect."}
                ok={Boolean(c.ig_user_id) && c.status === "active"}
              />
            </div>
            <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Row label="Last synchronization" value={`${fmt(c.last_sync_at)}${c.last_sync_status ? ` · ${c.last_sync_status}` : ""}`} />
              <Row label="Connected as" value={c.fb_user_name ?? "—"} />
              <Row label="Token valid until" value={c.token_expires_at ? formatDate(c.token_expires_at) : "no expiry reported"} />
              <Row
                label="Automatic sync"
                value={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {c.auto_sync ? "Daily" : "Off"}
                    {!readOnly ? (
                      <button className="text-primary underline-offset-4 hover:underline" disabled={pending} onClick={() => run(() => setMetaAutoSyncAction(projectId, !c.auto_sync))}>
                        {c.auto_sync ? "turn off" : "turn on"}
                      </button>
                    ) : null}
                    {c.auto_sync && !backgroundSync ? <span className="basis-full text-muted-foreground">Runs when the page is opened (scheduler not configured)</span> : null}
                  </span>
                }
              />
            </dl>
            {c.declined_scopes.length ? (
              <p className="text-xs text-warning">Permissions declined in Facebook: {c.declined_scopes.join(", ")}. Some posts or metrics can’t be read until you reconnect and grant them.</p>
            ) : null}
            <SupportedMetrics supported={c.supported_metrics} />
            <SyncLog runs={runs} />
            {!readOnly ? (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => { void loadPages(); }}>{loadingPages ? <Loader2 className="animate-spin" /> : null} Change Page</Button>
                <Button asChild variant="ghost" size="sm"><a href={connectHref}>Reconnect</a></Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDisconnectOpen(true)}><Unplug /> Disconnect</Button>
              </div>
            ) : null}
            {pages && c.status !== "pending_page" ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button
                      disabled={pending || p.id === c.page_id}
                      onClick={async () => {
                        if (await confirm({ title: `Switch to “${p.name}”?`, description: `Posts synced from ${c.page_name} will be removed from this project.`, confirmLabel: "Switch Page", destructive: true })) run(() => selectMetaPageAction(projectId, p.id), () => setPages(null));
                      }}
                      className={cn("w-full rounded-lg border p-3 text-left text-[13px] hover:bg-accent disabled:opacity-60", p.id === c.page_id && "border-primary/50")}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{p.instagram ? `@${p.instagram}` : "no Instagram"}{p.id === c.page_id ? " · current" : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect Meta?</DialogTitle>
              <DialogDescription>
                The access tokens are deleted from this service immediately and synchronization stops. To revoke the app entirely, also remove it in Facebook → Settings → Apps and websites.
              </DialogDescription>
            </DialogHeader>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={deletePosts} onChange={(e) => setDeletePosts(e.target.checked)} className="accent-[var(--destructive)]" />
              Also delete the {counts.facebook + counts.instagram} posts synced from Meta
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisconnectOpen(false)}>Cancel</Button>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => disconnectMetaAction(projectId, deletePosts), () => setDisconnectOpen(false))}>
                Disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function Account({ icon: Icon, title, subtitle, ok }: { icon: typeof Facebook; title: string; subtitle: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">{title} {ok ? <CheckCircle2 className="size-3.5 text-success" /> : null}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0 space-y-0.5">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="font-medium text-foreground">{value}</dd>
  </div>
);

const SURFACES: Record<string, string> = {
  facebook: "Facebook posts", facebook_video: "Facebook videos", instagram_FEED: "Instagram feed posts", instagram_REELS: "Instagram reels",
};

function SupportedMetrics({ supported }: { supported: MetaConnection["supported_metrics"] }) {
  const entries = Object.entries(supported ?? {}).filter(([, v]) => v && (v.ok.length || v.rejected.length));
  if (!entries.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Metrics Meta returns for this account</summary>
      <ul className="mt-2 space-y-1">
        {entries.map(([surface, v]) => (
          <li key={surface}>
            <span className="font-medium">{SURFACES[surface] ?? surface}:</span> {v!.ok.join(", ") || "none"}
            {v!.rejected.length ? <span className="text-muted-foreground"> · not available: {v!.rejected.join(", ")}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

const RUN_VARIANT: Record<MetaSyncRun["status"], "success" | "warning" | "destructive" | "secondary"> = { succeeded: "success", partial: "warning", failed: "destructive", running: "secondary" };

function SyncLog({ runs }: { runs: MetaSyncRun[] }) {
  if (!runs.length) return <p className="text-xs text-muted-foreground">No synchronization yet.</p>;
  return (
    <details className="text-xs" open={runs[0].status !== "succeeded"}>
      <summary className="cursor-pointer text-muted-foreground">Synchronization log</summary>
      <ul className="mt-2 space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={RUN_VARIANT[r.status]}>{r.status === "running" ? <Loader2 className="animate-spin" /> : null}{r.status}</Badge>
              <span>{r.kind} · {r.trigger}</span>
              <span className="text-muted-foreground">{formatDateTime(r.started_at)}{r.finished_at ? ` · ${Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)}s` : ""}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {(["facebook", "instagram"] as const).map((p) => r.stats?.[p] ? `${p === "facebook" ? "Facebook" : "Instagram"}: ${r.stats[p]!.fetched} read, ${r.stats[p]!.created} new, ${r.stats[p]!.updated} updated, ${r.stats[p]!.metrics} with insights` : null).filter(Boolean).join(" · ")}
              {r.stats?.api_calls ? ` · ${r.stats.api_calls} API calls` : ""}
              {r.stats?.truncated ? " · limit reached, continues next run" : ""}
            </p>
            {r.status === "running" && (r.stats as { step?: string })?.step ? <p className="mt-1">Now: {(r.stats as { step?: string }).step}…</p> : null}
            {r.errors?.map((e, k) => <p key={k} className="text-destructive">{e.platform}: {e.message}</p>)}
          </li>
        ))}
      </ul>
    </details>
  );
}
