"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Lightbulb, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/app/empty-state";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { ConfidenceDots, ScoreMeter } from "@/components/opportunities/opportunity-card";
import { FUNNEL_STAGES, PLATFORMS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { createOpportunityFromIdeaAction, gapAnalysisAction, type StoredIdea } from "@/server/actions/competitors";
import { cn } from "@/lib/utils";
import { Basis } from "./ui";
import { useFormatter, useT } from "@/i18n/client";

export type StoredGap = {
  type: string; title: string; evidence: string; why: string; audience: string; pillar: string | null; pillar_id: string | null;
  funnel_stage: FunnelStage | null; platform: Platform | null; basis: "fact" | "hypothesis"; posts: { id: string; url: string | null; competitor: string; hook: string | null; lift: number | null }[];
};
export type GapReport = { id: string; title: string; created_at: string; scope: { period_days?: number; competitor_posts?: number; own_posts?: number }; result: { gaps: StoredGap[]; ideas: StoredIdea[]; notes?: { assumptions: string[]; data_limits: string[] } } };

const GAP_TYPES = ["they_cover_we_dont", "we_cover_they_ignore", "underrepresented_pillar", "funnel_stage", "format", "differentiation"] as const;

export function Gaps({ projectId, report, created, competitors, pillars, readOnly, aiEnabled }: {
  projectId: string; report: GapReport | null; created: Record<number, string>; competitors: { id: string; name: string; posts: number }[];
  pillars: { id: string; name: string }[]; readOnly: boolean; aiEnabled: boolean;
}) {
  const router = useRouter();
  const t = useT("competitors");
  const to = useT("opportunities");
  const td = useT("domain");
  const fmt = useFormatter();
  const [sel, setSel] = React.useState<string[]>(competitors.filter((c) => c.posts).map((c) => c.id));
  const [days, setDays] = React.useState("90");
  const [busy, setBusy] = React.useState(false);
  const [edit, setEdit] = React.useState<{ idea: StoredIdea; index: number } | null>(null);
  const pillarName = (id: string | null) => pillars.find((p) => p.id === id)?.name ?? null;

  const run = async () => {
    setBusy(true);
    const r = await gapAnalysisAction(projectId, { competitorIds: sel, days: Number(days), count: 6 });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      {!readOnly ? (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
          <span className="text-xs font-medium">{t("gaps.against")}</span>
          {competitors.map((c) => (
            <button key={c.id} type="button" aria-pressed={sel.includes(c.id)} disabled={!c.posts} title={c.posts ? t("dashboard.posts", { count: c.posts }) : t("gaps.noPost")} onClick={() => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id])} className={cn("rounded-md border px-2 py-1 text-xs disabled:opacity-40", sel.includes(c.id) ? "border-primary/50 bg-primary/10" : "text-muted-foreground hover:bg-accent")}>{c.name}</button>
          ))}
          <NativeSelect value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-36 text-[13px]" aria-label={t("period.label")}>
            <option value="30">{t("period.d30")}</option><option value="90">{t("period.d90")}</option><option value="180">{t("period.d180")}</option><option value="365">{t("period.d365")}</option>
          </NativeSelect>
          <Button size="sm" className="ml-auto" onClick={run} disabled={busy || !sel.length || !aiEnabled} title={!aiEnabled ? t("aiFeaturesDisabled") : undefined}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? t("gaps.comparing") : report ? t("gaps.runNew") : t("gaps.run")}
          </Button>
        </section>
      ) : null}

      {!report ? (
        <EmptyState icon={Lightbulb} title={t("gaps.emptyTitle")} description={t("gaps.emptyDescription")} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{report.title} · {fmt.dateTime(report.created_at)} · {t("gaps.scope", { theirs: report.scope.competitor_posts ?? "?", ours: report.scope.own_posts ?? "?" })} {t.rich("gaps.legend", { b: (c) => <b className="font-medium">{c}</b> })}</p>
          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">{t("gaps.contentGaps")}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {report.result.gaps.map((g, k) => (
                <article key={k} className="space-y-2 rounded-xl border bg-card p-4 text-[13px] shadow-xs">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{(GAP_TYPES as readonly string[]).includes(g.type) ? t(`gaps.type.${g.type as (typeof GAP_TYPES)[number]}`) : g.type}</Badge><Basis basis={g.basis} /></div>
                  <p className="font-semibold">{g.title}</p>
                  <dl className="grid gap-1 text-xs sm:grid-cols-[6.5rem_1fr]">
                    <dt className="text-muted-foreground">{t("gaps.evidence")}</dt><dd>{g.evidence}</dd>
                    <dt className="text-muted-foreground">{t("gaps.why")}</dt><dd>{g.why}</dd>
                    <dt className="text-muted-foreground">{t("gaps.audience")}</dt><dd>{g.audience}</dd>
                    <dt className="text-muted-foreground">{t("gaps.pillarFunnel")}</dt><dd>{pillarName(g.pillar_id) ?? g.pillar ?? "—"} · {g.funnel_stage ? td(`funnel.${g.funnel_stage}`) : "—"}</dd>
                    <dt className="text-muted-foreground">{t("gaps.platform")}</dt><dd>{g.platform ? PLATFORM_LABELS[g.platform] : "—"}</dd>
                  </dl>
                  {g.posts.length ? <PostLinks posts={g.posts} /> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold">{t("gaps.ideas")}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {report.result.ideas.map((idea, k) => (
                <article key={k} className="flex flex-col rounded-xl border bg-card shadow-xs">
                  <div className="flex items-start justify-between gap-3 p-4 pb-2">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><PlatformIcon platform={idea.platform} /> {PLATFORM_LABELS[idea.platform]} · {idea.format} · {td(`funnel.${idea.funnel_stage}`)}{pillarName(idea.pillar_id) ? ` · ${pillarName(idea.pillar_id)}` : ""}</p>
                      <p className="text-[15px] font-semibold leading-snug">{idea.title}</p>
                    </div>
                    <ScoreMeter score={idea.opportunity_score} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 px-4"><Badge variant={idea.insight_type_final === "data_supported" ? "success" : idea.insight_type_final === "experiment" ? "warning" : "secondary"}>{to(`evidence.${idea.insight_type_final}.label`)}</Badge><ConfidenceDots level={idea.confidence} /></div>
                  <div className="space-y-2 p-4 text-[13px]">
                    <p className="text-muted-foreground">{idea.rationale}</p>
                    <blockquote className="border-l-2 border-primary/40 pl-3 italic" dir="auto">{idea.hook}</blockquote>
                    <dl className="grid gap-1 text-xs sm:grid-cols-[6.5rem_1fr]">
                      <dt className="text-muted-foreground">{t("gaps.angle")}</dt><dd>{idea.original_angle}</dd>
                      <dt className="text-muted-foreground">{t("gaps.notCopy")}</dt><dd>{idea.how_it_differs}</dd>
                      <dt className="text-muted-foreground">{t("gaps.cta")}</dt><dd dir="auto">{idea.cta}</dd>
                    </dl>
                    {idea.inspired_posts.length ? <><p className="text-[11px] font-medium text-muted-foreground">{t("gaps.inspiredBy")}</p><PostLinks posts={idea.inspired_posts} /></> : <p className="text-[11px] text-muted-foreground">{t("gaps.noInspiration")}</p>}
                  </div>
                  <div className="mt-auto flex items-center gap-2 border-t p-3">
                    {created[k] ? (
                      <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/opportunities`}><CheckCircle2 /> {t("gaps.inOpportunities")}</Link></Button>
                    ) : !readOnly ? (
                      <Button size="sm" onClick={() => setEdit({ idea, index: k })}><Lightbulb /> {t("gaps.createOpportunity")}</Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
          {report.result.notes?.data_limits?.length ? <p className="text-[11px] text-muted-foreground">{t("dataLimits", { limits: report.result.notes.data_limits.join(" · ") })}</p> : null}
        </>
      )}
      {edit && report ? <IdeaDialog projectId={projectId} reportId={report.id} index={edit.index} idea={edit.idea} pillars={pillars} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function PostLinks({ posts }: { posts: { id: string; url: string | null; competitor: string; hook: string | null; lift: number | null }[] }) {
  const t = useT("competitors");
  return (
    <ul className="space-y-1 text-xs">
      {posts.slice(0, 4).map((p) => (
        <li key={p.id} className="flex items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">{p.competitor}{p.lift != null ? ` · ${t("lift", { value: p.lift })}` : ""}</span>
          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"><span className="truncate" dir="auto">{p.hook ?? t("gaps.openPost")}</span><ExternalLink className="size-3 shrink-0" /></a> : <span className="truncate">{p.hook}</span>}
        </li>
      ))}
    </ul>
  );
}

function IdeaDialog({ projectId, reportId, index, idea, pillars, onClose }: { projectId: string; reportId: string; index: number; idea: StoredIdea; pillars: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const t = useT("competitors");
  const tc = useT("common");
  const td = useT("domain");
  const [f, setF] = React.useState({ title: idea.title, rationale: idea.rationale, creative_angle: idea.original_angle, hook: idea.hook, cta: idea.cta, format: idea.format, platform: idea.platform as string, pillar_id: idea.pillar_id ?? "", funnel_stage: idea.funnel_stage as string });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    const r = await createOpportunityFromIdeaAction(projectId, reportId, index, f);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("gaps.createOpportunity")}</DialogTitle>
          <DialogDescription>{t("gaps.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("gaps.fields.title")}<Input value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("gaps.fields.rationale")}<Textarea rows={3} value={f.rationale} onChange={(e) => set("rationale", e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("gaps.fields.angle")}<Textarea rows={2} value={f.creative_angle} onChange={(e) => set("creative_angle", e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium sm:col-span-2">{t("gaps.fields.hook")}<Input value={f.hook} onChange={(e) => set("hook", e.target.value)} dir="auto" /></label>
          <label className="grid gap-1 text-xs font-medium">{t("gaps.cta")}<Input value={f.cta} onChange={(e) => set("cta", e.target.value)} dir="auto" /></label>
          <label className="grid gap-1 text-xs font-medium">{t("manual.format")}<Input value={f.format} onChange={(e) => set("format", e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-medium">{t("gaps.platform")}<NativeSelect value={f.platform} onChange={(e) => set("platform", e.target.value)}>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</NativeSelect></label>
          <label className="grid gap-1 text-xs font-medium">{t("gaps.fields.pillar")}<NativeSelect value={f.pillar_id} onChange={(e) => set("pillar_id", e.target.value)}><option value="">{tc("states.none")}</option>{pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></label>
          <label className="grid gap-1 text-xs font-medium">{t("gaps.fields.funnel")}<NativeSelect value={f.funnel_stage} onChange={(e) => set("funnel_stage", e.target.value)}>{FUNNEL_STAGES.map((s) => <option key={s} value={s}>{td(`funnel.${s}`)}</option>)}</NativeSelect></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tc("actions.cancel")}</Button>
          <Button onClick={save} disabled={busy || !f.title.trim()}>{busy ? <Loader2 className="animate-spin" /> : null} {t("gaps.createShort")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
