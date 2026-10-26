import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Compare, type Entity } from "@/components/competitors/compare";
import { CompetitorList } from "@/components/competitors/competitor-list";
import type { ProviderStatus } from "@/components/competitors/competitor-form";
import { Gaps, type GapReport } from "@/components/competitors/gaps";
import { Library } from "@/components/competitors/library";
import { canEdit, type Platform } from "@/lib/domain/constants";
import { summarize, type AnalysisPost } from "@/lib/competitors/analysis";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { isAIConfigured } from "@/server/ai/client";
import { maybeAutoCollect } from "@/server/competitors/start";
import { availabilityFor } from "@/server/competitors/providers";
import { listCompetitors, postsForAnalysis, projectCredentials, queryPosts } from "@/server/services/competitors";
import { loadHistoryAnalysis } from "@/server/services/history-analysis";
import { listOpportunities } from "@/server/services/opportunities";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { getStrategyBundle } from "@/server/services/strategy";

export const metadata = { title: "Competitor Intelligence" };

const TABS = [
  { id: "competitors", label: "Competitors" },
  { id: "library", label: "Content library" },
  { id: "compare", label: "Compare" },
  { id: "gaps", label: "Gaps & ideas" },
] as const;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const daysAgo = (days: number) => Date.now() - days * 86400_000;

export default async function Page({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const [user, { project, role }] = await Promise.all([requireUser(), getProjectContext(projectId)]);
  const tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as (typeof TABS)[number]["id"]) : "competitors";
  const editable = canEdit(role);
  const competitors = await listCompetitors(projectId);
  const tz = project.timezone || "Africa/Tunis";

  // provider availability per platform (no secret leaves the server)
  const creds = await projectCredentials(projectId);
  const providers: ProviderStatus = Object.fromEntries((["instagram", "facebook", "youtube", "x", "tiktok", "linkedin", "threads", "pinterest"] as Platform[]).map((p) => {
    const a = availabilityFor(p, creds);
    return [p, { ok: a.ok, reason: a.ok ? undefined : a.reason, provider: a.provider }];
  }));
  if (tab === "competitors") await maybeAutoCollect(projectId, competitors, editable, user.id);

  let body: React.ReactNode = null;
  if (tab === "competitors") {
    body = <CompetitorList projectId={projectId} competitors={competitors} providers={providers} readOnly={!editable} />;
  } else if (tab === "library") {
    const filters = { competitor: one(sp.competitor), platform: one(sp.platform), format: one(sp.format), from: one(sp.from), to: one(sp.to), q: one(sp.q), min: one(sp.min), sort: one(sp.sort) };
    const [res, formatsRes] = await Promise.all([
      queryPosts(projectId, { ...filters, search: filters.q, minEngagement: Number(filters.min) || undefined, sort: (filters.sort || "recent") as "recent", page: Number(one(sp.page)) || 1 }),
      (await createClient()).from("competitor_content_items").select("format").eq("project_id", projectId).not("format", "is", null).limit(2000),
    ]);
    const formats = [...new Set((formatsRes.data ?? []).map((r) => r.format as string))].sort();
    body = <Library projectId={projectId} posts={res.posts} total={res.total} page={res.page} size={res.size} competitors={competitors.map((c) => ({ id: c.id, name: c.name }))} formats={formats} filters={filters} />;
  } else if (tab === "compare") {
    const days = [30, 90, 180, 365].includes(Number(one(sp.days))) ? Number(one(sp.days)) : 90;
    const withPosts = competitors.filter((c) => c.competitor_channels.some((ch) => ch.posts_collected));
    const selected = one(sp.c) ? one(sp.c).split(",").filter((id) => withPosts.some((c) => c.id === id)) : withPosts.slice(0, 3).map((c) => c.id);
    const [posts, history] = await Promise.all([postsForAnalysis(projectId, selected, days), loadHistoryAnalysis(projectId)]);
    const since = daysAgo(days);
    const own: AnalysisPost[] = history.items
      .filter((i) => { const d = i.published_at ?? i.actual_publication_date ?? i.publication_date; return d && Date.parse(d) >= since; })
      .map((i) => ({ id: i.id, account: `own:${i.platform}`, platform: i.platform, published_at: i.published_at ?? i.actual_publication_date ?? i.publication_date, format: i.format, caption: i.caption ?? i.title, likes: i.likes ?? null, comments: i.comments ?? null, shares: i.shares ?? null, saves: i.saves ?? null, views: i.views ?? null, followers: null }));
    const entities: Entity[] = [
      { id: "own", name: project.name, own: true, followers: null, summary: summarize(own, { tz, periodDays: days, ignore: [project.name, history.brand?.brand_name ?? ""] }) },
      ...selected.map((id) => {
        const c = competitors.find((x) => x.id === id)!;
        const list = posts.filter((p) => p.competitor_id === id).map((p): AnalysisPost => ({ id: p.id, account: p.channel_id ?? id, platform: p.platform, published_at: p.published_at, format: p.format, caption: p.caption, hashtags: p.hashtags, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, views: p.views, followers: p.followers_at_collection }));
        return { id, name: c.name, own: false, followers: c.competitor_channels.reduce((t, ch) => t + (ch.followers_count ?? 0), 0) || null, summary: summarize(list, { tz, periodDays: days, ignore: [c.name, ...c.competitor_channels.flatMap((ch) => [ch.display_name ?? "", ch.handle ?? ""])] }) };
      }),
    ];
    body = <Compare entities={entities} competitors={withPosts.map((c) => ({ id: c.id, name: c.name }))} selected={selected} days={days} />;
  } else {
    const db = await createClient();
    const [{ data: report }, opps, bundle] = await Promise.all([
      db.from("analysis_reports").select("id, title, created_at, scope, result").eq("project_id", projectId).eq("kind", "comparison").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      listOpportunities(projectId),
      getStrategyBundle(projectId),
    ]);
    const created: Record<number, string> = {};
    for (const o of opps) {
      const i = (o.focus as { idea_index?: number })?.idea_index;
      if (report && o.analysis_report_id === report.id && typeof i === "number") created[i] = o.id;
    }
    body = (
      <Gaps
        projectId={projectId}
        report={(report as GapReport | null) ?? null}
        created={created}
        competitors={competitors.map((c) => ({ id: c.id, name: c.name, posts: c.competitor_channels.reduce((t, ch) => t + ch.posts_collected, 0) }))}
        pillars={bundle.pillars.map((p) => ({ id: p.id, name: p.name }))}
        readOnly={!editable}
        aiEnabled={isAIConfigured()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Competitor Intelligence" description="Track what competitors publish through official data sources, compare it with your own results and turn the gaps into original content opportunities." />
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Competitor Intelligence sections">
        {TABS.map((t) => (
          <Link key={t.id} href={`/p/${projectId}/competitors?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
