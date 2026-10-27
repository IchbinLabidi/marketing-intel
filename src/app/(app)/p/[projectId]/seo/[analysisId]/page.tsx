import Link from "next/link";
import { BackLink } from "@/components/app/page-header";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/seo/actions-bar";
import { canEdit } from "@/lib/domain/constants";
import { compareSnapshots, CONTENT_TYPE_LABELS, contentTypeOf, FEATURE_LABELS, INTENT_LABELS } from "@/lib/serp/analysis";
import { domainOf, featureOf } from "@/lib/serp/normalize";
import { cn } from "@/lib/utils";
import { isAIConfigured } from "@/server/ai/client";
import { analyzeKeywordAction, deleteAnalysisAction, generateBriefAction, seoOpportunitiesAction, serpInsightAction } from "@/server/actions/serp";
import { COUNTRIES, SERP_LANGUAGES } from "@/server/serp/provider";
import { getAnalysis, listAnalyses } from "@/server/services/serp";
import { getProjectContext } from "@/server/services/projects";

export const metadata = { title: "SERP analysis" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string; analysisId: string }>; searchParams: Promise<{ compare?: string }> }) {
  const { projectId, analysisId } = await params;
  const sp = await searchParams;
  const { project, role } = await getProjectContext(projectId);
  const data = await getAnalysis(projectId, analysisId);
  if (!data) notFound();
  const { analysis: a, items } = data;
  const editable = canEdit(role);
  const ai = isAIConfigured();
  const ownDomain = domainOf(project.website ? (project.website.startsWith("http") ? project.website : `https://${project.website}`) : null);
  const isOwn = (d: string | null) => Boolean(ownDomain && d && (d === ownDomain || d.endsWith(`.${ownDomain}`)));
  const siblings = (await listAnalyses(projectId)).filter((x) => x.keyword_normalized === a.keyword_normalized && x.id !== a.id && x.status === "completed");
  const compareWith = sp.compare ? await getAnalysis(projectId, sp.compare) : null;
  const of = (t: string) => items.filter((i) => featureOf(i) === t).sort((x, y) => (x.position ?? 99) - (y.position ?? 99));
  const organic = of("organic");
  const s = a.competitors?.summary;
  const pages = a.competitors?.pages ?? [];
  const label = (x: { country: string; language: string; device: string; fetched_at: string | null; created_at: string }) => `${COUNTRIES[x.country]?.label ?? x.country} · ${SERP_LANGUAGES[x.language] ?? x.language} · ${x.device} · ${when(x.fetched_at ?? x.created_at)}`;
  const analyzeAgain = analyzeKeywordAction.bind(null, projectId, { keyword: a.keyword, country: a.country, language: a.language, devices: [a.device] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink href={`/p/${projectId}/seo`}>SERP Intelligence</BackLink>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]" dir="auto">{a.keyword}</h1>
          <p className="text-[13px] text-muted-foreground">Google · {label(a)}{a.location ? ` · searched from ${a.location.split(",")[0]}` : ""} · via {a.provider === "serpapi" ? "SerpApi" : a.provider}{a.total_results ? ` · about ${a.total_results.toLocaleString("en")} results` : ""}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Analyze again" busyLabel="Analysing…" icon="refresh" run={analyzeAgain} href={`/p/${projectId}/seo/{id}`} title="New snapshot with the same settings" />
            {a.status === "completed" ? <>
              <ActionButton label="AI analysis" busyLabel="Analysing…" icon="sparkles" run={serpInsightAction.bind(null, projectId, a.id)} disabled={!ai} title={!ai ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY" : undefined} />
              <ActionButton label="SEO opportunities" busyLabel="Generating…" icon="lightbulb" run={seoOpportunitiesAction.bind(null, projectId, [a.id], 6)} href={`/p/${projectId}/opportunities`} disabled={!ai} />
              <ActionButton label="Generate SEO brief" busyLabel="Writing…" icon="file" variant="default" run={generateBriefAction.bind(null, projectId, { analysisId: a.id })} href={`/p/${projectId}/seo/briefs/{id}`} disabled={!ai} />
            </> : null}
            <ActionButton label="Delete" icon="trash" variant="ghost" run={deleteAnalysisAction.bind(null, projectId, a.id)} href={`/p/${projectId}/seo`} confirm="Delete this snapshot?" />
          </div>
        ) : null}
      </div>

      {a.status === "failed" ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px] text-destructive">This analysis failed: {a.error}</p> : null}

      {siblings.length ? (
        <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label="Other snapshots">
          <span className="text-muted-foreground">Other snapshots:</span>
          {siblings.slice(0, 8).map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <Link href={`/p/${projectId}/seo/${x.id}`} className="hover:underline">{label(x)}</Link>
              <Link href={`/p/${projectId}/seo/${a.id}?compare=${x.id}`} className="text-primary hover:underline">compare</Link>
            </span>
          ))}
        </nav>
      ) : null}

      {a.status === "completed" && a.intent ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <p className="text-xs text-muted-foreground">Search intent · calculated from this SERP</p>
            <p className="mt-1 text-lg font-semibold">{INTENT_LABELS[a.intent.primary]}{a.intent.secondary ? <span className="text-sm font-normal text-muted-foreground"> · also {INTENT_LABELS[a.intent.secondary].toLowerCase()}</span> : null}</p>
            <ul className="mt-2 space-y-1 text-xs">{a.intent.signals.slice(0, 8).map((x, k) => <li key={k} className="flex justify-between gap-3"><span>{x.reason}</span><span className="shrink-0 text-muted-foreground">+{x.points} {INTENT_LABELS[x.intent].toLowerCase()}</span></li>)}</ul>
            <p className="mt-2 text-[11px] text-muted-foreground">Features and the type of ranking pages weigh most; the keyword wording counts for 1 point.</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <p className="text-xs text-muted-foreground">SERP features present</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{a.features.length ? a.features.map((f) => <Badge key={f} variant="outline">{FEATURE_LABELS[f] ?? f} · {of(f).length}</Badge>) : <span className="text-xs text-muted-foreground">Organic results only</span>}</div>
            {s ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Our site</dt><dd className="font-semibold">{!ownDomain ? "website not set" : s.ownPosition ? `#${s.ownPosition}` : "not ranking"}</dd></div>
                <div><dt className="text-muted-foreground">Median length</dt><dd className="font-semibold tabular-nums">{s.medianWords ? `${s.medianWords} words` : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Pages with FAQ</dt><dd className="font-semibold tabular-nums">{s.faqShare != null ? `${s.faqShare}%` : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Pages read</dt><dd className="font-semibold tabular-nums">{s.pagesRead}/{s.pagesTotal}</dd></div>
              </dl>
            ) : null}
          </div>
        </section>
      ) : null}

      {compareWith ? (() => {
        const c = compareSnapshots(compareWith.items, items);
        return (
          <section className="rounded-xl border bg-card shadow-xs">
            <p className="border-b px-4 py-3 text-[13px] font-semibold">Comparison: {label(compareWith.analysis)} (A) → this snapshot (B) · {c.overlap} results in common{c.featuresAdded.length ? ` · features added: ${c.featuresAdded.map((f) => FEATURE_LABELS[f]).join(", ")}` : ""}{c.featuresRemoved.length ? ` · removed: ${c.featuresRemoved.map((f) => FEATURE_LABELS[f]).join(", ")}` : ""}</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-[13px]"><thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">Page</th><th className="w-14 text-center font-medium">A</th><th className="w-14 text-center font-medium">B</th><th className="w-20 pr-3 text-center font-medium">Change</th></tr></thead>
              <tbody>{c.rows.map((r) => <tr key={r.url} className={cn("border-b last:border-0", isOwn(r.domain) && "bg-primary/5")}><td className="max-w-md truncate px-3 py-1.5"><span className="text-muted-foreground">{r.domain}</span> · <span dir="auto">{r.title}</span></td><td className="text-center tabular-nums">{r.a ?? "—"}</td><td className="text-center tabular-nums">{r.b ?? "—"}</td><td className={cn("pr-3 text-center tabular-nums", (r.change ?? 0) > 0 ? "text-success" : (r.change ?? 0) < 0 ? "text-destructive" : "text-muted-foreground")}>{r.change == null ? (r.a == null ? "new" : "gone") : r.change > 0 ? `+${r.change}` : r.change || "="}</td></tr>)}</tbody></table></div>
          </section>
        );
      })() : null}

      {of("featured_snippet").map((f) => (
        <section key={f.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-[13px]">
          <p className="text-xs font-medium text-primary">Featured snippet</p>
          <p className="mt-1" dir="auto">{f.snippet}</p>
          {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">{f.domain} <ExternalLink className="size-3" /></a> : null}
        </section>
      ))}

      {of("ai_overview").map((o) => {
        const refs = (o.data.references as { title: string | null; link: string | null; domain: string | null }[] | undefined) ?? [];
        return (
          <section key={o.id} className="space-y-2 rounded-xl border bg-card p-4 text-[13px] shadow-xs">
            <p className="text-xs font-medium text-muted-foreground">Google AI Overview <span className="font-normal">· shown above the results, as returned by Google</span></p>
            {o.snippet ? <p className="line-clamp-6 whitespace-pre-line" dir="auto">{o.snippet}</p> : <p className="text-xs text-muted-foreground">Google showed an AI Overview; its text was not included in this response.</p>}
            {refs.length ? (
              <div>
                <p className="text-xs font-medium">Sources it cites ({refs.length}){ownDomain ? (refs.some((r) => isOwn(r.domain)) ? " · includes our site" : " · our site is not cited") : ""}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">{refs.slice(0, 12).map((r, k) => <li key={k}><a href={r.link ?? "#"} target="_blank" rel="noreferrer" title={r.title ?? ""} className={cn("rounded-md border px-2 py-0.5 text-xs hover:underline", isOwn(r.domain) && "border-primary text-primary")}>{r.domain ?? r.title}</a></li>)}</ul>
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <p className="border-b px-4 py-3 text-[13px] font-semibold">Organic results <span className="text-xs font-normal text-muted-foreground">· as returned by Google</span></p>
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">#</th><th className="font-medium">Page</th><th className="font-medium">Content type</th><th className="pr-3 font-medium">Structure (read)</th></tr></thead>
          <tbody>
            {organic.map((o) => {
              const p = pages.find((x) => x.url === o.url);
              return (
                <tr key={o.id} className={cn("border-b align-top last:border-0", isOwn(o.domain) && "bg-primary/5")}>
                  <td className="px-3 py-2 tabular-nums">{o.position}</td>
                  <td className="max-w-lg py-2 pr-3">
                    <a href={o.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline" dir="auto">{o.title}</a>
                    <span className="block text-xs text-muted-foreground">{o.domain}{isOwn(o.domain) ? " · our site" : ""}</span>
                    {o.snippet ? <span className="line-clamp-2 block text-xs" dir="auto">{o.snippet}</span> : null}
                  </td>
                  <td className="py-2 text-xs">{CONTENT_TYPE_LABELS[contentTypeOf(o)]}</td>
                  <td className="py-2 pr-3 text-xs">
                    {!p ? <span className="text-muted-foreground">not read</span> : !p.ok ? <span className="text-muted-foreground">{p.error}</span> : (
                      <details>
                        <summary className="cursor-pointer">{p.words} words · {p.headings.length} H2/H3{p.has_faq ? " · FAQ" : ""}{p.schema.length ? ` · ${p.schema.slice(0, 3).join(", ")}` : ""}</summary>
                        <p className="mt-1 font-medium" dir="auto">H1: {p.h1 ?? "—"}</p>
                        <ul className="mt-1 space-y-0.5" dir="auto">{p.headings.map((h, k) => <li key={k} className={h.level === 3 ? "pl-3 text-muted-foreground" : ""}>{h.level === 2 ? "H2" : "H3"} · {h.text}</li>)}</ul>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {!organic.length ? <tr><td colSpan={4} className="px-3 py-4 text-xs text-muted-foreground">No organic result returned.</td></tr> : null}
          </tbody>
        </table>
      </section>

      {s ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Panel title="Content types ranking">{s.contentTypes.map((c) => <Row key={c.type} k={c.label} v={String(c.n)} />)}</Panel>
          <Panel title="Topics in headings of 2+ sites">{s.commonTopics.length ? <p className="text-xs" dir="auto">{s.commonTopics.map((t) => `${t.topic} (${t.sites})`).join(" · ")}</p> : <p className="text-xs text-muted-foreground">None shared</p>}</Panel>
          <Panel title="Depth (pages read)">
            <Row k="Median length" v={s.medianWords ? `${s.medianWords} words` : "—"} /><Row k="Range" v={s.minWords ? `${s.minWords}–${s.maxWords}` : "—"} />
            <Row k="Median H2/H3" v={String(s.medianHeadings ?? "—")} /><Row k="Structured data" v={s.schemaTypes.join(", ") || "—"} />
          </Panel>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {of("people_also_ask").length ? <Panel title="People also ask">{of("people_also_ask").map((q) => <p key={q.id} className="text-[13px]" dir="auto">• {q.title}</p>)}</Panel> : null}
        {of("related_search").length ? <Panel title="Related searches">{<p className="text-[13px]" dir="auto">{of("related_search").map((r) => r.title).join(" · ")}</p>}</Panel> : null}
        {of("local").length ? <Panel title="Local results">{of("local").map((l) => <Row key={l.id} k={l.title ?? ""} v={[l.data.rating ? `★ ${l.data.rating}` : null, l.data.reviews ? `${l.data.reviews} reviews` : null, l.snippet].filter(Boolean).join(" · ")} />)}</Panel> : null}
        {of("video").length ? <Panel title="Videos">{of("video").map((v) => <p key={v.id} className="text-[13px]"><a href={v.url ?? "#"} target="_blank" rel="noreferrer" className="text-primary hover:underline" dir="auto">{v.title}</a> <span className="text-xs text-muted-foreground">{[v.data.channel, v.data.platform, v.data.duration].filter(Boolean).join(" · ")}</span></p>)}</Panel> : null}
        {of("top_story").length ? <Panel title="Top stories">{of("top_story").map((t) => <p key={t.id} className="text-[13px]"><a href={t.url ?? "#"} target="_blank" rel="noreferrer" className="hover:underline" dir="auto">{t.title}</a></p>)}</Panel> : null}
        {of("ad").length || of("shopping").length ? <Panel title="Ads and shopping">{[...of("ad"), ...of("shopping")].map((x) => <Row key={x.id} k={x.title ?? ""} v={x.domain ?? ""} />)}</Panel> : null}
        {of("image").length ? <Panel title="Images">{<p className="text-xs text-muted-foreground">{of("image").length} image results ({[...new Set(of("image").map((i) => i.domain).filter(Boolean))].slice(0, 5).join(", ")})</p>}</Panel> : null}
        {of("knowledge_graph").length ? <Panel title="Knowledge panel">{of("knowledge_graph").map((k) => <p key={k.id} className="text-[13px]" dir="auto"><b>{k.title}</b> {k.snippet}</p>)}</Panel> : null}
      </section>

      {a.ai_analysis ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-[13px] font-semibold">AI analysis <span className="text-xs font-normal text-muted-foreground">· {when(a.ai_analysis.created_at)} · interpretation, not SERP data</span></p>
          <p className="text-[13px]">{a.ai_analysis.summary}</p>
          {([["Who ranks", a.ai_analysis.competitors], ["Content patterns", a.ai_analysis.content_patterns], ["Gaps", a.ai_analysis.gaps], ["Compared with our site", a.ai_analysis.vs_our_site]] as const).map(([t, list]) => (
            <div key={t}><p className="mb-1 text-xs font-semibold text-muted-foreground">{t}</p>
              <ul className="space-y-1">{list.map((x, k) => <li key={k} className="text-[13px]"><span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium", x.basis === "serp_data" ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")}>{x.basis === "serp_data" ? "SERP data" : "AI recommendation"}</span>{x.text}</li>)}</ul>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-1.5 rounded-xl border bg-card p-4 shadow-xs"><p className="text-[13px] font-semibold">{title}</p>{children}</section>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <p className="flex justify-between gap-3 text-xs"><span dir="auto">{k}</span><span className="text-right text-muted-foreground" dir="auto">{v}</span></p>;
}
