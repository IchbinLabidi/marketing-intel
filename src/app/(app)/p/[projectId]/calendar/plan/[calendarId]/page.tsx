import Link from "next/link";
import { BackLink } from "@/components/app/page-header";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, Lock } from "lucide-react";
import { ActionButton } from "@/components/seo/actions-bar";
import { MixEditor } from "@/components/editorial/mix-editor";
import { PostDate } from "@/components/editorial/post-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canEdit, FUNNEL_LABELS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { KPI_LABELS, type Kpi } from "@/lib/editorial/feedback";
import { addDays, days, OBJECTIVE_LABELS, type Objective } from "@/lib/editorial/plan";
import { DIMENSION_LABELS, type Dimension } from "@/lib/opportunities/scoring";
import { cn } from "@/lib/utils";
import { isAIConfigured } from "@/server/ai/client";
import {
  approveCalendarAction, attachOpportunityAction, calendarOpportunitiesAction, deleteEngineCalendarAction, generateCalendarAction,
  recheckCalendarAction, resetPlanAction, savePlanAction, setLockedAction,
} from "@/server/actions/editorial";
import { setOpportunityStateAction } from "@/server/actions/opportunities";
import { calendarAICost, engineItems, getEngineCalendar, publishedResults, type EngineItem } from "@/server/services/editorial";
import { linkedPosts, listOpportunities } from "@/server/services/opportunities";
import { loadSignals } from "@/server/services/opportunity-signals";
import { getProjectContext } from "@/server/services/projects";

export const metadata = { title: "Calendar plan" };

