import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { AnalyzeForm } from "@/components/seo/analyze-form";
import { canEdit } from "@/lib/domain/constants";
import { domainStats, serpLabels } from "@/lib/serp/analysis";
import { domainOf } from "@/lib/serp/normalize";
import { cn } from "@/lib/utils";
import { COUNTRIES, SERP_LANGUAGES, serpProvider } from "@/server/serp/provider";
import { itemsFor, listAnalyses, listBriefs, type SerpAnalysis } from "@/server/services/serp";
import { getProjectContext } from "@/server/services/projects";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("seo");
  return { title: t("title") };
}

const TABS = [{ id: "keywords" }, { id: "domains" }, { id: "briefs" }] as const;

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const [{ project, role }, t, fmt] = await Promise.all([getProjectContext(projectId), getT("seo"), getFormatter()]);
  const L = serpLabels(t);
  const fmtDate = (iso: string | null) => (iso ? fmt.date(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");
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
      <EmptyState icon={Search} title={t("keywords.emptyTitle")} description={t("keywords.emptyDescription")} />
    ) : (
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">{t("keywords.keyword")}</th><th className="font-medium">{t("keywords.market")}</th><th className="font-medium">{t("keywords.intent")}</th><th className="font-medium">{t("keywords.features")}</th><th className="font-medium">{t("keywords.ourSite")}</th><th className="font-medium">{t("keywords.snapshots")}</th><th className="pr-3 font-medium">{t("keywords.latest")}</th></tr></thead>
          <tbody>
            {[...groups.values()].map((list) => {
              const latest = list.filter((a) => a.status === "completed");
              const byDevice = (d: string) => latest.find((a) => a.device === d);
              const head = byDevice("desktop") ?? byDevice("mobile") ?? list[0];
              return (
                <tr key={head.id} className="border-b align-top last:border-0">
                  <td className="px-3 py-2"><Link href={`/p/${projectId}/seo/${head.id}`} className="font-medium hover:underline" dir="auto">{head.keyword}</Link>
                    <span className="mt-0.5 flex gap-2 text-[11px]">{(["desktop", "mobile"] as const).map((d) => byDevice(d) ? <Link key={d} href={`/p/${projectId}/seo/${byDevice(d)!.id}`} className="text-primary hover:underline">{t(`device.${d}`)}</Link> : null)}</span>
                  </td>
                  <td className="py-2 text-xs">{L.country(head.country)} · {L.language(head.language)}</td>
                  <td className="py-2">{head.status === "failed" ? <span className="text-xs text-destructive" title={head.error ?? ""}>{t("keywords.failed")}</span> : head.intent ? <Badge variant="outline">{t(`intent.${head.intent.primary}`)}{head.intent.secondary ? ` / ${t(`intent.${head.intent.secondary}`)}` : ""}</Badge> : "—"}</td>
                  <td className="max-w-[16rem] py-2 text-[11px] text-muted-foreground">{head.features.map((f) => L.feature(f)).join(" · ") || "—"}</td>
                  <td className="py-2 text-xs">{!ownDomain ? <span className="text-muted-foreground" title={t("keywords.addWebsite")}>{t("keywords.noWebsite")}</span> : (head as { own_position?: number | null }).own_position ? <b className="tabular-nums">#{(head as { own_position?: number | null }).own_position}</b> : head.status === "completed" ? <span className="text-muted-foreground">{t("keywords.notInResults")}</span> : "—"}</td>
                  <td className="py-2 text-xs tabular-nums">{fmt.number(list.length)}</td>
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
    body = !stats.length ? <EmptyState icon={Search} title={t("domains.emptyTitle")} description={t("domains.emptyDescription")} /> : (
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">{t("domains.domain")}</th><th className="font-medium">{t("domains.keywordsRanking")}</th><th className="font-medium" title={t("domains.inSnapshotsHint")}>{t("domains.inSnapshots")}</th><th className="font-medium">{t("domains.avgPosition")}</th><th className="font-medium">{t("domains.best")}</th><th className="pr-3 font-medium">{t("domains.keywords")}</th></tr></thead>
          <tbody>
            {stats.slice(0, 50).map((d) => (
              <tr key={d.domain} className={cn("border-b last:border-0", ownDomain && (d.domain === ownDomain || d.domain.endsWith(`.${ownDomain}`)) && "bg-primary/5")}>
                <td className="px-3 py-2 font-medium">{d.domain}{ownDomain && (d.domain === ownDomain || d.domain.endsWith(`.${ownDomain}`)) ? <Badge className="ml-2">{t("keywords.ourSite")}</Badge> : null}</td>
                <td className="py-2 tabular-nums">{d.keywords.length}</td><td className="py-2 tabular-nums">{d.appearances}/{latest.length}</td><td className="py-2 tabular-nums">{d.avgPosition != null ? fmt.number(d.avgPosition) : "—"}</td><td className="py-2 tabular-nums">#{d.best ?? "—"}</td>
                <td className="max-w-md py-2 pr-3 text-[11px] text-muted-foreground" dir="auto">{d.keywords.slice(0, 4).join(" · ")}{d.keywords.length > 4 ? ` +${d.keywords.length - 4}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">{t("domains.note")}</p>
      </div>
    );
  } else {
    const briefs = await listBriefs(projectId);
    body = !briefs.length ? <EmptyState icon={FileText} title={t("briefs.emptyTitle")} description={t("briefs.emptyDescription")} /> : (
      <ul className="grid gap-3 md:grid-cols-2">
        {briefs.map((b) => (
          <li key={b.id}><Link href={`/p/${projectId}/seo/briefs/${b.id}`} className="block rounded-xl border bg-card p-4 shadow-xs hover:shadow-sm">
            <p className="text-xs text-muted-foreground">{b.keyword} · {L.country(b.country)} · {L.language(b.language)} · {fmtDate(b.created_at)}</p>
            <p className="mt-1 font-semibold" dir="auto">{b.brief.seo_title}</p>
            <p className="text-xs text-muted-foreground">{b.brief.content_type} · {L.intent(b.brief.search_intent).toLowerCase()} · {b.draft ? t("briefs.draftWritten") : t("briefs.noDraft")}{b.content_item_id ? ` · ${t("briefs.inCalendar")}` : ""}</p>
          </Link></li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <AnalyzeForm
        projectId={projectId}
        countries={Object.keys(COUNTRIES).map((code) => ({ code, label: t("form.countryOption", { country: L.country(code), city: L.city(code) }) }))}
        languages={Object.keys(SERP_LANGUAGES).map((code) => ({ code, label: L.language(code) }))}
        configured={provider.configured()} setupHint={t("provider.setupHint")} readOnly={!canEdit(role)}
      />
      {!ownDomain ? <p className="text-xs text-muted-foreground">{t("tip")}</p> : null}
      <TabNav label={t("tabs.label")} items={TABS.map((x) => ({ key: x.id, label: t(`tabs.${x.id}`), href: `/p/${projectId}/seo?tab=${x.id}`, active: tab === x.id }))} />
      {body}
    </div>
  );
}
