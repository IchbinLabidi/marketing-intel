import Link from "next/link";
import { BackLink } from "@/components/app/page-header";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/seo/actions-bar";
import { canEdit } from "@/lib/domain/constants";
import { compareSnapshots, contentTypeOf, serpLabels } from "@/lib/serp/analysis";
import { domainOf, featureOf } from "@/lib/serp/normalize";
import { cn } from "@/lib/utils";
import { isAIConfigured } from "@/server/ai/client";
import { analyzeKeywordAction, deleteAnalysisAction, generateBriefAction, seoOpportunitiesAction, serpInsightAction } from "@/server/actions/serp";
import { getAnalysis, listAnalyses } from "@/server/services/serp";
import { getProjectContext } from "@/server/services/projects";
import { getFormatter, getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";

export async function generateMetadata() {
  const t = await getT("seo");
  return { title: t("analysis.title") };
}

/** Known reasons a ranking page was not read (stored in English with the snapshot), shown in the viewer's language. */
const PAGE_ERRORS: Record<string, "notHtmlArticle" | "invalidUrl" | "unsupportedUrl" | "robots" | "notHtml" | "timeout"> = {
  "Not an HTML article (video, social or document): SERP data only.": "notHtmlArticle", "Invalid URL": "invalidUrl", "Unsupported URL": "unsupportedUrl",
  "Blocked by the site's robots.txt: not read.": "robots", "Not an HTML page": "notHtml", "No answer within 10 s": "timeout",
};
const pageError = (t: TFor<"seo">, e: string | null) => {
  if (e && PAGE_ERRORS[e]) return t(`analysis.pageErrors.${PAGE_ERRORS[e]}`);
  const m = e?.match(/^Could not read the page \((.*)\)$/);
  return m ? t("analysis.pageErrors.unreadable", { detail: m[1] }) : e;
};

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string; analysisId: string }>; searchParams: Promise<{ compare?: string }> }) {
  const { projectId, analysisId } = await params;
  const sp = await searchParams;
  const [{ project, role }, t, fmt] = await Promise.all([getProjectContext(projectId), getT("seo"), getFormatter()]);
  const L = serpLabels(t);
  const when = (iso: string | null) => (iso ? fmt.dateTime(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
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
  const label = (x: { country: string; language: string; device: string; fetched_at: string | null; created_at: string }) => `${L.country(x.country)} · ${L.language(x.language)} · ${t.has(`device.${x.device}`) ? t(`device.${x.device}` as Parameters<typeof t>[0]) : x.device} · ${when(x.fetched_at ?? x.created_at)}`;
  const analyzeAgain = analyzeKeywordAction.bind(null, projectId, { keyword: a.keyword, country: a.country, language: a.language, devices: [a.device] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink href={`/p/${projectId}/seo`}>{t("title")}</BackLink>
          <h1 className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em]" dir="auto">{a.keyword}</h1>
          <p className="text-[13px] text-muted-foreground">Google · {label(a)}{a.location ? ` · ${t("analysis.searchedFrom", { place: a.location.split(",")[0] })}` : ""} · {t("analysis.via", { provider: a.provider === "serpapi" ? "SerpApi" : a.provider })}{a.total_results ? ` · ${t("analysis.aboutResults", { count: a.total_results })}` : ""}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton label={t("analysis.analyzeAgain")} busyLabel={t("form.analysing")} icon="refresh" run={analyzeAgain} href={`/p/${projectId}/seo/{id}`} title={t("analysis.analyzeAgainHint")} />
            {a.status === "completed" ? <>
              <ActionButton label={t("analysis.ai")} busyLabel={t("form.analysing")} icon="sparkles" run={serpInsightAction.bind(null, projectId, a.id)} disabled={!ai} title={!ai ? t("analysis.aiDisabled") : undefined} />
              <ActionButton label={t("analysis.opportunities")} busyLabel={t("analysis.generating")} icon="lightbulb" run={seoOpportunitiesAction.bind(null, projectId, [a.id], 6)} href={`/p/${projectId}/opportunities`} disabled={!ai} />
              <ActionButton label={t("analysis.brief")} busyLabel={t("analysis.writing")} icon="file" variant="default" run={generateBriefAction.bind(null, projectId, { analysisId: a.id })} href={`/p/${projectId}/seo/briefs/{id}`} disabled={!ai} />
            </> : null}
            <ActionButton label={t("analysis.delete")} icon="trash" variant="ghost" run={deleteAnalysisAction.bind(null, projectId, a.id)} href={`/p/${projectId}/seo`} confirm={t("analysis.deleteConfirm")} />
          </div>
        ) : null}
      </div>

      {a.status === "failed" ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[13px] text-destructive">{t("analysis.failed", { error: a.error ?? "" })}</p> : null}

      {siblings.length ? (
        <nav className="flex flex-wrap items-center gap-2 text-xs" aria-label={t("analysis.otherSnapshots")}>
          <span className="text-muted-foreground">{t("analysis.otherSnapshotsLabel")}</span>
          {siblings.slice(0, 8).map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
              <Link href={`/p/${projectId}/seo/${x.id}`} className="hover:underline">{label(x)}</Link>
              <Link href={`/p/${projectId}/seo/${a.id}?compare=${x.id}`} className="text-primary hover:underline">{t("analysis.compare")}</Link>
            </span>
          ))}
        </nav>
      ) : null}

      {a.status === "completed" && a.intent ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <p className="text-xs text-muted-foreground">{t("analysis.intentTitle")}</p>
            <p className="mt-1 text-lg font-semibold">{L.intent(a.intent.primary)}{a.intent.secondary ? <span className="text-sm font-normal text-muted-foreground"> · {t("analysis.also", { intent: L.intent(a.intent.secondary).toLowerCase() })}</span> : null}</p>
            <ul className="mt-2 space-y-1 text-xs">{a.intent.signals.slice(0, 8).map((x, k) => <li key={k} className="flex justify-between gap-3"><span>{L.signal(x)}</span><span className="shrink-0 text-muted-foreground">+{x.points} {L.intent(x.intent).toLowerCase()}</span></li>)}</ul>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("analysis.intentNote")}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <p className="text-xs text-muted-foreground">{t("analysis.featuresTitle")}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{a.features.length ? a.features.map((f) => <Badge key={f} variant="outline">{L.feature(f)} · {of(f).length}</Badge>) : <span className="text-xs text-muted-foreground">{t("analysis.organicOnly")}</span>}</div>
            {s ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t("keywords.ourSite")}</dt><dd className="font-semibold">{!ownDomain ? t("analysis.websiteNotSet") : s.ownPosition ? `#${s.ownPosition}` : t("analysis.notRanking")}</dd></div>
                <div><dt className="text-muted-foreground">{t("analysis.medianLength")}</dt><dd className="font-semibold tabular-nums">{s.medianWords ? t("analysis.words", { count: s.medianWords }) : "—"}</dd></div>
                <div><dt className="text-muted-foreground">{t("analysis.faqPages")}</dt><dd className="font-semibold tabular-nums">{s.faqShare != null ? t("percent", { value: s.faqShare }) : "—"}</dd></div>
                <div><dt className="text-muted-foreground">{t("analysis.pagesRead")}</dt><dd className="font-semibold tabular-nums">{s.pagesRead}/{s.pagesTotal}</dd></div>
              </dl>
            ) : null}
          </div>
        </section>
      ) : null}

      {compareWith ? (() => {
        const c = compareSnapshots(compareWith.items, items);
        return (
          <section className="rounded-xl border bg-card shadow-xs">
            <p className="border-b px-4 py-3 text-[13px] font-semibold">{t("analysis.comparison", { a: label(compareWith.analysis), common: t("analysis.inCommon", { count: c.overlap }) })}{c.featuresAdded.length ? ` · ${t("analysis.featuresAdded", { list: c.featuresAdded.map((f) => L.feature(f)).join(", ") })}` : ""}{c.featuresRemoved.length ? ` · ${t("analysis.featuresRemoved", { list: c.featuresRemoved.map((f) => L.feature(f)).join(", ") })}` : ""}</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-[13px]"><thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">{t("analysis.page")}</th><th className="w-14 text-center font-medium">A</th><th className="w-14 text-center font-medium">B</th><th className="w-20 pr-3 text-center font-medium">{t("analysis.change")}</th></tr></thead>
              <tbody>{c.rows.map((r) => <tr key={r.url} className={cn("border-b last:border-0", isOwn(r.domain) && "bg-primary/5")}><td className="max-w-md truncate px-3 py-1.5"><span className="text-muted-foreground">{r.domain}</span> · <span dir="auto">{r.title}</span></td><td className="text-center tabular-nums">{r.a ?? "—"}</td><td className="text-center tabular-nums">{r.b ?? "—"}</td><td className={cn("pr-3 text-center tabular-nums", (r.change ?? 0) > 0 ? "text-success" : (r.change ?? 0) < 0 ? "text-destructive" : "text-muted-foreground")}>{r.change == null ? (r.a == null ? t("analysis.new") : t("analysis.gone")) : r.change > 0 ? `+${r.change}` : r.change || "="}</td></tr>)}</tbody></table></div>
          </section>
        );
      })() : null}

      {of("featured_snippet").map((f) => (
        <section key={f.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-[13px]">
          <p className="text-xs font-medium text-primary">{L.feature("featured_snippet")}</p>
          <p className="mt-1" dir="auto">{f.snippet}</p>
          {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">{f.domain} <ExternalLink className="size-3" /></a> : null}
        </section>
      ))}

      {of("ai_overview").map((o) => {
        const refs = (o.data.references as { title: string | null; link: string | null; domain: string | null }[] | undefined) ?? [];
        return (
          <section key={o.id} className="space-y-2 rounded-xl border bg-card p-4 text-[13px] shadow-xs">
            <p className="text-xs font-medium text-muted-foreground">{t("analysis.aiOverview")} <span className="font-normal">· {t("analysis.aiOverviewHint")}</span></p>
            {o.snippet ? <p className="line-clamp-6 whitespace-pre-line" dir="auto">{o.snippet}</p> : <p className="text-xs text-muted-foreground">{t("analysis.aiOverviewNoText")}</p>}
            {refs.length ? (
              <div>
                <p className="text-xs font-medium">{t("analysis.sources", { count: refs.length })}{ownDomain ? ` · ${refs.some((r) => isOwn(r.domain)) ? t("analysis.includesOurSite") : t("analysis.notCited")}` : ""}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">{refs.slice(0, 12).map((r, k) => <li key={k}><a href={r.link ?? "#"} target="_blank" rel="noreferrer" title={r.title ?? ""} className={cn("rounded-md border px-2 py-0.5 text-xs hover:underline", isOwn(r.domain) && "border-primary text-primary")}>{r.domain ?? r.title}</a></li>)}</ul>
              </div>
            ) : null}
          </section>
        );
      })}

      <section className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <p className="border-b px-4 py-3 text-[13px] font-semibold">{t("analysis.organic")} <span className="text-xs font-normal text-muted-foreground">· {t("analysis.asReturned")}</span></p>
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">#</th><th className="font-medium">{t("analysis.page")}</th><th className="font-medium">{t("analysis.contentType")}</th><th className="pr-3 font-medium">{t("analysis.structure")}</th></tr></thead>
          <tbody>
            {organic.map((o) => {
              const p = pages.find((x) => x.url === o.url);
              return (
                <tr key={o.id} className={cn("border-b align-top last:border-0", isOwn(o.domain) && "bg-primary/5")}>
                  <td className="px-3 py-2 tabular-nums">{o.position}</td>
                  <td className="max-w-lg py-2 pr-3">
                    <a href={o.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline" dir="auto">{o.title}</a>
                    <span className="block text-xs text-muted-foreground">{o.domain}{isOwn(o.domain) ? ` · ${t("analysis.ourSiteLower")}` : ""}</span>
                    {o.snippet ? <span className="line-clamp-2 block text-xs" dir="auto">{o.snippet}</span> : null}
                  </td>
                  <td className="py-2 text-xs">{L.contentType(contentTypeOf(o))}</td>
                  <td className="py-2 pr-3 text-xs">
                    {!p ? <span className="text-muted-foreground">{t("analysis.notRead")}</span> : !p.ok ? <span className="text-muted-foreground">{pageError(t, p.error)}</span> : (
                      <details>
                        <summary className="cursor-pointer">{t("analysis.words", { count: p.words ?? 0 })} · {p.headings.length} H2/H3{p.has_faq ? " · FAQ" : ""}{p.schema.length ? ` · ${p.schema.slice(0, 3).join(", ")}` : ""}</summary>
                        <p className="mt-1 font-medium" dir="auto">H1: {p.h1 ?? "—"}</p>
                        <ul className="mt-1 space-y-0.5" dir="auto">{p.headings.map((h, k) => <li key={k} className={h.level === 3 ? "pl-3 text-muted-foreground" : ""}>{h.level === 2 ? "H2" : "H3"} · {h.text}</li>)}</ul>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {!organic.length ? <tr><td colSpan={4} className="px-3 py-4 text-xs text-muted-foreground">{t("analysis.noOrganic")}</td></tr> : null}
          </tbody>
        </table>
      </section>

      {s ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <Panel title={t("analysis.panels.contentTypes")}>{s.contentTypes.map((c) => <Row key={c.type} k={L.contentType(c.type)} v={String(c.n)} />)}</Panel>
          <Panel title={t("analysis.panels.topics")}>{s.commonTopics.length ? <p className="text-xs" dir="auto">{s.commonTopics.map((t) => `${t.topic} (${t.sites})`).join(" · ")}</p> : <p className="text-xs text-muted-foreground">{t("analysis.noneShared")}</p>}</Panel>
          <Panel title={t("analysis.panels.depth")}>
            <Row k={t("analysis.medianLength")} v={s.medianWords ? t("analysis.words", { count: s.medianWords }) : "—"} /><Row k={t("analysis.range")} v={s.minWords ? `${fmt.number(s.minWords)}–${fmt.number(s.maxWords ?? 0)}` : "—"} />
            <Row k={t("analysis.medianHeadings")} v={String(s.medianHeadings ?? "—")} /><Row k={t("analysis.structuredData")} v={s.schemaTypes.join(", ") || "—"} />
          </Panel>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {of("people_also_ask").length ? <Panel title={L.feature("people_also_ask")}>{of("people_also_ask").map((q) => <p key={q.id} className="text-[13px]" dir="auto">• {q.title}</p>)}</Panel> : null}
        {of("related_search").length ? <Panel title={L.feature("related_search")}>{<p className="text-[13px]" dir="auto">{of("related_search").map((r) => r.title).join(" · ")}</p>}</Panel> : null}
        {of("local").length ? <Panel title={t("analysis.panels.local")}>{of("local").map((l) => <Row key={l.id} k={l.title ?? ""} v={[l.data.rating ? `★ ${l.data.rating}` : null, l.data.reviews ? t("analysis.reviews", { count: Number(l.data.reviews) }) : null, l.snippet].filter(Boolean).join(" · ")} />)}</Panel> : null}
        {of("video").length ? <Panel title={L.feature("video")}>{of("video").map((v) => <p key={v.id} className="text-[13px]"><a href={v.url ?? "#"} target="_blank" rel="noreferrer" className="text-primary hover:underline" dir="auto">{v.title}</a> <span className="text-xs text-muted-foreground">{[v.data.channel, v.data.platform, v.data.duration].filter(Boolean).join(" · ")}</span></p>)}</Panel> : null}
        {of("top_story").length ? <Panel title={L.feature("top_story")}>{of("top_story").map((t) => <p key={t.id} className="text-[13px]"><a href={t.url ?? "#"} target="_blank" rel="noreferrer" className="hover:underline" dir="auto">{t.title}</a></p>)}</Panel> : null}
        {of("ad").length || of("shopping").length ? <Panel title={t("analysis.panels.adsShopping")}>{[...of("ad"), ...of("shopping")].map((x) => <Row key={x.id} k={x.title ?? ""} v={x.domain ?? ""} />)}</Panel> : null}
        {of("image").length ? <Panel title={L.feature("image")}>{<p className="text-xs text-muted-foreground">{t("analysis.imageResults", { count: of("image").length })} ({[...new Set(of("image").map((i) => i.domain).filter(Boolean))].slice(0, 5).join(", ")})</p>}</Panel> : null}
        {of("knowledge_graph").length ? <Panel title={L.feature("knowledge_graph")}>{of("knowledge_graph").map((k) => <p key={k.id} className="text-[13px]" dir="auto"><b>{k.title}</b> {k.snippet}</p>)}</Panel> : null}
      </section>

      {a.ai_analysis ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-[13px] font-semibold">{t("analysis.ai")} <span className="text-xs font-normal text-muted-foreground">· {when(a.ai_analysis.created_at)} · {t("analysis.interpretation")}</span></p>
          <p className="text-[13px]">{a.ai_analysis.summary}</p>
          {([[t("analysis.sections.whoRanks"), a.ai_analysis.competitors], [t("analysis.sections.patterns"), a.ai_analysis.content_patterns], [t("analysis.sections.gaps"), a.ai_analysis.gaps], [t("analysis.sections.vsOurSite"), a.ai_analysis.vs_our_site]] as const).map(([title, list]) => (
            <div key={title}><p className="mb-1 text-xs font-semibold text-muted-foreground">{title}</p>
              <ul className="space-y-1">{list.map((x, k) => <li key={k} className="text-[13px]"><span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium", x.basis === "serp_data" ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")}>{x.basis === "serp_data" ? t("analysis.serpData") : t("analysis.aiRecommendation")}</span>{x.text}</li>)}</ul>
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