const STEPS = ["Month & platforms", "Frequency & objective", "Opportunities", "Content mix", "Generate", "Review", "Approve"];
const pl = (p: Platform | null) => (!p ? "—" : p === "blog" ? "Website / SEO" : PLATFORM_LABELS[p]);
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export default async function Page({ params }: { params: Promise<{ projectId: string; calendarId: string }> }) {
  const { projectId, calendarId } = await params;
  const { role } = await getProjectContext(projectId);
  const cal = await getEngineCalendar(projectId, calendarId);
  if (!cal) notFound();
  const editable = canEdit(role);
  const ai = isAIConfigured();
  if (cal.status === "saved" || !cal.plan) {
    return (
      <div className="space-y-4">
        <BackLink href={`/p/${projectId}/calendar?plan=${cal.id}`}>Editorial Calendar</BackLink>
        <p className="rounded-xl border bg-card p-4 text-[13px]">“{cal.name}” was created before the editorial engine (from Content history or by hand). Open it in the Editorial Calendar, or plan a new month with the engine.</p>
      </div>
    );
  }
  const plan = cal.plan;
  const [items, allOpps, { bundle, items: history }, cost] = await Promise.all([
    engineItems(projectId, calendarId), listOpportunities(projectId), loadSignals(projectId), calendarAICost(calendarId),
  ]);
  const { results, learnings } = await publishedResults(projectId, history);
  const myResults = results.filter((r) => r.calendar_id === calendarId);
  const opps = allOpps.filter((o) => o.calendar_id === calendarId && o.state !== "dismissed").sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0));
  const planPlatforms = plan.platforms.map((p) => p.platform);
  const linked = new Set((await linkedPosts(projectId)).map((p) => p.opportunity_id));
  const backlog = allOpps.filter((o) => !o.calendar_id && (o.state === "new" || o.state === "in_progress") && !linked.has(o.id) && (!o.platform || planPlatforms.includes(o.platform))).sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)).slice(0, 6);
  const pillarName = Object.fromEntries(bundle.pillars.map((p) => [p.id, p.name]));
  const campaignName = Object.fromEntries(bundle.campaigns.map((c) => [c.id, c.name]));
  const current = cal.status === "draft" ? (opps.length ? 4 : 3) : cal.status === "planned" ? 5 : cal.status === "generated" ? 6 : 8;
  const checks = cal.optimizer?.checks ?? [];
  const weeks = Array.from({ length: Math.ceil(days(cal.starts_on, cal.ends_on) / 7) }, (_, k) => addDays(cal.starts_on, k * 7));
  const sources = cal.sources ?? [];
  const missing = sources.filter((s) => s.status === "missing");
  const lockedCount = items.filter((i) => i.locked).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink href={`/p/${projectId}/calendar/plan`}>Plan a month</BackLink>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{cal.name}</h1>
          <p className="text-[13px] text-muted-foreground">{cal.starts_on} → {cal.ends_on} · {OBJECTIVE_LABELS[(cal.objective ?? "engagement") as Objective]} · {plan.total} posts planned · AI so far: {cost.requests} request(s), {usd(cost.cost)}{cost.unpriced ? "*" : ""} estimated</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length ? <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/calendar?plan=${cal.id}&date=${cal.starts_on}`}>Open in calendar (drag & drop)</Link></Button> : null}
          {editable && cal.status !== "approved" ? <ActionButton label="Delete" icon="trash" variant="ghost" run={deleteEngineCalendarAction.bind(null, projectId, cal.id)} href={`/p/${projectId}/calendar/plan`} confirm="Delete this calendar and its draft posts?" /> : null}
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7" aria-label="Steps">
        {STEPS.map((s, k) => {
          const n = k + 1;
          return <li key={s} aria-current={n === current ? "step" : undefined} className={cn("rounded-lg border px-2.5 py-2", n < current ? "border-success/40 bg-success/5" : n === current ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground")}><span className="block text-[11px] text-muted-foreground">Step {n}</span>{s}</li>;
        })}
      </ol>

      {/* Data sources ------------------------------------------------------------------------------------------ */}
      <section className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-[13px] font-semibold">Data the engine can use <span className="text-xs font-normal text-muted-foreground">· {sources.filter((s) => s.status === "available").length} available, {sources.filter((s) => s.status === "partial").length} partial, {missing.length} missing</span></p>
        <ul className="grid gap-x-6 gap-y-1 text-[13px] md:grid-cols-2">
          {sources.map((s) => (
            <li key={s.key} className="flex items-start gap-2">
              {s.status === "available" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : s.status === "partial" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span><span className="font-medium">{s.label}</span> <span className="text-xs text-muted-foreground">— {s.detail}</span></span>
            </li>
          ))}
        </ul>
        {missing.length ? <p className="text-xs text-muted-foreground">Missing data is not assumed: posts that no signal supports are marked “not performance-validated”.</p> : null}
      </section>

      {/* Step 3: opportunities --------------------------------------------------------------------------------- */}
      <section id="opportunities" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">3 · Content opportunities <span className="text-xs font-normal text-muted-foreground">({opps.length})</span></h2>
          {editable && cal.status !== "approved" ? <ActionButton label={opps.length ? "Generate more" : "Generate opportunities"} busyLabel="Analysing…" icon="lightbulb" variant={opps.length ? "outline" : "default"} run={calendarOpportunitiesAction.bind(null, projectId, cal.id, null)} disabled={!ai} title={!ai ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY" : undefined} /> : null}
        </div>
        {!opps.length ? <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">The AI proposes opportunities for this month from your signals (performance, gaps, competitors, search, past results). Each one is scored transparently; ideas without data support can&apos;t score above 60. You can skip this step: posts are then written from the plan and strategy only.</p> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {opps.map((o) => {
              const dims = o.score_breakdown?.dimensions ?? {};
              return (
                <li key={o.id} className="space-y-2 rounded-xl border bg-card p-4 text-[13px] shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium" dir="auto">{o.title ?? o.idea}</p>
                    <span className="shrink-0 text-right"><span className="block text-lg font-semibold tabular-nums">{o.opportunity_score ?? "—"}</span><span className="text-[11px] text-muted-foreground">{o.confidence} confidence</span></span>
                  </div>
                  <p className="text-xs text-muted-foreground" dir="auto">{o.rationale}</p>
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    <Badge variant="outline">{pl(o.platform)}</Badge>{o.format ? <Badge variant="outline">{o.format}</Badge> : null}
                    {o.pillar_id ? <Badge variant="outline">{pillarName[o.pillar_id] ?? "pillar"}</Badge> : null}{o.funnel_stage ? <Badge variant="outline">{FUNNEL_LABELS[o.funnel_stage]}</Badge> : null}
                    {o.campaign_id ? <Badge variant="outline">Campaign: {campaignName[o.campaign_id]}</Badge> : null}
                    {o.production_effort ? <Badge variant="outline">Effort: {o.production_effort}</Badge> : null}
                    <Badge variant={o.insight_type === "data_supported" ? "default" : "secondary"}>{o.insight_type.replace("_", " ")}</Badge>
                  </div>
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                    {o.target_audience ? <><dt className="text-muted-foreground">Persona</dt><dd dir="auto">{o.target_audience}</dd></> : null}
                    {o.marketing_objective ? <><dt className="text-muted-foreground">Objective</dt><dd dir="auto">{o.marketing_objective}</dd></> : null}
                    {o.hook ? <><dt className="text-muted-foreground">Hook</dt><dd dir="auto">{o.hook}</dd></> : null}
                    {o.cta ? <><dt className="text-muted-foreground">CTA</dt><dd dir="auto">{o.cta}</dd></> : null}
                  </dl>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Score and evidence ({o.evidence.filter((e) => e.type !== "ai_reasoning").length} signal{o.evidence.length === 1 ? "" : "s"})</summary>
                    <ul className="mt-1 space-y-0.5">{Object.entries(dims as Record<string, { score: number | null; basis: string; weight: number }>).map(([k, d]) => <li key={k} className="flex justify-between gap-2"><span>{DIMENSION_LABELS[k as Dimension] ?? k} <span className="text-muted-foreground">({d.basis}, weight {d.weight})</span></span><span className="tabular-nums">{d.score ?? "excluded"}</span></li>)}</ul>
                    <p className="mt-1 text-muted-foreground">{o.score_breakdown?.formula}</p>
                    <ul className="mt-1 space-y-0.5">{o.evidence.map((e, k) => <li key={k} className="text-muted-foreground">• [{e.type}] {e.note}</li>)}</ul>
                  </details>
                  {editable && cal.status !== "approved" ? (
                    <div className="flex gap-2">
                      <ActionButton label="Remove from this calendar" variant="ghost" run={attachOpportunityAction.bind(null, projectId, cal.id, o.id, false)} />
                      <ActionButton label="Dismiss" icon="trash" variant="ghost" run={setOpportunityStateAction.bind(null, projectId, o.id, "dismissed")} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {backlog.length && editable && cal.status !== "approved" ? (
          <details className="rounded-xl border bg-card p-3 text-[13px]">
            <summary className="cursor-pointer font-medium">From your opportunity backlog ({backlog.length})</summary>
            <ul className="mt-2 space-y-1">{backlog.map((o) => <li key={o.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate" dir="auto">{o.title ?? o.idea} <span className="text-xs text-muted-foreground">· {pl(o.platform)} · score {o.opportunity_score ?? "—"}</span></span><ActionButton label="Add" variant="outline" run={attachOpportunityAction.bind(null, projectId, cal.id, o.id, true)} /></li>)}</ul>
          </details>
        ) : null}
      </section>

      {/* Step 4: content mix ------------------------------------------------------------------------------------- */}
      <section id="mix" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">4 · Content mix <span className="text-xs font-normal text-muted-foreground">· calculated from the strategy and your data; edit before generating</span></h2>
          {editable && cal.status !== "approved" ? <ActionButton label="Recalculate" icon="refresh" variant="ghost" run={resetPlanAction.bind(null, projectId, cal.id)} confirm="Replace your edits with a freshly calculated mix?" /> : null}
        </div>
        {/* keyed by the stored plan: a recalculation or save from elsewhere replaces the editor's local copy */}
        <MixEditor key={JSON.stringify(plan)} plan={plan} pillarName={pillarName} campaignName={campaignName} save={savePlanAction.bind(null, projectId, cal.id)} readOnly={!editable || cal.status === "approved"} />
      </section>

      {/* Step 5: generate ---------------------------------------------------------------------------------------- */}
      <section id="generate" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
        <div className="text-[13px]">
          <p className="font-semibold">5 · Generate the calendar</p>
          <p className="text-xs text-muted-foreground">Slots (date, platform, pillar, funnel, format, campaign) are laid out from the mix; the AI writes each post per platform, one week per request, with only the signals relevant to that week. {lockedCount ? `${lockedCount} locked post(s) are kept.` : ""}</p>
        </div>
        {editable && cal.status !== "approved" ? (
          <ActionButton label={items.length ? "Regenerate unlocked posts" : "Generate the calendar"} busyLabel="Writing posts…" icon="sparkles" variant={items.length ? "outline" : "default"}
            run={generateCalendarAction.bind(null, projectId, cal.id, { kind: "all" }, null)} disabled={!ai || cal.status === "draft"}
            title={!ai ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY" : cal.status === "draft" ? "Save the content mix first" : undefined}
            confirm={items.length ? "Replace every unlocked draft post? Locked posts and posts already in production are kept." : undefined} />
        ) : null}
      </section>

      {/* Step 6: review ------------------------------------------------------------------------------------------ */}
      {items.length ? (
        <section id="review" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">6 · Review, edit, lock or regenerate <span className="text-xs font-normal text-muted-foreground">({items.length} posts)</span></h2>
            {editable ? <ActionButton label="Re-check" icon="refresh" variant="ghost" run={recheckCalendarAction.bind(null, projectId, cal.id, true)} title="Balance, repetition (with a cheap AI judgment for close pairs), workload" /> : null}
          </div>
          {checks.length ? (
            <ul className="grid gap-2 md:grid-cols-2">
              {checks.map((c) => (
                <li key={c.key} className={cn("rounded-lg border p-3 text-[13px]", c.status === "warning" ? "border-warning/40 bg-warning/5" : "")}>
                  <p className="flex items-center gap-1.5 font-medium">{c.status === "warning" ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {weeks.map((w) => {
            const list = items.filter((i) => i.scheduled_date && i.scheduled_date >= w && i.scheduled_date <= addDays(w, 6));
            if (!list.length) return null;
            return (
              <div key={w} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-1">
                  <p className="text-[13px] font-semibold">Week of {new Date(`${w}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} <span className="text-xs font-normal text-muted-foreground">· {list.length} posts</span></p>
                  {editable && cal.status !== "approved" ? <ActionButton label="Regenerate week" busyLabel="Writing…" icon="refresh" variant="ghost" run={generateCalendarAction.bind(null, projectId, cal.id, { kind: "week", start: w }, null)} disabled={!ai} confirm="Rewrite this week's unlocked posts?" /> : null}
                </div>
                <ul className="grid gap-3 lg:grid-cols-2">{list.map((i) => <PostCard key={i.id} i={i} projectId={projectId} calendarId={cal.id} editable={editable && cal.status !== "approved"} ai={ai} pillarName={pillarName} campaignName={campaignName} start={cal.starts_on} end={cal.ends_on} warn={checks.some((c) => c.status === "warning" && c.ids.includes(i.id))} />)}</ul>
              </div>
            );
          })}
        </section>
      ) : null}

      {/* Step 7: approve ----------------------------------------------------------------------------------------- */}
      {items.length ? (
        <section id="approve" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <div className="text-[13px]">
            <p className="font-semibold">7 · Approve and move into production</p>
            <p className="text-xs text-muted-foreground">{cal.status === "approved" ? `Approved ${cal.approved_at?.slice(0, 10) ?? ""}: posts are in Content Production (Brief). Nothing is scheduled or published automatically.` : `Planned posts move to Content Production at the Brief stage. ${checks.filter((c) => c.status === "warning").length ? `${checks.filter((c) => c.status === "warning").length} check(s) still show warnings.` : "All checks pass."}`}</p>
          </div>
          {cal.status === "approved" ? <Button asChild size="sm"><Link href={`/p/${projectId}/production`}>Open Content Production</Link></Button>
            : editable ? <ActionButton label="Approve calendar" icon="check" variant="default" run={approveCalendarAction.bind(null, projectId, cal.id)} confirm={checks.some((c) => c.status === "warning") ? "Some checks show warnings. Approve anyway?" : "Approve and move the posts to production?"} /> : null}
        </section>
      ) : null}

      {/* Feedback loop ------------------------------------------------------------------------------------------- */}
      <section className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-[13px] font-semibold">Results vs objectives <span className="text-xs font-normal text-muted-foreground">· published posts judged on their objective&apos;s KPI against the platform&apos;s own median</span></p>
        {!myResults.length ? <p className="text-xs text-muted-foreground">No post of this calendar is verified as published yet. Once a post is published and verified in the Editorial Calendar (linked to the synced Meta post), its real metrics appear here and feed the next plans.</p> : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Post</th><th className="font-medium">KPI</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">Platform median</th><th className="text-right font-medium">Result</th></tr></thead>
            <tbody>{myResults.map((r) => <tr key={r.id} className="border-t"><td className="py-1" dir="auto">{r.title} <span className="text-xs text-muted-foreground">· {pl(r.platform)} {r.format ?? ""}</span></td><td className="text-xs">{KPI_LABELS[r.kpi as Kpi]}</td><td className="text-right tabular-nums">{r.value ?? "—"}</td><td className="text-right tabular-nums">{r.baseline ?? "—"}</td><td className={cn("text-right text-xs", r.verdict === "above" ? "text-success" : r.verdict === "below" ? "text-destructive" : "text-muted-foreground")}>{r.verdict === "no_data" ? "no metric yet" : `${r.verdict.replace("_", " ")} (×${r.ratio})`}</td></tr>)}</tbody>
          </table>
        )}
        {learnings.length ? <ul className="space-y-0.5 text-xs">{learnings.slice(0, 6).map((l) => <li key={l.key}>• {l.statement}</li>)}</ul> : null}
      </section>
    </div>
  );
}

