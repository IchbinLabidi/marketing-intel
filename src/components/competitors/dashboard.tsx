"use client";

import * as React from "react";
import { BackLink } from "@/components/app/page-header";
import { useRouter } from "next/navigation";
import { ExternalLink, FileImage, Library, Loader2, Pause, Pencil, Play, Plus, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { PLATFORM_LABELS } from "@/lib/domain/constants";
import type { Summary } from "@/lib/competitors/analysis";
import { setFacebookPageIdAction, addManualPostAction, addManualPostsAction, analyzeCompetitorAction, collectCompetitorAction, removeProfileAction, toggleProfileAction } from "@/server/actions/competitors";
import type { Competitor, CompetitorAd, CompetitorChannel, CompetitorRun } from "@/server/services/competitors";
import { CompetitorAds } from "./ads";
import { CompetitorForm, type ProviderStatus } from "./competitor-form";
import { useLivePolling } from "./competitor-list";
import { Bars, Basis, MetricLegend, StatusBadge, useGroupLabel, useStatsFormat, useWeekday } from "./ui";
import { useT } from "@/i18n/client";
import { adLibraryUrl, facebookPageId, parseBulkPosts } from "@/lib/competitors/bulk";

type Statement = { category: string; text: string; basis: "fact" | "hypothesis"; refs: string[] };
export type AnalysisReport = { id: string; created_at: string; result: { summary: string; strategy: Statement[]; performance: Statement[]; weaknesses: Statement[]; notes?: { data_limits?: string[] }; posts_analysed?: number } } | null;

export function CompetitorDashboard({ projectId, competitor, summary, followers, runs, report, postLinks, providers, readOnly, aiEnabled, ads = [] }: {
  projectId: string; competitor: Competitor; summary: Summary; followers: { channel_id: string; collected_at: string; followers: number | null }[];
  runs: CompetitorRun[]; report: AnalysisReport; postLinks: Record<string, { url: string | null; hook: string | null }>;
  providers: ProviderStatus; readOnly: boolean; aiEnabled: boolean; ads?: CompetitorAd[];
}) {
  const router = useRouter();
  const { num, ago, t, fmt } = useStatsFormat();
  const tc = useT("common");
  const label = useGroupLabel();
  const weekday = useWeekday();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState(false);
  const [manual, setManual] = React.useState<CompetitorChannel | null>(null);
  const [remove, setRemove] = React.useState<string | null>(null);
  const channels = competitor.competitor_channels;
  const kick = useLivePolling(competitor.sync_status === "synchronizing" || channels.some((c) => c.status === "synchronizing"));
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error); else { if (r.message) toast.success(r.message); router.refresh(); if (key === "collect") kick(); }
  };
  const totalFollowers = channels.reduce((n, c) => n + (c.followers_count ?? 0), 0);
  const posts = channels.reduce((n, c) => n + c.posts_collected, 0);
  const growth = (id: string) => {
    const h = followers.filter((f) => f.channel_id === id && f.followers != null);
    return h.length >= 2 ? h.at(-1)!.followers! - h[0].followers! : null;
  };
  const link = (id: string) => postLinks[id];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackLink href={`/p/${projectId}/competitors`}>{t("title")}</BackLink>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{competitor.name}</h1>
          <p className="text-[13px] text-muted-foreground">{[competitor.industry, competitor.target_audience && t("dashboard.audience", { audience: competitor.target_audience })].filter(Boolean).join(" · ") || t("dashboard.noDetails")}</p>
          {competitor.website ? <a href={competitor.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{competitor.website.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" /></a> : null}
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> {tc("actions.edit")}</Button>
            <Button variant="outline" disabled={busy !== null || competitor.sync_status === "synchronizing"} onClick={() => run("collect", () => collectCompetitorAction(projectId, competitor.id))}>
              {busy === "collect" || competitor.sync_status === "synchronizing" ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {t("collectNow")}
            </Button>
            <Button disabled={busy !== null || !aiEnabled || summary.posts < 5} title={!aiEnabled ? t("aiDisabled") : summary.posts < 5 ? t("dashboard.needFivePosts") : undefined} onClick={() => run("ai", () => analyzeCompetitorAction(projectId, competitor.id))}>
              {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === "ai" ? t("dashboard.analysing") : t("dashboard.analyze")}
            </Button>
          </div>
        ) : null}
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("dashboard.stats.followers")} value={totalFollowers ? num(totalFollowers) : "—"} hint={t("dashboard.stats.followersHint", { n: channels.filter((c) => c.followers_count != null).length, total: channels.length })} />
        <Stat label={t("dashboard.stats.posts")} value={fmt.number(posts)} hint={summary.firstDate ? t("dashboard.stats.since", { date: summary.firstDate.slice(0, 10) }) : t("dashboard.stats.noneYet")} />
        <Stat label={t("dashboard.stats.perWeek")} value={summary.perWeek != null && summary.posts ? fmt.number(summary.perWeek) : "—"} hint={t("dashboard.stats.overLast", { count: competitor.history_days })} />
        <Stat label={t("dashboard.stats.mostActive")} value={summary.byPlatform[0] ? PLATFORM_LABELS[summary.byPlatform[0].key as keyof typeof PLATFORM_LABELS] ?? summary.byPlatform[0].key : "—"} hint={summary.byPlatform[0] ? t("dashboard.stats.shareOfPosts", { share: summary.byPlatform[0].share }) : ""} />
        <Stat label={t("list.lastCollection")} value={ago(competitor.last_synced_at)} hint={competitor.monitoring === "manual" ? t("form.manualOnly") : competitor.monitoring === "daily" ? t("dashboard.stats.monitoredDaily") : t("dashboard.stats.monitoredWeekly")} className="col-span-2 md:col-span-1" />
      </section>

      <section className="rounded-xl border bg-card shadow-xs">
        <p className="border-b px-4 py-3 text-[13px] font-semibold">{t("form.socialProfiles")}</p>
        <ul className="divide-y">
          {channels.map((c) => (
            <li key={c.id} className="grid gap-2 px-4 py-3 text-[13px] md:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 gap-3">
                {c.profile_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- platform CDN avatar
                  <img src={c.profile_image_url} alt="" className="size-10 shrink-0 rounded-full border object-cover" referrerPolicy="no-referrer" />
                ) : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><PlatformIcon platform={c.platform} /></span>}
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2"><a href={c.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:underline">{c.display_name ?? c.handle}</a><span className="text-xs text-muted-foreground">{PLATFORM_LABELS[c.platform]} · {c.handle}</span><StatusBadge status={c.enabled ? c.status : "pending"} /></p>
                  <p className="text-xs text-muted-foreground">
                    {c.followers_count != null ? `${t("list.followersCount", { count: num(c.followers_count) })}${growth(c.id) ? ` ${t("dashboard.growth", { delta: `${growth(c.id)! > 0 ? "+" : ""}${num(growth(c.id))}` })}` : ""}` : t("dashboard.followersNA")} · {t("dashboard.posts", { count: c.posts_collected })}
                    {c.coverage_from ? ` · ${t("dashboard.covers", { from: c.coverage_from.slice(0, 10), to: c.coverage_to?.slice(0, 10) })}` : ""} · {t("dashboard.last", { when: ago(c.last_synced_at) })}
                  </p>
                  {c.last_error ? <p className="text-xs text-warning">{c.last_error}</p> : null}
                  {!c.enabled ? <p className="text-xs text-muted-foreground">{t("dashboard.paused")}</p> : null}
                  {c.bio ? <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{c.bio}</p> : null}
                </div>
              </div>
              {c.platform === "facebook" || !readOnly ? (
                <div className="flex flex-wrap items-center gap-1 md:justify-end">
                  {c.platform === "facebook" ? <AdLibraryButton projectId={projectId} channel={c} name={competitor.name} readOnly={readOnly} /> : null}
                  {readOnly ? null : <>
                  {!providers[c.platform]?.ok || c.status === "unsupported" || c.status === "needs_config" ? <Button size="sm" variant="outline" onClick={() => setManual(c)}><Plus /> {t("manual.title")}</Button> : null}
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(c.id, () => toggleProfileAction(projectId, c.id, !c.enabled))}>{c.enabled ? <><Pause /> {t("dashboard.pause")}</> : <><Play /> {t("dashboard.resume")}</>}</Button>
                  {remove === c.id ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 text-xs" role="alert">{t("dashboard.confirmRemove", { count: c.posts_collected })}
                      <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run(c.id, () => removeProfileAction(projectId, c.id)).then(() => setRemove(null))}>{tc("actions.remove")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemove(null)}>{tc("actions.cancel")}</Button>
                    </span>
                  ) : <Button size="sm" variant="ghost" className="text-destructive" aria-label={t("dashboard.removeProfile")} onClick={() => setRemove(c.id)}><Trash2 /></Button>}
                  </>}
                </div>
              ) : null}
            </li>
          ))}
          {!channels.length ? <li className="px-4 py-3 text-[13px] text-muted-foreground">{t("dashboard.noProfile")}</li> : null}
        </ul>
      </section>

      <CompetitorAds
        projectId={projectId} competitorId={competitor.id} ads={ads} readOnly={readOnly}
        adLibraryHref={(() => { const fb = channels.find((c) => c.platform === "facebook" && facebookPageId(c)); return fb ? adLibraryUrl(fb) : null; })()}
      />

      {summary.posts ? (
        <>
          <section className="space-y-2">
            <h2 className="text-[15px] font-semibold">{t("dashboard.best")} <span className="text-xs font-normal text-muted-foreground">· {t("dashboard.bestHint")}</span></h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {summary.best.slice(0, 5).map((b) => (
                <a key={b.id} href={b.url ?? "#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border bg-card shadow-xs hover:shadow-sm">
                  <span className="block aspect-square bg-muted">
                    {b.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- platform CDN preview
                      <img src={b.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="no-referrer" />
                    ) : <span className="flex size-full items-center justify-center text-muted-foreground"><FileImage /></span>}
                  </span>
                  <span className="block space-y-0.5 p-2 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground"><PlatformIcon platform={b.platform} /> {b.format ? label("format", b.format) : t("post")} · {b.published_at?.slice(0, 10)}</span>
                    <span className="line-clamp-2" dir="auto">{b.hook || t("noCaption")}</span>
                    <span className="block font-medium tabular-nums">{t("lift", { value: b.lift })} · {t("dashboard.interactions", { count: num(b.engagement) })}{b.rate != null ? ` · ${t("dashboard.ratePerFollower", { rate: b.rate })}` : ""}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("dashboard.panels.formatsLift")}><Bars rows={summary.byFormat.map((f) => ({ label: label("format", f.label), value: f.medianLift ?? 0, right: `${t("lift", { value: f.medianLift ?? "?" })} · ${fmt.number(f.n)}`, hint: t("dashboard.stats.shareOfPosts", { share: f.share }) }))} /></Panel>
            <Panel title={t("dashboard.panels.formatShare")}><Bars rows={summary.byFormat.map((f) => ({ label: label("format", f.label), value: f.share, right: t("percent", { value: f.share }) }))} max={100} /></Panel>
            <Panel title={t("dashboard.panels.platformShare")}><Bars rows={summary.byPlatform.map((f) => ({ label: PLATFORM_LABELS[f.key as keyof typeof PLATFORM_LABELS] ?? f.key, value: f.share, right: t("percent", { value: f.share }) }))} max={100} /></Panel>
            <Panel title={t("dashboard.panels.themes")}><Bars rows={summary.topics.slice(0, 10).map((x) => ({ label: x.label, value: x.n, right: `${fmt.number(x.n)} · ${t("lift", { value: x.medianLift ?? "?" })}` }))} /></Panel>
            <Panel title={t("dashboard.panels.hashtags")}><Bars rows={summary.hashtags.slice(0, 10).map((x) => ({ label: `#${x.label}`, value: x.n, right: `${fmt.number(x.n)} · ${t("lift", { value: x.medianLift ?? "?" })}` }))} empty={t("dashboard.noHashtag")} /></Panel>
            <Panel title={t("dashboard.panels.days")}><Bars rows={[...summary.byWeekday].sort((a, b) => Number(a.key) - Number(b.key)).map((d) => ({ label: weekday(d.key), value: d.share, right: t("percent", { value: d.share }) }))} max={40} /></Panel>
            <Panel title={t("dashboard.panels.hooks")}><Bars rows={summary.hooks.map((h) => ({ label: label("hook", h.label), value: h.medianLift ?? 0, right: `${t("lift", { value: h.medianLift ?? "?" })} · ${fmt.number(h.n)}` }))} /></Panel>
            <Panel title={t("dashboard.panels.ctas")}><Bars rows={summary.ctas.map((h) => ({ label: label("cta", h.label), value: h.medianLift ?? 0, right: `${t("lift", { value: h.medianLift ?? "?" })} · ${fmt.number(h.n)}` }))} /></Panel>
            <Panel title={t("dashboard.panels.metrics")}>
              <ul className="space-y-1 text-xs">{summary.metrics.map((m) => <li key={m.metric} className="flex justify-between"><span>{t(`metric.${m.metric}`)}</span><span className="tabular-nums text-muted-foreground">{m.posts ? t("dashboard.metricCoverage", { n: m.posts, total: summary.posts }) : t("notAvailable")}</span></li>)}</ul>
            </Panel>
          </div>
          <MetricLegend />
        </>
      ) : <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">{t("dashboard.noPosts")}</p>}

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{t("dashboard.aiAnalysis")}</h2>
          {report ? <span className="text-xs text-muted-foreground">{fmt.dateTime(report.created_at)} · {report.result.posts_analysed != null ? t("dashboard.postsAnalysed", { count: report.result.posts_analysed }) : t("dashboard.postsAnalysedUnknown")}</span> : null}
        </div>
        {report ? (
          <div className="space-y-4 text-[13px]">
            <p>{report.result.summary}</p>
            {([[t("dashboard.sections.strategy"), report.result.strategy], [t("dashboard.sections.performance"), report.result.performance], [t("dashboard.sections.weaknesses"), report.result.weaknesses]] as const).map(([title, list]) => (
              <div key={title}>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</p>
                <ul className="space-y-2">
                  {list.map((s, k) => (
                    <li key={k} className="rounded-lg border p-2.5">
                      <p className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><Basis basis={s.basis} /><span className="capitalize">{t.has(`category.${s.category}`) ? t(`category.${s.category}` as Parameters<typeof t>[0]) : s.category.replaceAll("_", " ")}</span></p>
                      <p dir="auto">{s.text}</p>
                      {s.refs.length ? <p className="mt-1 flex flex-wrap gap-x-3 text-xs">{s.refs.slice(0, 4).map((id) => link(id)?.url ? <a key={id} href={link(id)!.url!} target="_blank" rel="noreferrer" className="inline-flex max-w-[16rem] items-center gap-1 text-primary hover:underline"><span className="truncate" dir="auto">{link(id)!.hook ?? t("postLower")}</span><ExternalLink className="size-3 shrink-0" /></a> : null)}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {report.result.notes?.data_limits?.length ? <p className="text-[11px] text-muted-foreground">{t("dataLimits", { limits: report.result.notes.data_limits.join(" · ") })}</p> : null}
          </div>
        ) : <p className="text-[13px] text-muted-foreground">{t("dashboard.aiEmpty")}</p>}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="mb-2 text-[13px] font-semibold">{t("dashboard.history")}</p>
        {runs.length ? (
          <ul className="space-y-1.5 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <StatusBadge status={r.status === "running" ? "synchronizing" : r.status === "succeeded" ? "synchronized" : r.status} />
                <span className="text-muted-foreground">{fmt.dateTime(r.started_at)} · {t.has(`trigger.${r.trigger}`) ? t(`trigger.${r.trigger}` as Parameters<typeof t>[0]) : r.trigger}{r.stats?.calls ? ` · ${t("dashboard.apiCalls", { count: r.stats.calls })}` : ""}</span>
                <span className="w-full text-muted-foreground md:w-auto">{(r.stats?.outcomes ?? []).map((o) => `${PLATFORM_LABELS[o.platform as keyof typeof PLATFORM_LABELS] ?? o.platform}: ${t("dashboard.posts", { count: o.posts })}`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{t("dashboard.noCollection")}</p>}
      </section>

      {edit ? <CompetitorForm projectId={projectId} competitor={competitor} providers={providers} onClose={() => setEdit(false)} /> : null}
      {manual ? <ManualPost projectId={projectId} channel={manual} onClose={() => setManual(null)} /> : null}
    </div>
  );
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint: string; className?: string }) {
  return <div className={`rounded-xl border bg-card p-3 shadow-xs ${className ?? ""}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{hint}</p></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 rounded-xl border bg-card p-4 shadow-xs"><p className="text-[13px] font-semibold">{title}</p>{children}</section>;
}

function ManualPost({ projectId, channel, onClose }: { projectId: string; channel: CompetitorChannel; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = React.useState({ url: "", published_at: "", caption: "", format: "", likes: "", comments: "", shares: "", views: "" });
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"one" | "many">("many");
  const t = useT("competitors");
  const tc = useT("common");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PlatformIcon platform={channel.platform} /> {t("manual.title")}</DialogTitle>
          <DialogDescription>{t("manual.description")}</DialogDescription>
        </DialogHeader>
        <div role="tablist" className="inline-flex w-fit gap-0.5 rounded-md bg-secondary p-0.5">
          {(["many", "one"] as const).map((m) => (
            <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`h-7 rounded-[5px] px-2.5 text-[13px] font-medium ${mode === m ? "bg-card shadow-xs" : "text-muted-foreground"}`}>
              {m === "many" ? t("manual.several") : t("manual.one")}
            </button>
          ))}
        </div>
        {mode === "many" ? <BulkPosts projectId={projectId} channel={channel} onDone={() => { onClose(); router.refresh(); }} /> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("manual.postLink")}<Input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></label>
          <label className="grid gap-1 text-xs font-medium">{t("manual.published")}<Input type="date" value={f.published_at} onChange={(e) => set("published_at", e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">{t("manual.format")}<Input value={f.format} onChange={(e) => set("format", e.target.value)} placeholder={t("manual.formatPlaceholder")} /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("manual.caption")}<Textarea rows={3} value={f.caption} onChange={(e) => set("caption", e.target.value)} dir="auto" /></label>
          {(["likes", "comments", "shares", "views"] as const).map((k) => <label key={k} className="grid gap-1 text-xs font-medium">{t(`metric.${k}`)}<Input inputMode="numeric" value={f[k]} onChange={(e) => set(k, e.target.value.replace(/\D/g, ""))} /></label>)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button>
          <Button disabled={busy || !f.url || !f.published_at} onClick={async () => {
            setBusy(true);
            const r = await addManualPostAction(projectId, { ...f, channel_id: channel.id });
            setBusy(false);
            if (!r.ok) return toast.error(Object.values(r.fieldErrors ?? {})[0] ?? r.error);
            toast.success(r.message);
            onClose();
            router.refresh();
          }}>{busy ? <Loader2 className="animate-spin" /> : null} {t("manual.addPost")}</Button>
        </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

const todayLocal = () => new Date().toLocaleDateString("en-CA");

/** Paste one post per line (from a spreadsheet or typed), check the preview, import the valid lines. */
function BulkPosts({ projectId, channel, onDone }: { projectId: string; channel: CompetitorChannel; onDone: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const t = useT("competitors");
  const { fmt } = useStatsFormat();
  const rows = React.useMemo(() => parseBulkPosts(text, todayLocal(), t), [text, t]);
  const valid = rows.filter((r) => !r.error);
  const n = (v: number | null) => (v == null ? "—" : fmt.number(v));
  return (
    <div className="space-y-3">
      <label className="grid gap-1 text-xs font-medium">
        {t("bulk.label")}
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} dir="auto" className="font-mono text-xs"
          placeholder={t("bulk.placeholder")} />
      </label>
      <p className="text-xs text-muted-foreground">{t("bulk.hint")}{channel.platform === "facebook" ? ` ${t("bulk.facebookViews")}` : ""}</p>
      {rows.length ? (
        <div className="max-h-56 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead><tr><th className="text-left">{t("bulk.line")}</th><th className="text-left">{t("bulk.date")}</th><th className="text-right">{t("metric.likes")}</th><th className="text-right">{t("metric.comments")}</th><th className="text-right">{t("metric.shares")}</th><th className="text-right">{t("metric.views")}</th><th className="text-left">{t("bulk.status")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="tabular-nums">{r.line}</td>
                  <td className="tabular-nums">{r.published_at ?? "—"}</td>
                  <td className="text-right tabular-nums">{n(r.likes)}</td>
                  <td className="text-right tabular-nums">{n(r.comments)}</td>
                  <td className="text-right tabular-nums">{n(r.shares)}</td>
                  <td className="text-right tabular-nums">{n(r.views)}</td>
                  <td className={r.error ? "text-destructive" : "text-success"}>{r.error ?? t("bulk.ready")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <DialogFooter>
        <Button disabled={busy || !valid.length} onClick={async () => {
          setBusy(true);
          const r = await addManualPostsAction(projectId, channel.id, valid.map((v) => ({ line: v.line, url: v.url, published_at: v.published_at, caption: v.caption, likes: v.likes, comments: v.comments, shares: v.shares, views: v.views })));
          setBusy(false);
          if (!r.ok) return toast.error(r.error);
          if (r.data?.errors.length) toast.warning(t("bulk.skipped", { message: r.message ?? "", lines: r.data.errors.map((e) => t("bulk.lineError", { line: e.line, error: e.error })).join(", ") }));
          else toast.success(r.message);
          onDone();
        }}>{busy ? <Loader2 className="animate-spin" /> : null} {valid.length ? t("bulk.importN", { count: valid.length }) : t("bulk.import")}</Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Meta's public Ad Library for a competitor's Facebook Page. With the Page id it opens their ads directly; without it,
 * it opens a search and asks once for the Page's Ad Library address (Meta's search box suggests the advertiser).
 */
function AdLibraryButton({ projectId, channel, name, readOnly }: { projectId: string; channel: CompetitorChannel; name: string; readOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const t = useT("competitors");
  const tc = useT("common");
  if (facebookPageId(channel) && !open) {
    return (
      <>
        <Button asChild size="sm" variant="outline" title={t("adLibrary.openHelp")}>
          <a href={adLibraryUrl(channel)} target="_blank" rel="noreferrer"><Library /> {t("adLibrary.ads")}</a>
        </Button>
        {readOnly ? null : <Button size="sm" variant="ghost" title={t("adLibrary.changeHelp")} onClick={() => setOpen(true)}>{t("adLibrary.change")}</Button>}
      </>
    );
  }
  const search = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=all&search_type=keyword_unordered&q=${encodeURIComponent(channel.display_name || name)}`;
  if (readOnly) return <Button asChild size="sm" variant="outline"><a href={search} target="_blank" rel="noreferrer"><Library /> {t("adLibrary.search")}</a></Button>;
  return open ? (
    <span className="flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 p-2 text-xs md:w-auto">
      <span className="basis-full text-muted-foreground">{t.rich("adLibrary.steps", { link: (c) => <a href={search} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{c}</a> })}</span>
      <Input className="h-8 w-72 max-w-full text-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://www.facebook.com/ads/library/?…view_all_page_id=…" aria-label={t("adLibrary.addressLabel")} />
      <Button size="sm" disabled={busy || !value.trim()} onClick={async () => {
        setBusy(true);
        const r = await setFacebookPageIdAction(projectId, channel.id, value);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(r.message);
        setOpen(false);
        router.refresh();
      }}>{t("adLibrary.link")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
    </span>
  ) : <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Library /> {t("adLibrary.linkButton")}</Button>;
}
