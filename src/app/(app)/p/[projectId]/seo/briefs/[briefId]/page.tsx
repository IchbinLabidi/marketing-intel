import Link from "next/link";
import { BackLink } from "@/components/app/page-header";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/seo/actions-bar";
import { AddToCalendarDialog } from "@/components/seo/calendar-dialog";
import { canEdit } from "@/lib/domain/constants";
import { INTENT_LABELS } from "@/lib/serp/analysis";
import { isAIConfigured } from "@/server/ai/client";
import { WEB_FORMATS } from "@/server/ai/serp";
import { addBriefToCalendarAction, deleteBriefAction, generateDraftAction } from "@/server/actions/serp";
import { COUNTRIES, SERP_LANGUAGES } from "@/server/serp/provider";
import { getBrief } from "@/server/services/serp";
import { getProjectContext } from "@/server/services/projects";
import { getStrategyBundle } from "@/server/services/strategy";

export const metadata = { title: "SEO brief" };

export default async function Page({ params }: { params: Promise<{ projectId: string; briefId: string }> }) {
  const { projectId, briefId } = await params;
  const { role } = await getProjectContext(projectId);
  const row = await getBrief(projectId, briefId);
  if (!row) notFound();
  const b = row.brief;
  const editable = canEdit(role);
  const ai = isAIConfigured();
  const bundle = editable && !row.content_item_id ? await getStrategyBundle(projectId) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink href={row.analysis_id ? `/p/${projectId}/seo/${row.analysis_id}` : `/p/${projectId}/seo?tab=briefs`}>{row.analysis_id ? "SERP analysis" : "SEO briefs"}</BackLink>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]" dir="auto">{b.h1}</h1>
          <p className="text-[13px] text-muted-foreground">SEO brief (AI, based on the SERP) · {row.keyword} · {COUNTRIES[row.country]?.label ?? row.country} · {SERP_LANGUAGES[row.language] ?? row.language}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label={row.draft ? "Rewrite draft" : "Generate article draft"} busyLabel="Writing…" icon="pen" run={generateDraftAction.bind(null, projectId, row.id)} disabled={!ai} title={!ai ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY" : undefined} confirm={row.draft ? "Replace the current draft?" : undefined} />
            {row.content_item_id ? (
              <Button asChild size="sm" variant="outline"><Link href={`/p/${projectId}/production?item=${row.content_item_id}`}>Open in Content Production</Link></Button>
            ) : bundle ? (
              <AddToCalendarDialog
                run={addBriefToCalendarAction.bind(null, projectId, row.id)} projectId={projectId} formats={WEB_FORMATS} defaultFormat={b.content_type}
                campaigns={bundle.campaigns.map((c) => ({ id: c.id, name: c.name }))} pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name }))}
              />
            ) : null}
            <ActionButton label="Delete" icon="trash" variant="ghost" run={deleteBriefAction.bind(null, projectId, row.id)} href={`/p/${projectId}/seo?tab=briefs`} confirm="Delete this brief?" />
          </div>
        ) : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Search snippet">
          <p className="text-[15px] text-primary" dir="auto">{b.seo_title} <Count n={b.seo_title.length} max={60} /></p>
          <p className="text-xs text-success" dir="auto">/{b.slug}</p>
          <p className="text-[13px]" dir="auto">{b.meta_description} <Count n={b.meta_description.length} max={155} /></p>
        </Card>
        <Card title="Targeting">
          <Line k="Primary keyword" v={b.primary_keyword} />
          <Line k="Secondary keywords" v={b.secondary_keywords.join(" · ") || "—"} />
          <Line k="Search intent" v={INTENT_LABELS[b.search_intent]} />
          <Line k="Audience" v={b.target_audience} />
          <Line k="Format" v={`${b.content_type} · about ${b.word_count_target} words`} />
          <Line k="CTA" v={b.cta} />
        </Card>
      </section>

      <Card title="Outline">
        <p className="font-semibold" dir="auto">H1 · {b.h1}</p>
        <ol className="space-y-2" dir="auto">
          {b.outline.map((s, k) => (
            <li key={k} className="text-[13px]">
              <p className="font-medium">H2 · {s.h2}</p>
              {s.h3.map((h, j) => <p key={j} className="pl-4 text-muted-foreground">H3 · {h}</p>)}
              {s.notes ? <p className="pl-4 text-xs italic text-muted-foreground">{s.notes}</p> : null}
            </li>
          ))}
        </ol>
      </Card>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card title="Questions to answer">{b.questions.map((q, k) => <p key={k} className="text-[13px]" dir="auto">• {q}</p>)}</Card>
        <Card title="Entities and subtopics"><div className="flex flex-wrap gap-1.5">{b.entities.map((e) => <Badge key={e} variant="outline">{e}</Badge>)}</div></Card>
        <Card title="Internal links">{b.internal_links.map((l, k) => <Line key={k} k={l.anchor} v={l.target} />)}</Card>
      </section>

      <Card title="Competitor observations (from the SERP)">
        {b.competitor_observations.map((o, k) => <p key={k} className="text-[13px]" dir="auto">• {o.observation} {o.refs.length ? <span className="text-xs text-muted-foreground">[{o.refs.join(", ")}]</span> : null}</p>)}
        <p className="pt-1 text-[13px]"><b>Differentiation:</b> <span dir="auto">{b.differentiation}</span></p>
        <p className="text-[11px] text-muted-foreground">Refs point to the SERP snapshot (R = organic result, Q = People also ask, P = page read). The brief describes original content; nothing is copied from ranking pages.</p>
      </Card>

      <Card title="Article draft">
        {row.draft ? <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap font-sans text-[13px]" dir="auto">{row.draft}</pre> : <p className="text-xs text-muted-foreground">No draft yet. “Generate article draft” writes one from this brief (AI); review it before publishing.</p>}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-1.5 rounded-xl border bg-card p-4 shadow-xs"><p className="text-[13px] font-semibold">{title}</p>{children}</section>;
}
function Line({ k, v }: { k: string; v: string }) {
  return <p className="grid grid-cols-[9rem_1fr] gap-3 text-[13px]"><span className="text-muted-foreground" dir="auto">{k}</span><span dir="auto">{v}</span></p>;
}
function Count({ n, max }: { n: number; max: number }) {
  return <span className={n > max ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>({n}/{max})</span>;
}
