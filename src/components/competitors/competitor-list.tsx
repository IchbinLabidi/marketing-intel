"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil, Plus, RefreshCcw, Swords, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { collectCompetitorAction, deleteCompetitorAction } from "@/server/actions/competitors";
import type { Competitor } from "@/server/services/competitors";
import { CompetitorForm, type ProviderStatus } from "./competitor-form";
import { ago, fmt, StatusBadge } from "./ui";

/**
 * Refreshes the page every few seconds while a collection runs, so statuses update without a manual reload.
 * `kick()` also polls for 90 s after starting one: the run begins after the response, so the first render can
 * still show the previous status.
 */
export function useLivePolling(active: boolean) {
  const router = useRouter();
  const [kicked, setKicked] = React.useState(false);
  React.useEffect(() => {
    if (!kicked) return;
    const t = setTimeout(() => setKicked(false), 90_000);
    return () => clearTimeout(t);
  }, [kicked]);
  React.useEffect(() => {
    if (!active && !kicked) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, kicked, router]);
  return () => setKicked(true);
}

export function CompetitorList({ projectId, competitors, providers, readOnly }: { projectId: string; competitors: Competitor[]; providers: ProviderStatus; readOnly: boolean }) {
  const [editing, setEditing] = React.useState<Competitor | "new" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const kick = useLivePolling(competitors.some((c) => c.sync_status === "synchronizing" || c.competitor_channels.some((ch) => ch.status === "synchronizing")));

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, poll = false) => {
    setBusy(id);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error); else { if (r.message) toast.success(r.message); if (poll) kick(); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{competitors.length} competitor{competitors.length === 1 ? "" : "s"} · {competitors.reduce((t, c) => t + c.competitor_channels.reduce((s, ch) => s + ch.posts_collected, 0), 0)} posts collected</p>
        {!readOnly ? <Button onClick={() => setEditing("new")}><Plus /> Add competitor</Button> : null}
      </div>

      {!competitors.length ? (
        <EmptyState icon={Swords} title="No competitor yet" description="Add a competitor with its Instagram, Facebook, YouTube, TikTok, LinkedIn or X links. Public posts and metrics are collected automatically where an official data source exists." action={!readOnly ? <Button onClick={() => setEditing("new")}><Plus /> Add competitor</Button> : null} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {competitors.map((c) => {
            const followers = c.competitor_channels.reduce((t, ch) => t + (ch.followers_count ?? 0), 0);
            const posts = c.competitor_channels.reduce((t, ch) => t + ch.posts_collected, 0);
            return (
              <article key={c.id} className="flex flex-col rounded-xl border bg-card shadow-xs">
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link href={`/p/${projectId}/competitors/${c.id}`} className="text-[15px] font-semibold hover:underline">{c.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[c.industry, c.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") || "No details"}</p>
                  </div>
                  <StatusBadge status={c.sync_status} />
                </div>
                <dl className="grid grid-cols-3 gap-2 border-y px-4 py-3 text-center">
                  <div><dt className="text-[11px] text-muted-foreground">Followers</dt><dd className="font-semibold tabular-nums">{followers ? fmt(followers) : "—"}</dd></div>
                  <div><dt className="text-[11px] text-muted-foreground">Posts collected</dt><dd className="font-semibold tabular-nums">{posts}</dd></div>
                  <div><dt className="text-[11px] text-muted-foreground">Last collection</dt><dd className="text-[13px] font-medium">{ago(c.last_synced_at)}</dd></div>
                </dl>
                <ul className="space-y-1.5 p-4 text-xs">
                  {c.competitor_channels.length ? c.competitor_channels.map((ch) => (
                    <li key={ch.id} className="flex items-center gap-2">
                      <PlatformIcon platform={ch.platform} className="text-muted-foreground" />
                      <a href={ch.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">{ch.display_name ?? ch.handle}</a>
                      <span className="text-muted-foreground">{ch.followers_count != null ? `${fmt(ch.followers_count)} followers` : ""}</span>
                      <StatusBadge status={ch.enabled ? ch.status : "pending"} className="ml-auto shrink-0" />
                    </li>
                  )) : <li className="text-muted-foreground">No profile yet: edit to add links.</li>}
                </ul>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t p-3">
                  <Button asChild size="sm"><Link href={`/p/${projectId}/competitors/${c.id}`}>Open dashboard</Link></Button>
                  {!readOnly ? (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null || c.sync_status === "synchronizing"} onClick={() => run(c.id, () => collectCompetitorAction(projectId, c.id), true)}>
                        {busy === c.id || c.sync_status === "synchronizing" ? <Loader2 className="animate-spin" /> : <RefreshCcw />} Collect now
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil /> Edit</Button>
                      {confirm === c.id ? (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 text-xs" role="alert">
                          Delete with its {posts} posts?
                          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run(c.id, () => deleteCompetitorAction(projectId, c.id)).then(() => setConfirm(null))}>Delete</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirm(c.id)} aria-label={`Delete ${c.name}`}><Trash2 /></Button>
                      )}
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="mb-2 text-[13px] font-semibold">Data sources</p>
        <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
          {(["instagram", "facebook", "youtube", "x", "tiktok", "linkedin"] as Platform[]).map((p) => {
            const s = providers[p];
            return (
              <li key={p} className="flex items-start gap-2">
                <PlatformIcon platform={p} className="mt-0.5 text-muted-foreground" />
                <span><b className="font-medium">{PLATFORM_LABELS[p]}</b> · {s?.ok ? <span className="text-success">automatic ({s.provider})</span> : <span className="text-muted-foreground">{s?.reason ?? "manual only"}</span>}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><ExternalLink className="size-3" /> Only official APIs are used: no scraping, no login bypass, no private data.</p>
      </section>

      {editing ? <CompetitorForm projectId={projectId} competitor={editing === "new" ? null : editing} providers={providers} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
