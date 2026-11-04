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
import { confirm } from "@/components/ui/confirm";
import { useFormatter, useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";
import type { Formatter } from "@/i18n/format";

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

const ERRORS = ["not_configured", "denied", "state", "oauth", "exchange", "read_only"] as const;
type ErrorCode = (typeof ERRORS)[number];

export function MetaConnectionPanel(props: Props) {
  const { projectId, configured, missing, connection: c, runs, counts, readOnly, flash, backgroundSync, initialPages, pagesError } = props;
  const router = useRouter();
  const t = useT("history");
  const tc = useT("common");
  const formatter = useFormatter();
  const fmt = (d: string | null | undefined) => (d ? formatter.dateTime(d) : t("meta.never"));
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
    if (flash.error) toast.error(`${(ERRORS as readonly string[]).includes(flash.error) ? t(`meta.errors.${flash.error as ErrorCode}`) : t("meta.errors.generic")}${flash.message ? ` ${flash.message}` : ""}`);
    else if (flash.meta === "reconnected") toast.success(t("meta.reconnected"));
  }, [flash.error, flash.meta, flash.message, t]);

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
            {t("meta.description")}
          </CardDescription>
        </div>
        {connected && !readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || running || c.status !== "active"} onClick={() => run(() => syncMetaAction(projectId, "incremental"))}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {running ? t("meta.syncing") : t("meta.syncNow")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending || running || c.status !== "active"} onClick={() => run(() => syncMetaAction(projectId, "refresh"))} title={t("meta.refreshAllHint")}>
              {t("meta.refreshAll")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
            <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warning" /> {t("meta.setupRequired")}</p>
            <p className="mt-1 text-xs">
              {t.rich("meta.setupHint", {
                vars: () => missing.map((m) => <code key={m} className="mx-0.5 rounded bg-background px-1">{m}</code>),
                doc: (d) => <code className="rounded bg-background px-1">{d}</code>,
              })}
            </p>
          </div>
        ) : null}

        {(!c || c.status === "disconnected") && configured ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">
              {t("meta.connectHint")}
            </p>
            {!readOnly ? (
              <Button asChild>
                <a href={connectHref}><Facebook /> {t("meta.connect")}</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {c?.status === "pending_page" ? (
          <div className="space-y-3">
            <p className="text-[13px]">{t.rich("meta.choosePage", { name: c.fb_user_name ?? "", b: (x) => <span className="font-medium">{x}</span> })}</p>
            {pagesError ? <p className="text-xs text-destructive">{pagesError}</p> : null}
            {pages && !pages.length ? (
              <p className="text-xs text-warning">{t("meta.noPages")}</p>
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
                        {p.instagram ? <>Instagram: @{p.instagram}</> : t("meta.noInstagramLinked")}
                      </span>
                      {!p.canAnalyze ? <span className="block text-xs text-warning">{t("meta.cannotAnalyze")}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!readOnly ? <Button asChild variant="ghost" size="sm"><a href={connectHref}>{t("meta.otherAccount")}</a></Button> : null}
          </div>
        ) : null}

        {connected ? (
          <>
            {c.status !== "active" ? (
              <Alert
                variant="destructive"
                title={c.status === "expired" ? t("meta.expired") : t("meta.connectionError")}
                action={!readOnly ? <Button asChild size="sm"><a href={connectHref}>{t("meta.reconnectMeta")}</a></Button> : null}
              >
                {c.last_error}
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Account icon={Facebook} title={c.page_name ?? t("meta.facebookPage")} subtitle={t("meta.pageSynced", { count: counts.facebook })} ok={c.status === "active"} />
              <Account
                icon={Instagram}
                title={c.ig_username ? `@${c.ig_username}` : t("meta.noInstagram")}
                subtitle={c.ig_user_id ? t("meta.igSynced", { count: counts.instagram }) : t("meta.linkInstagram")}
                ok={Boolean(c.ig_user_id) && c.status === "active"}
              />
            </div>
            <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Row label={t("meta.lastSync")} value={`${fmt(c.last_sync_at)}${c.last_sync_status ? ` · ${runStatus(t, c.last_sync_status)}` : ""}`} />
              <Row label={t("meta.connectedAs")} value={c.fb_user_name ?? "—"} />
              <Row label={t("meta.tokenValid")} value={c.token_expires_at ? formatter.date(c.token_expires_at) : t("meta.noExpiry")} />
              <Row
                label={t("meta.autoSync")}
                value={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {c.auto_sync ? t("meta.daily") : t("meta.off")}
                    {!readOnly ? (
                      <button className="text-primary underline-offset-4 hover:underline" disabled={pending} onClick={() => run(() => setMetaAutoSyncAction(projectId, !c.auto_sync))}>
                        {c.auto_sync ? t("meta.turnOff") : t("meta.turnOn")}
                      </button>
                    ) : null}
                    {c.auto_sync && !backgroundSync ? <span className="basis-full text-muted-foreground">{t("meta.noScheduler")}</span> : null}
                  </span>
                }
              />
            </dl>
            {c.declined_scopes.length ? (
              <p className="text-xs text-warning">{t("meta.declined", { scopes: c.declined_scopes.join(", ") })}</p>
            ) : null}
            <SupportedMetrics t={t} supported={c.supported_metrics} />
            <SyncLog t={t} fmt={formatter} runs={runs} />
            {!readOnly ? (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => { void loadPages(); }}>{loadingPages ? <Loader2 className="animate-spin" /> : null} {t("meta.changePage")}</Button>
                <Button asChild variant="ghost" size="sm"><a href={connectHref}>{t("meta.reconnect")}</a></Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDisconnectOpen(true)}><Unplug /> {tc("actions.disconnect")}</Button>
              </div>
            ) : null}
            {pages && c.status !== "pending_page" ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {pages.map((p) => (
                  <li key={p.id}>
                    <button
                      // The current Page can be picked again when its Instagram link changed in Meta (e.g. an account was linked
                      // after connecting): that refreshes the link without touching synced posts.
                      disabled={pending || (p.id === c.page_id && (p.instagram ?? null) === (c.ig_username ?? null))}
                      onClick={async () => {
                        if (p.id === c.page_id) return run(() => selectMetaPageAction(projectId, p.id), () => setPages(null));
                        if (await confirm({ title: t("meta.switchTitle", { name: p.name }), description: t("meta.switchDescription", { page: c.page_name ?? "" }), confirmLabel: t("meta.switchPage"), destructive: true })) run(() => selectMetaPageAction(projectId, p.id), () => setPages(null));
                      }}
                      className={cn("w-full rounded-lg border p-3 text-left text-[13px] hover:bg-accent disabled:opacity-60", p.id === c.page_id && "border-primary/50")}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{p.instagram ? `@${p.instagram}` : t("meta.noInstagramShort")}{p.id === c.page_id ? ((p.instagram ?? null) !== (c.ig_username ?? null) ? t("meta.currentUpdate") : t("meta.current")) : ""}</span>
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
              <DialogTitle>{t("meta.disconnectTitle")}</DialogTitle>
              <DialogDescription>
                {t("meta.disconnectDescription")}
              </DialogDescription>
            </DialogHeader>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={deletePosts} onChange={(e) => setDeletePosts(e.target.checked)} className="accent-[var(--destructive)]" />
              {t("meta.deletePosts", { count: counts.facebook + counts.instagram })}
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisconnectOpen(false)}>{tc("actions.cancel")}</Button>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => disconnectMetaAction(projectId, deletePosts), () => setDisconnectOpen(false))}>
                {tc("actions.disconnect")}
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

const SURFACES = ["facebook", "facebook_video", "instagram_FEED", "instagram_REELS"] as const;

const RUN_STATUSES = ["running", "succeeded", "partial", "failed"] as const;
/** Translated run status; unknown stored values are shown as they are. */
const runStatus = (t: TFor<"history">, s: string) => ((RUN_STATUSES as readonly string[]).includes(s) ? t(`meta.runStatus.${s as (typeof RUN_STATUSES)[number]}`) : s);

function SupportedMetrics({ t, supported }: { t: TFor<"history">; supported: MetaConnection["supported_metrics"] }) {
  const entries = Object.entries(supported ?? {}).filter(([, v]) => v && (v.ok.length || v.rejected.length));
  if (!entries.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{t("meta.supportedMetrics")}</summary>
      <ul className="mt-2 space-y-1">
        {entries.map(([surface, v]) => (
          <li key={surface}>
            <span className="font-medium">{(SURFACES as readonly string[]).includes(surface) ? t(`meta.surfaces.${surface as (typeof SURFACES)[number]}`) : surface}{t("meta.colon")}</span> {v!.ok.join(", ") || t("meta.noneMetrics")}
            {v!.rejected.length ? <span className="text-muted-foreground">{t("meta.notAvailable", { metrics: v!.rejected.join(", ") })}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

const RUN_VARIANT: Record<MetaSyncRun["status"], "success" | "warning" | "destructive" | "secondary"> = { succeeded: "success", partial: "warning", failed: "destructive", running: "secondary" };

function SyncLog({ t, fmt, runs }: { t: TFor<"history">; fmt: Formatter; runs: MetaSyncRun[] }) {
  if (!runs.length) return <p className="text-xs text-muted-foreground">{t("meta.noSync")}</p>;
  return (
    <details className="text-xs" open={runs[0].status !== "succeeded"}>
      <summary className="cursor-pointer text-muted-foreground">{t("meta.syncLog")}</summary>
      <ul className="mt-2 space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={RUN_VARIANT[r.status]}>{r.status === "running" ? <Loader2 className="animate-spin" /> : null}{runStatus(t, r.status)}</Badge>
              <span>{t(`meta.kind.${r.kind}`)} · {t(`meta.trigger.${r.trigger}`)}</span>
              <span className="text-muted-foreground">{fmt.dateTime(r.started_at)}{r.finished_at ? ` · ${t("meta.seconds", { count: Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000) })}` : ""}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {(["facebook", "instagram"] as const).map((p) => r.stats?.[p] ? t("meta.runStats", { platform: p === "facebook" ? "Facebook" : "Instagram", fetched: r.stats[p]!.fetched, created: r.stats[p]!.created, updated: r.stats[p]!.updated, metrics: r.stats[p]!.metrics }) : null).filter(Boolean).join(" · ")}
              {r.stats?.api_calls ? t("meta.apiCalls", { count: r.stats.api_calls }) : ""}
              {r.stats?.truncated ? t("meta.truncated") : ""}
            </p>
            {r.status === "running" && (r.stats as { step?: string })?.step ? <p className="mt-1">{t("meta.now", { step: (r.stats as { step?: string }).step })}</p> : null}
            {r.errors?.map((e, k) => <p key={k} className="text-destructive">{e.platform}: {e.message}</p>)}
          </li>
        ))}
      </ul>
    </details>
  );
}
