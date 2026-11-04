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
import { MetricLegend, useGroupLabel, useStatsFormat } from "./ui";
import { useT } from "@/i18n/client";

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
  const { num, t } = useStatsFormat();
  const tc = useT("common");
  const label = useGroupLabel();
  const name = (id: string) => competitors.find((c) => c.id === id)?.name ?? t("library.competitor");

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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("library.searchPlaceholder")} className="pl-8" aria-label={t("library.searchLabel")} />
        </label>
        <Sel label={t("library.competitor")} value={filters.competitor} onChange={(v) => go({ competitor: v })} options={competitors.map((c) => ({ value: c.id, label: c.name }))} />
        <Sel label={t("gaps.platform")} value={filters.platform} onChange={(v) => go({ platform: v })} options={["instagram", "facebook", "youtube", "x", "tiktok", "linkedin"].map((p) => ({ value: p, label: PLATFORM_LABELS[p as Platform] }))} />
        <Sel label={t("manual.format")} value={filters.format} onChange={(v) => go({ format: v })} options={formats.map((f) => ({ value: f, label: label("format", f) }))} />
        <label className="grid grid-cols-2 gap-2">
          <Input type="date" value={filters.from} onChange={(e) => go({ from: e.target.value })} aria-label={t("library.from")} />
          <Input type="date" value={filters.to} onChange={(e) => go({ to: e.target.value })} aria-label={t("library.to")} />
        </label>
        <Sel label={t("library.engagement")} value={filters.min} onChange={(v) => go({ min: v })} allLabel={t("library.anyLikes")} options={[{ value: "100", label: t("library.minLikes", { n: 100 }) }, { value: "1000", label: t("library.minLikes", { n: 1000 }) }, { value: "10000", label: t("library.minLikes", { n: 10000 }) }]} />
        <Sel label={t("library.sort")} value={filters.sort} onChange={(v) => go({ sort: v })} allLabel={t("library.newest")} options={[{ value: "oldest", label: t("library.oldest") }, { value: "likes", label: t("library.mostLikes") }, { value: "comments", label: t("library.mostComments") }, { value: "views", label: t("library.mostViews") }]} />
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">{pending ? <Loader2 className="size-3.5 animate-spin" /> : null}{active ? t("library.totalFiltered", { count: total }) : t("library.total", { count: total })} · {t("library.page", { page, pages })}</span>
        <span className="flex items-center gap-1">
          {active ? <Button size="sm" variant="ghost" onClick={() => { setQ(""); start(() => router.push(`${pathname}?tab=library`, { scroll: false })); }}><X /> {t("library.clearFilters")}</Button> : null}
          <Button size="icon-sm" variant={view === "grid" ? "secondary" : "ghost"} aria-label={t("library.gridView")} aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /></Button>
          <Button size="icon-sm" variant={view === "list" ? "secondary" : "ghost"} aria-label={t("library.listView")} aria-pressed={view === "list"} onClick={() => setView("list")}><List /></Button>
        </span>
      </div>

      {!posts.length ? (
        <EmptyState icon={Search} title={total || active ? t("library.noMatch") : t("library.emptyTitle")} description={active ? undefined : t("library.emptyDescription")} />
      ) : view === "grid" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", pending && "opacity-60")}>
          {posts.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-xs transition-shadow hover:shadow-sm">
              <span className="relative aspect-square bg-muted">
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- platform CDN preview, no optimisation domain configured
                  <img src={p.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
                ) : <span className="flex size-full items-center justify-center text-muted-foreground"><FileImage className="size-6" /></span>}
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[11px]"><PlatformIcon platform={p.platform} /> {p.format ? label("format", p.format) : t("post")}</span>
              </span>
              <span className="space-y-1 p-3">
                <span className="block text-[11px] text-muted-foreground">{name(p.competitor_id)} · {p.published_at?.slice(0, 10) ?? t("undated")}</span>
                <span className="line-clamp-2 text-[13px]" dir="auto">{p.hook ?? p.caption ?? t("noCaption")}</span>
                <Metrics p={p} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-card shadow-xs", pending && "opacity-60")}>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">{t("post")}</th><th className="font-medium">{t("library.competitor")}</th><th className="font-medium">{t("bulk.date")}</th><th className="font-medium">{t("manual.format")}</th><th className="text-right font-medium">{t("metric.likes")}</th><th className="text-right font-medium">{t("metric.comments")}</th><th className="text-right font-medium">{t("metric.views")}</th><th className="pr-3 text-right font-medium">{t("metric.engagement")}</th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => setOpen(p)}>
                  <td className="max-w-xs px-3 py-2"><span className="flex items-center gap-1.5"><PlatformIcon platform={p.platform} className="shrink-0" /><span className="truncate" dir="auto">{p.hook ?? p.caption ?? t("noCaption")}</span></span></td>
                  <td>{name(p.competitor_id)}</td><td className="tabular-nums">{p.published_at?.slice(0, 10) ?? "—"}</td><td>{p.format ? label("format", p.format) : "—"}</td>
                  <td className="text-right tabular-nums">{num(p.likes)}</td><td className="text-right tabular-nums">{num(p.comments)}</td><td className="text-right tabular-nums">{num(p.views)}</td>
                  <td className="pr-3 text-right tabular-nums">{num(engagementOfPost(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1 || pending} onClick={() => go({ page: String(page - 1) })}><ChevronLeft /> {tc("actions.previous")}</Button>
          <span className="text-xs text-muted-foreground">{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages || pending} onClick={() => go({ page: String(page + 1) })}>{tc("actions.next")} <ChevronRight /></Button>
        </div>
      ) : null}
      <MetricLegend />
      {open ? <PostDetail projectId={projectId} post={open} competitor={name(open.competitor_id)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Metrics({ p }: { p: CompetitorPost }) {
  const { num, t } = useStatsFormat();
  const items = [["♥", p.likes], ["💬", p.comments], ["↻", p.shares], ["▶", p.views]] as const;
  return <span className="flex flex-wrap gap-x-2 text-[11px] tabular-nums text-muted-foreground">{items.filter(([, v]) => v != null).map(([k, v]) => <span key={k}>{k} {num(v)}</span>)}{items.every(([, v]) => v == null) ? <span>{t("library.noMetrics")}</span> : null}</span>;
}

function Sel({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  const t = useT("competitors");
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{allLabel ?? t("library.allOf", { label })}</option>
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
  const { num, t } = useStatsFormat();
  const label = useGroupLabel();
  const e = engagementOfPost(post);
  const rows: [string, number | null, string][] = [
    [t("metric.likes"), post.likes, t("library.public")], [t("metric.comments"), post.comments, t("library.public")], [t("metric.shares"), post.shares, t("library.public")], [t("metric.saves"), post.saves, t("library.public")], [t("metric.views"), post.views, t("library.public")],
    [t("metric.engagement"), e, t("library.calculated")], [t("library.ratePerFollower"), e != null && post.followers_at_collection ? Math.round((e / post.followers_at_collection) * 10000) / 100 : null, t("library.calculatedPct")],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlatformIcon platform={post.platform} /> {competitor} · {post.published_at ? `${post.published_at.slice(0, 16).replace("T", " ")} UTC` : `${t("undated")} UTC`}</DialogTitle>
          <DialogDescription>{post.format ? label("format", post.format) : t("post")}{post.duration_seconds ? ` · ${t("library.seconds", { n: post.duration_seconds })}` : ""} · {t("library.collected", { date: post.metrics_updated_at?.slice(0, 10) ?? "?" })}{post.followers_at_collection ? ` · ${t("library.followersThen", { count: num(post.followers_at_collection) })}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-2">
            {post.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- platform CDN preview
              <img src={post.thumbnail_url} alt="" className="w-full rounded-lg border object-cover" referrerPolicy="no-referrer" />
            ) : <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileImage /></div>}
            {post.url ? <Button asChild size="sm" variant="outline" className="w-full"><a href={post.url} target="_blank" rel="noreferrer"><ExternalLink /> {t("library.openOriginal")}</a></Button> : null}
          </div>
          <div className="space-y-3 text-[13px]">
            <p className="whitespace-pre-wrap" dir="auto">{post.caption ?? t("noCaption")}</p>
            {post.hashtags.length ? <p className="text-xs text-muted-foreground">{post.hashtags.map((h) => `#${h}`).join(" ")}</p> : null}
            <table className="w-full text-xs">
              <tbody>{rows.map(([k, v, kind]) => <tr key={k} className="border-b last:border-0"><td className="py-1">{k}</td><td className="py-1 text-right tabular-nums">{v == null ? t("notAvailable") : num(v)}</td><td className="py-1 pl-2 text-[11px] text-muted-foreground">{v == null ? "" : kind}</td></tr>)}</tbody>
            </table>
            <div>
              <p className="mb-1 text-xs font-medium">{history ? t("library.metricHistory", { count: history.length }) : t("library.metricHistoryLoading")}</p>
              {history?.length ? (
                <table className="w-full text-[11px] tabular-nums"><thead className="text-muted-foreground"><tr><th className="text-left font-normal">{t("library.collectedHeader")}</th><th className="text-right font-normal">{t("metric.likes")}</th><th className="text-right font-normal">{t("metric.comments")}</th><th className="text-right font-normal">{t("metric.views")}</th></tr></thead>
                  <tbody>{history.map((h) => <tr key={h.collected_at}><td>{h.collected_at.slice(0, 16).replace("T", " ")}</td><td className="text-right">{num(h.likes)}</td><td className="text-right">{num(h.comments)}</td><td className="text-right">{num(h.views)}</td></tr>)}</tbody></table>
              ) : history ? <p className="text-[11px] text-muted-foreground">{t("library.noSnapshot")}</p> : <Loader2 className="size-3.5 animate-spin" />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