function PostCard({ i, projectId, calendarId, editable, ai, pillarName, campaignName, start, end, warn }: {
  i: EngineItem; projectId: string; calendarId: string; editable: boolean; ai: boolean; pillarName: Record<string, string>; campaignName: Record<string, string>; start: string; end: string; warn: boolean;
}) {
  const d = (i.format_details ?? {}) as Record<string, unknown> & { kind?: string };
  const inProduction = i.status !== "planned" && i.status !== "idea";
  return (
    <li className={cn("space-y-2 rounded-xl border bg-card p-4 text-[13px] shadow-xs", warn && "border-warning/50", i.locked && "border-primary/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1 text-[11px]">
          <Badge>{pl(i.platform)}</Badge>{i.format ? <Badge variant="outline">{i.format}</Badge> : null}
          {i.pillar_id ? <Badge variant="outline">{pillarName[i.pillar_id] ?? "pillar"}</Badge> : null}
          {i.funnel_stage ? <Badge variant="outline">{FUNNEL_LABELS[i.funnel_stage]}{i.objective_kpi ? ` · ${KPI_LABELS[i.objective_kpi as Kpi]?.toLowerCase()}` : ""}</Badge> : null}
          {i.campaign_id ? <Badge variant="outline">{campaignName[i.campaign_id] ?? "campaign"}</Badge> : null}
          {i.locked ? <Badge variant="secondary"><Lock className="size-3" /> locked</Badge> : null}
          {inProduction ? <Badge variant="secondary">{i.status.replace("_", " ")}</Badge> : null}
        </span>
        {editable && !inProduction ? <PostDate projectId={projectId} calendarId={calendarId} id={i.id} date={i.scheduled_date} time={i.scheduled_time} min={start} max={end} /> : <span className="text-xs text-muted-foreground">{i.scheduled_date}{i.scheduled_time ? ` ${i.scheduled_time.slice(0, 5)}` : ""}</span>}
      </div>
      <p className="font-medium" dir="auto">{i.title}</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        {i.topic ? <><dt className="text-muted-foreground">Topic</dt><dd dir="auto">{i.topic}</dd></> : null}
        {i.hook ? <><dt className="text-muted-foreground">Hook</dt><dd dir="auto">{i.hook}</dd></> : null}
        {i.content_angle ? <><dt className="text-muted-foreground">Angle</dt><dd dir="auto">{i.content_angle}</dd></> : null}
        {i.cta ? <><dt className="text-muted-foreground">CTA</dt><dd dir="auto">{i.cta}</dd></> : null}
        {i.rationale ? <><dt className="text-muted-foreground">Why</dt><dd dir="auto">{i.rationale}</dd></> : null}
      </dl>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{i.caption ? "Caption" : "Brief"}, creative direction{d.kind ? ` and ${d.kind}` : ""}</summary>
        <div className="mt-1 space-y-2">
          <p className="whitespace-pre-wrap" dir="auto">{i.caption ?? i.creative_brief}</p>
          {i.hashtags?.length ? <p className="text-muted-foreground">{i.hashtags.map((h) => `#${h}`).join(" ")}</p> : null}
          {i.visual_direction ? <p><span className="font-medium">Creative direction:</span> <span dir="auto">{i.visual_direction}</span></p> : null}
          {d.kind === "reel" ? (
            <div dir="auto"><p className="font-medium">Reel · opening hook: {String(d.opening_hook ?? "")}</p><p className="whitespace-pre-wrap">{String(d.script ?? "")}</p>
              <ol className="mt-1 space-y-0.5">{((d.scenes as { visual: string; voiceover: string; on_screen_text: string }[]) ?? []).map((s, k) => <li key={k}>{k + 1}. {s.visual} — <em>{s.voiceover}</em>{s.on_screen_text ? ` · text: “${s.on_screen_text}”` : ""}</li>)}</ol><p>CTA: {String(d.cta ?? "")}</p></div>
          ) : d.kind === "carousel" ? (
            <div dir="auto"><p className="font-medium">Carousel · cover: {String(d.cover_title ?? "")}</p>
              <ol className="mt-1 space-y-0.5">{((d.slides as { title: string; body: string }[]) ?? []).map((s, k) => <li key={k}>{k + 1}. <b>{s.title}</b> — {s.body}</li>)}</ol><p>Final slide: {String(d.final_cta ?? "")}</p></div>
          ) : d.kind === "story" ? (
            <ol className="space-y-0.5" dir="auto">{((d.frames as { text: string; visual: string }[]) ?? []).map((f, k) => <li key={k}>{k + 1}. {f.text} <span className="text-muted-foreground">({f.visual})</span></li>)}</ol>
          ) : d.kind === "article" ? (
            <div dir="auto"><p><b>Keyword:</b> {String(d.target_keyword ?? "")} · <b>SEO title:</b> {String(d.seo_title ?? "")}</p><p className="text-muted-foreground">{String(d.meta_description ?? "")}</p><p className="font-medium">H1: {String(d.h1 ?? "")}</p>
              <ul>{((d.outline as { h2: string; h3: string[] }[]) ?? []).map((s, k) => <li key={k}>H2 · {s.h2}{s.h3?.length ? <span className="text-muted-foreground"> ({s.h3.join(" / ")})</span> : null}</li>)}</ul></div>
          ) : null}
        </div>
      </details>
      {i.repetition?.length ? <ul className="rounded-md bg-warning/10 p-2 text-xs">{i.repetition.map((r, k) => <li key={k}>Repeats “{r.with_title}” ({r.kind === "exact" ? "same wording" : "same angle"}): {r.note}</li>)}</ul> : null}
      {editable && !inProduction ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton label={i.locked ? "Unlock" : "Lock"} icon={i.locked ? "unlock" : "lock"} variant="ghost" run={setLockedAction.bind(null, projectId, i.id, !i.locked)} />
          {!i.locked ? <ActionButton label="Regenerate" busyLabel="Writing…" icon="refresh" variant="ghost" run={generateCalendarAction.bind(null, projectId, calendarId, { kind: "post", id: i.id }, null)} disabled={!ai} /> : null}
          <Button asChild size="sm" variant="ghost"><Link href={`/p/${projectId}/calendar?item=${i.id}&date=${i.scheduled_date ?? ""}`}>Edit</Link></Button>
        </div>
      ) : null}
    </li>
  );
}
