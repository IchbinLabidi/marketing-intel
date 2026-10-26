"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, FileImage, LayoutGrid, List, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/app/empty-state";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { engagementOfPost } from "@/lib/competitors/analysis";
import { postHistoryAction } from "@/server/actions/competitors";
import type { CompetitorPost } from "@/server/services/competitors";
import { cn } from "@/lib/utils";
import { fmt, MetricLegend } from "./ui";

type Filters = Record<"competitor" | "platform" | "format" | "from" | "to" | "q" | "min" | "sort", string>;

export function Library({ projectId, posts, total, page, size, competitors, formats, filters }: {
  projectId: string; posts: CompetitorPost[]; total: number; page: number; size: number;
  competitors: { id: string; name: string }[]; formats: string[]; filters: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [q, setQ] = React.useState(filters.q);
  const [open, setOpen] = React.useState<CompetitorPost | null>(null);
  const name = (id: string) => competitors.find((c) => c.id === id)?.name ?? "Competitor";

  const go = (patch: Partial<Filters & { page: string }>) => {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", "library");
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    if (!("page" in patch)) next.delete("page");
    start(() => router.push(`${pathname}?${next}`, { scroll: false }));
  };
  const pages = Math.max(1, Math.ceil(total / size));
  const active = Object.entries(filters).filter(([k, v]) => v && k !== "sort").length;

  return (
    <div className="space-y-4">
      <form className="grid gap-2 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
        <label className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search captions or a topic…" className="pl-8" aria-label="Search captions" />
        </label>
        <Sel label="Competitor" value={filters.competitor} onChange={(v) => go({ competitor: v })} options={competitors.map((c) => ({ value: c.id, label: c.name }))} />
        <Sel label="Platform" value={filters.platform} onChange={(v) => go({ platform: v })} options={["instagram", "facebook", "youtube", "x", "tiktok", "linkedin"].map((p) => ({ value: p, label: PLATFORM_LABELS[p as Platform] }))} />
        <Sel label="Format" value={filters.format} onChange={(v) => go({ format: v })} options={formats.map((f) => ({ value: f, label: f }))} />
        <label className="grid grid-cols-2 gap-2">
          <Input type="date" value={filters.from} onChange={(e) => go({ from: e.target.value })} aria-label="Published from" />
          <Input type="date" value={filters.to} onChange={(e) => go({ to: e.target.value })} aria-label="Published until" />
        </label>
        <Sel label="Engagement" value={filters.min} onChange={(v) => go({ min: v })} allLabel="Any likes" options={[{ value: "100", label: "100+ likes" }, { value: "1000", label: "1,000+ likes" }, { value: "10000", label: "10,000+ likes" }]} />
        <Sel label="Sort" value={filters.sort} onChange={(v) => go({ sort: v })} allLabel="Newest first" options={[{ value: "oldest", label: "Oldest first" }, { value: "likes", label: "Most likes" }, { value: "comments", label: "Most comments" }, { value: "views", label: "Most views" }]} />
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">{pending ? <Loader2 className="size-3.5 animate-spin" /> : null}{total} posts{active ? " match these filters" : ""} · page {page} of {pages}</span>
        <span className="flex items-center gap-1">
          {active ? <Button size="sm" variant="ghost" onClick={() => { setQ(""); start(() => router.push(`${pathname}?tab=library`, { scroll: false })); }}><X /> Clear filters</Button> : null}
          <Button size="icon-sm" variant={view === "grid" ? "secondary" : "ghost"} aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /></Button>
          <Button size="icon-sm" variant={view === "list" ? "secondary" : "ghost"} aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List /></Button>
        </span>
      </div>

      {!posts.length ? (
        <EmptyState icon={Search} title={total || active ? "No post matches these filters" : "No competitor post collected yet"} description={active ? undefined : "Add a competitor with an Instagram business account (or another supported profile) and its posts appear here."} />
      ) : view === "grid" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", pending && "opacity-60")}>
          {posts.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-xs transition-shadow hover:shadow-sm">
              <span className="relative aspect-square bg-muted">
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- platform CDN preview, no optimisation domain configured
                  <img src={p.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
                ) : <span className="flex size-full items-center justify-center text-muted-foreground"><FileImage className="size-6" /></span>}
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[11px]"><PlatformIcon platform={p.platform} /> {p.format ?? "Post"}</span>
              </span>
              <span className="space-y-1 p-3">
                <span className="block text-[11px] text-muted-foreground">{name(p.competitor_id)} · {p.published_at?.slice(0, 10) ?? "undated"}</span>
                <span className="line-clamp-2 text-[13px]" dir="auto">{p.hook ?? p.caption ?? "(no caption)"}</span>
                <Metrics p={p} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card shadow-xs", pending && "opacity-60")}>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">Post</th><th className="font-medium">Competitor</th><th className="font-medium">Date</th><th className="font-medium">Format</th><th className="text-right font-medium">Likes</th><th className="text-right font-medium">Comments</th><th className="text-right font-medium">Views</th><th className="pr-3 text-right font-medium">Engagement</th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => setOpen(p)}>
                  <td className="max-w-xs px-3 py-2"><span className="flex items-center gap-1.5"><PlatformIcon platform={p.platform} className="shrink-0" /><span className="truncate" dir="auto">{p.hook ?? p.caption ?? "(no caption)"}</span></span></td>
                  <td>{name(p.competitor_id)}</td><td className="tabular-nums">{p.published_at?.slice(0, 10) ?? "—"}</td><td>{p.format ?? "—"}</td>
                  <td className="text-right tabular-nums">{fmt(p.likes)}</td><td className="text-right tabular-nums">{fmt(p.comments)}</td><td className="text-right tabular-nums">{fmt(p.views)}</td>
                  <td className="pr-3 text-right tabular-nums">{fmt(engagementOfPost(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1 || pending} onClick={() => go({ page: String(page - 1) })}><ChevronLeft /> Previous</Button>
          <span className="text-xs text-muted-foreground">{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages || pending} onClick={() => go({ page: String(page + 1) })}>Next <ChevronRight /></Button>
        </div>
      ) : null}
      <MetricLegend />
      {open ? <PostDetail projectId={projectId} post={open} competitor={name(open.competitor_id)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Metrics({ p }: { p: CompetitorPost }) {
  const items = [["♥", p.likes], ["💬", p.comments], ["↻", p.shares], ["▶", p.views]] as const;
  return <span className="flex flex-wrap gap-x-2 text-[11px] tabular-nums text-muted-foreground">{items.filter(([, v]) => v != null).map(([k, v]) => <span key={k}>{k} {fmt(v)}</span>)}{items.every(([, v]) => v == null) ? <span>No public metrics</span> : null}</span>;
}

function Sel({ label, value, onChange, options, allLabel = "All" }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label === "Sort" || label === "Engagement" ? allLabel : `${label}: all`}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </NativeSelect>
  );
}

function PostDetail({ projectId, post, competitor, onClose }: { projectId: string; post: CompetitorPost; competitor: string; onClose: () => void }) {
  const [history, setHistory] = React.useState<Awaited<ReturnType<typeof postHistoryAction>> | null>(null);
  React.useEffect(() => {
    let live = true;
    postHistoryAction(projectId, post.id).then((h) => live && setHistory(h), () => live && setHistory([]));
    return () => { live = false; };
  }, [projectId, post.id]);
  const e = engagementOfPost(post);
  const rows: [string, number | null, string][] = [
    ["Likes", post.likes, "public"], ["Comments", post.comments, "public"], ["Shares", post.shares, "public"], ["Saves", post.saves, "public"], ["Views", post.views, "public"],
    ["Engagement", e, "calculated"], ["Rate per follower", e != null && post.followers_at_collection ? Math.round((e / post.followers_at_collection) * 10000) / 100 : null, "calculated, %"],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlatformIcon platform={post.platform} /> {competitor} · {post.published_at?.slice(0, 16).replace("T", " ") ?? "undated"} UTC</DialogTitle>
          <DialogDescription>{post.format ?? "Post"}{post.duration_seconds ? ` · ${post.duration_seconds}s` : ""} · collected {post.metrics_updated_at?.slice(0, 10) ?? "?"}{post.followers_at_collection ? ` · ${fmt(post.followers_at_collection)} followers then` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-2">
            {post.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- platform CDN preview
              <img src={post.thumbnail_url} alt="" className="w-full rounded-lg border object-cover" referrerPolicy="no-referrer" />
            ) : <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileImage /></div>}
            {post.url ? <Button asChild size="sm" variant="outline" className="w-full"><a href={post.url} target="_blank" rel="noreferrer"><ExternalLink /> Open the original post</a></Button> : null}
          </div>
          <div className="space-y-3 text-[13px]">
            <p className="whitespace-pre-wrap" dir="auto">{post.caption ?? "(no caption)"}</p>
            {post.hashtags.length ? <p className="text-xs text-muted-foreground">{post.hashtags.map((h) => `#${h}`).join(" ")}</p> : null}
            <table className="w-full text-xs">
              <tbody>{rows.map(([k, v, kind]) => <tr key={k} className="border-b last:border-0"><td className="py-1">{k}</td><td className="py-1 text-right tabular-nums">{v == null ? "not available" : fmt(v)}</td><td className="py-1 pl-2 text-[11px] text-muted-foreground">{v == null ? "" : kind}</td></tr>)}</tbody>
            </table>
            <div>
              <p className="mb-1 text-xs font-medium">Metric history ({history?.length ?? "…"} snapshot{history?.length === 1 ? "" : "s"})</p>
              {history?.length ? (
                <table className="w-full text-[11px] tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">Collected</th><th className="text-right font-normal">Likes</th><th className="text-right font-normal">Comments</th><th className="text-right font-normal">Views</th></tr></thead>
                  <tbody>{history.map((h) => <tr key={h.collected_at}><td>{h.collected_at.slice(0, 16).replace("T", " ")}</td><td className="text-right">{fmt(h.likes)}</td><td className="text-right">{fmt(h.comments)}</td><td className="text-right">{fmt(h.views)}</td></tr>)}</tbody></table>
              ) : history ? <p className="text-[11px] text-muted-foreground">No snapshot (added manually).</p> : <Loader2 className="size-3.5 animate-spin" />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
