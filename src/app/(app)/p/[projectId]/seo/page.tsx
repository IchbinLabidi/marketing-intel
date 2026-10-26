import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { AnalyzeForm } from "@/components/seo/analyze-form";
import { canEdit } from "@/lib/domain/constants";
import { domainStats, FEATURE_LABELS, INTENT_LABELS } from "@/lib/serp/analysis";
import { domainOf } from "@/lib/serp/normalize";
import { cn } from "@/lib/utils";
import { COUNTRIES, SERP_LANGUAGES, serpProvider } from "@/server/serp/provider";
import { itemsFor, listAnalyses, listBriefs, type SerpAnalysis } from "@/server/services/serp";
import { getProjectContext } from "@/server/services/projects";

export const metadata = { title: "SERP Intelligence" };

const TABS = [{ id: "keywords", label: "Keywords" }, { id: "domains", label: "Ranking domains" }, { id: "briefs", label: "SEO briefs" }] as const;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { project, role } = await getProjectContext(projectId);
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "keywords";
  const provider = serpProvider();
  const ownDomain = domainOf(project.website ? (project.website.startsWith("http") ? project.website : `https://${project.website}`) : null);
  const analyses = await listAnalyses(projectId);

  // one row per keyword × country × language; latest snapshot per device
  const groups = new Map<string, SerpAnalysis[]>();
  for (const a of analyses) {
    const k = `${a.keyword_normalized}|${a.country}|${a.language}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  let body: React.ReactNode;
  if (tab === "keywords") {
    body = !groups.size ? (
      <EmptyState icon={Search} title="No keyword analysed yet" description="Analyze a keyword to see the real Google results in Tunisia (or another market), its search intent, who ranks and with which kind of content." />
    ) : (
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">Keyword</th><th className="font-medium">Market</th><th className="font-medium">Intent (from the SERP)</th><th className="font-medium">SERP features</th><th className="font-medium">Our site</th><th className="font-medium">Snapshots</th><th className="pr-3 font-medium">Latest</th></tr></thead>
          <tbody>
            {[...groups.values()].map((list) => {
              const latest = list.filter((a) => a.status === "completed");
              const byDevice = (d: string) => latest.find((a) => a.device === d);
              const head = byDevice("desktop") ?? byDevice("mobile") ?? list[0];
              return (
                <tr key={head.id} className="border-b align-top last:border-0">
                  <td className="px-3 py-2"><Link href={`/p/${projectId}/seo/${head.id}`} className="font-medium hover:underline" dir="auto">{head.keyword}</Link>
                    <span className="mt-0.5 flex gap-2 text-[11px]">{(["desktop", "mobile"] as const).map((d) => byDevice(d) ? <Link key={d} href={`/p/${projectId}/seo/${byDevice(d)!.id}`} className="text-primary hover:underline">{d}</Link> : null)}</span>
                  </td>
                  <td className="py-2 text-xs">{COUNTRIES[head.country]?.label ?? head.country} · {SERP_LANGUAGES[head.language] ?? head.language}</td>
                  <td className="py-2">{head.status === "failed" ? <span className="text-xs text-destructive" title={head.error ?? ""}>Failed</span> : head.intent ? <Badge variant="outline">{INTENT_LABELS[head.intent.primary]}{head.intent.secondary ? ` / ${INTENT_LABELS[head.intent.secondary]}` : ""}</Badge> : "—"}</td>
                  <td className="max-w-[16rem] py-2 text-[11px] text-muted-foreground">{head.features.map((f) => FEATURE_LABELS[f] ?? f).join(" · ") || "—"}</td>
                  <td className="py-2 text-xs">{!ownDomain ? <span className="text-muted-foreground" title="Add the website in project settings">no website set</span> : (head as { own_position?: number | null }).own_position ? <b className="tabular-nums">#{(head as { own_position?: number | null }).own_position}</b> : head.status === "completed" ? <span className="text-muted-foreground">not in the results</span> : "—"}</td>
                  <td className="py-2 text-xs tabular-nums">{list.length}</td>
                  <td className="py-2 pr-3 text-xs">{fmtDate(head.fetched_at ?? head.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else if (tab === "domains") {
    const latest = [...groups.values()].flatMap((list) => {
      const done = list.filter((a) => a.status === "completed");
      return (["desktop", "mobile"] as const).map((d) => done.find((a) => a.device === d)).filter(Boolean) as SerpAnalysis[];
    });
    const items = await itemsFor(projectId, latest.map((a) => a.id));
    const stats = domainStats(latest.map((a) => ({ analysisId: a.id, keyword: a.keyword, items: items.filter((i) => i.analysis_id === a.id) })));
    body = !stats.length ? <EmptyState icon={Search} title="No ranking domain yet" description="Domains appear here once keywords are analysed." /> : (
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">Domain</th><th className="font-medium">Keywords where it ranks</th><th className="font-medium" title="Latest snapshot per keyword, language and device">In snapshots</th><th className="font-medium">Avg. position</th><th className="font-medium">Best</th><th className="pr-3 font-medium">Keywords</th></tr></thead>
          <tbody>
            {stats.slice(0, 50).map((d) => (
              <tr key={d.domain} className={cn("border-b last:border-0", ownDomain && (d.domain === ownDomain || d.domain.endsWith(`.${ownDomain}`)) && "bg-primary/5")}>
                <td className="px-3 py-2 font-medium">{d.domain}{ownDomain && (d.domain === ownDomain || d.domain.endsWith(`.${ownDomain}`)) ? <Badge className="ml-2">Our site</Badge> : null}</td>
                <td className="py-2 tabular-nums">{d.keywords.length}</td><td className="py-2 tabular-nums">{d.appearances}/{latest.length}</td><td className="py-2 tabular-nums">{d.avgPosition ?? "—"}</td><td className="py-2 tabular-nums">#{d.best ?? "—"}</td>
                <td className="max-w-md py-2 pr-3 text-[11px] text-muted-foreground" dir="auto">{d.keywords.slice(0, 4).join(" · ")}{d.keywords.length > 4 ? ` +${d.keywords.length - 4}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Organic top-10 results of the latest snapshot per keyword, language and device. Positions are those returned by Google at analysis time; no ongoing tracking is implied.</p>
      </div>
    );
  } else {
    const briefs = await listBriefs(projectId);
    body = !briefs.length ? <EmptyState icon={FileText} title="No SEO brief yet" description="Open an analysed keyword and click “Generate SEO brief”." /> : (
      <ul className="grid gap-3 md:grid-cols-2">
        {briefs.map((b) => (
          <li key={b.id}><Link href={`/p/${projectId}/seo/briefs/${b.id}`} className="block rounded-xl border bg-card p-4 shadow-xs hover:shadow-sm">
            <p className="text-xs text-muted-foreground">{b.keyword} · {COUNTRIES[b.country]?.label ?? b.country} · {SERP_LANGUAGES[b.language] ?? b.language} · {fmtDate(b.created_at)}</p>
            <p className="mt-1 font-semibold" dir="auto">{b.brief.seo_title}</p>
            <p className="text-xs text-muted-foreground">{b.brief.content_type} · {b.brief.search_intent} · {b.draft ? "draft written" : "no draft"}{b.content_item_id ? " · in the calendar" : ""}</p>
          </Link></li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="SERP Intelligence" description="Analyze Google search results, understand search intent, discover competitors, and identify SEO content opportunities." />
      <AnalyzeForm
        projectId={projectId}
        countries={Object.entries(COUNTRIES).map(([code, c]) => ({ code, label: `${c.label} (searched from ${c.city})` }))}
        languages={Object.entries(SERP_LANGUAGES).map(([code, label]) => ({ code, label }))}
        configured={provider.configured()} setupHint={provider.setupHint} readOnly={!canEdit(role)}
      />
      {!ownDomain ? <p className="text-xs text-muted-foreground">Tip: add your website in the project settings to see where your own pages rank and compare them with the results.</p> : null}
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="SERP Intelligence sections">
        {TABS.map((t) => <Link key={t.id} href={`/p/${projectId}/seo?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</Link>)}
      </nav>
      {body}
    </div>
  );
}
