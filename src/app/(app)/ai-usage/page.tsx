import Link from "next/link";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SegmentedNav } from "@/components/app/segmented-nav";
import { StatTile } from "@/components/history/charts";
import { Badge } from "@/components/ui/badge";
import { AI_TIERS, MODULE_LABELS, PROVIDER_LABELS, TIER_LABELS, TIERED_FEATURES, featureEnvName, type AIProvider } from "@/lib/ai/models";
import { cn } from "@/lib/utils";
import { AITestPanel } from "@/components/ai/ai-test-panel";
import { KIND_LABELS } from "@/lib/ai/errors";
import { canEdit } from "@/lib/domain/constants";
import { providerConfigured, providerHealth } from "@/server/ai/providers";
import { currentRoute } from "@/server/ai/run";
import { monthToDateCost, recentRuns, usageBreakdown, type UsageRow } from "@/server/services/ai-usage";
import { getActiveWorkspace, listMembers } from "@/server/services/workspaces";
import { hasPermission } from "@/server/services/team";
import { PermissionDenied } from "@/components/app/permission-denied";

export const metadata = { title: "AI usage" };

const PERIODS = [
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;
const PAGE = 50;
const now = () => Date.now();

function range(period: string): [Date, Date] {
  const now = new Date();
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "last_month") return [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), m0];
  if (period === "7d" || period === "30d") return [new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86400000), new Date(now.getTime() + 60000)];
  return [m0, new Date(now.getTime() + 60000)];
}
const usd = (n: number | null) => (n == null ? "—" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

type Group = { key: string; requests: number; failed: number; input: number; cached: number; output: number; cost: number; unpriced: number };
function groupBy(rows: UsageRow[], key: (r: UsageRow) => string): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, requests: 0, failed: 0, input: 0, cached: 0, output: 0, cost: 0, unpriced: 0 };
    g.requests += r.requests; g.failed += r.status === "failed" ? r.requests : 0;
    g.input += r.input_tokens; g.cached += r.cached_input_tokens; g.output += r.output_tokens; g.cost += r.cost_usd; g.unpriced += r.unpriced;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
}

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const workspace = (await getActiveWorkspace())!;
  if (!(await hasPermission(workspace.id, "ai_usage.view"))) return <PermissionDenied what="AI usage" />;
  const period = PERIODS.some((p) => p.id === sp.period) ? sp.period! : "month";
  const [from, to] = range(period);
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status === "failed" || sp.status === "succeeded" ? sp.status : undefined;
  const [rows, log, members, mtd] = await Promise.all([
    usageBreakdown(workspace.id, from, to),
    recentRuns(workspace.id, from, to, { status, limit: PAGE, offset: (page - 1) * PAGE }),
    listMembers(workspace.id),
    monthToDateCost(workspace.id),
  ]);
  const names = new Map(members.map((m) => [m.user_id, m.full_name || "Unnamed member"]));
  const renderedAt = now();
  const all = groupBy(rows, () => "all")[0];
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD) || null;
  const configured: Record<AIProvider, boolean> = { gemini: providerConfigured("gemini"), anthropic: providerConfigured("anthropic") };
  const href = (p: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams(Object.entries({ period, status, ...p }).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
    return `/ai-usage?${q}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="AI usage" description={`AI requests, tokens and estimated cost for ${workspace.name}. Costs are estimates from public list prices; your provider invoice is the reference.`} />

      <SegmentedNav label="Period" items={PERIODS.map((p) => ({ key: p.id, label: p.label, href: `/ai-usage?period=${p.id}`, active: period === p.id }))} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Estimated cost" value={usd(all?.cost ?? 0)} hint={all?.unpriced ? `${all.unpriced} request(s) without an estimate (logged before cost tracking, or model price unknown)` : "All requests have an estimate"} />
        <StatTile label="Requests" value={(all?.requests ?? 0).toLocaleString("en")} hint={all?.failed ? `${all.failed} failed` : "No failures"} />
        <StatTile label="Input tokens" value={tokens((all?.input ?? 0) + (all?.cached ?? 0))} hint={all?.cached ? `${tokens(all.cached)} served from cache` : "No cache hits yet"} />
        <StatTile label="Output tokens" value={tokens(all?.output ?? 0)} hint="Includes the models' thinking tokens" />
      </section>

      {budget ? (
        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex justify-between text-[13px]"><span className="font-medium">Monthly budget</span><span className="tabular-nums">{usd(mtd)} of {usd(budget)} this month</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((mtd / budget) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full", mtd >= budget ? "bg-destructive" : mtd >= budget * 0.8 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, (mtd / budget) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">AI requests stop for this workspace when the estimated spend reaches the budget (AI_MONTHLY_BUDGET_USD).</p>
        </section>
      ) : <p className="text-xs text-muted-foreground">No monthly budget set. Set AI_MONTHLY_BUDGET_USD on the server to stop AI requests once a workspace&apos;s estimated monthly spend reaches it.</p>}

      {!rows.length ? <EmptyState icon={Gauge} title="No AI requests in this period" description="Every AI action (strategy suggestions, analyses, briefs, content) is logged here with its tokens and estimated cost." /> : (
        <section className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By feature" groups={groupBy(rows, (r) => r.feature)} label={(k) => { const [m, f] = k.split("."); return `${MODULE_LABELS[m] ?? m} · ${f ?? ""}`; }} extra={(k) => { const r = currentRoute(k); return `now: ${r.model}`; }} />
          <Breakdown title="By model" groups={groupBy(rows, (r) => `${r.provider}:${r.model}`)} label={(k) => { const [p, m] = k.split(":"); return `${m} (${PROVIDER_LABELS[p as AIProvider] ?? p})`; }} />
          <Breakdown title="By member" groups={groupBy(rows, (r) => r.created_by ?? "")} label={(k) => names.get(k) ?? "Former member"} />
          <Breakdown title="By day" groups={groupBy(rows, (r) => r.day).sort((a, b) => b.key.localeCompare(a.key))} label={(k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <p className="text-[13px] font-semibold">Request log</p>
          <span className="text-xs text-muted-foreground">{log.total} request(s)</span>
          <span className="ml-auto flex gap-1 text-xs">
            {[undefined, "succeeded", "failed"].map((s) => <Link key={s ?? "all"} href={href({ status: s, page: undefined })} className={cn("rounded px-2 py-0.5", status === s ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{s ?? "all"}</Link>)}
          </span>
        </div>
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">When</th><th className="font-medium">Feature</th><th className="font-medium">Model</th><th className="font-medium">Member</th><th className="text-right font-medium">Input</th><th className="text-right font-medium">Output</th><th className="text-right font-medium">Cost</th><th className="px-3 font-medium">Status</th></tr></thead>
          <tbody>
            {log.runs.map((r) => (
              <tr key={r.id} className="border-b align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="py-2 text-xs">{r.feature}{r.tier ? <span className="text-muted-foreground"> · {r.tier}</span> : null}</td>
                <td className="py-2 text-xs">{r.model}{r.fallback_from ? <span className="block text-muted-foreground">after {r.fallback_from} failed</span> : null}{r.attempts > 1 ? <span className="block text-muted-foreground">{r.attempts} attempts</span> : null}</td>
                <td className="py-2 text-xs">{r.created_by ? names.get(r.created_by) ?? "Former member" : "—"}</td>
                <td className="py-2 text-right text-xs tabular-nums">{tokens((r.input_tokens ?? 0) + r.cached_input_tokens)}{r.cached_input_tokens ? <span className="block text-muted-foreground">{tokens(r.cached_input_tokens)} cached</span> : null}</td>
                <td className="py-2 text-right text-xs tabular-nums">{tokens(r.output_tokens ?? 0)}</td>
                <td className="py-2 text-right text-xs tabular-nums">{usd(r.cost_usd)}</td>
                <td className="px-3 py-2 text-xs">
                  {/* a request still "running" after 15 minutes was cut off (server restart, timeout) and never recorded its end */}
                  <Badge variant={r.status === "failed" ? "destructive" : r.status === "running" ? "secondary" : "outline"}>{r.status === "running" && Date.parse(r.created_at) < renderedAt - 15 * 60_000 ? "interrupted" : r.status}</Badge>
                  {r.duration_ms != null ? <span className="ml-1 text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span> : null}
                  {r.error ? <span className="mt-0.5 block max-w-xs text-destructive">{r.error}</span> : null}
                </td>
              </tr>
            ))}
            {!log.runs.length ? <tr><td colSpan={8} className="px-3 py-4 text-xs text-muted-foreground">No requests.</td></tr> : null}
          </tbody>
        </table>
        {log.total > PAGE ? (
          <div className="flex justify-between border-t px-4 py-2 text-xs">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="text-primary hover:underline">← Newer</Link> : <span />}
            <span className="text-muted-foreground">Page {page} of {Math.ceil(log.total / PAGE)}</span>
            {page * PAGE < log.total ? <Link href={href({ page: page + 1 })} className="text-primary hover:underline">Older →</Link> : <span />}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-[13px] font-semibold">Model routing</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {(Object.keys(configured) as AIProvider[]).map((p) => <span key={p} className={configured[p] ? "text-success" : "text-muted-foreground"}>{PROVIDER_LABELS[p]}: {configured[p] ? "API key set" : `not configured (${p === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"})`}</span>)}
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {AI_TIERS.map((t) => {
              const sample = TIERED_FEATURES.find(([, tier]) => tier === t)?.[0] ?? "strategy.positioning";
              const r = currentRoute(sample);
              return (
                <tr key={t} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{TIER_LABELS[t]}</td>
                  <td className="py-1.5 pr-3 font-medium">{r.model}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">{t === "standard" ? "every feature not listed below" : TIERED_FEATURES.filter(([, tier]) => tier === t).map(([f]) => f).join(", ")}{r.fallback ? ` · falls back to ${r.fallback.model}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <AITestPanel
          readOnly={!canEdit(workspace.role)}
          health={(Object.keys(configured) as AIProvider[]).flatMap((p) => { const h = providerHealth(p); return h ? [{ provider: PROVIDER_LABELS[p], label: KIND_LABELS[h.kind], until: new Date(h.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }] : []; })}
        />
        <p className="text-xs text-muted-foreground">Server settings: AI_DEFAULT_PROVIDER, AI_DEFAULT_MODEL, AI_TIER_LIGHT / AI_TIER_STANDARD / AI_TIER_PREMIUM, and per task {featureEnvName("serp.draft")}=anthropic:claude-sonnet-5-5 (or per module, e.g. AI_ROUTE_PRODUCTION=gemini).</p>
      </section>
    </div>
  );
}

function Breakdown({ title, groups, label, extra }: { title: string; groups: Group[]; label: (k: string) => string; extra?: (k: string) => string }) {
  const max = Math.max(...groups.map((g) => g.cost), 0);
  return (
    <section className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
      <p className="border-b px-4 py-3 text-[13px] font-semibold">{title}</p>
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-1.5 font-medium" /><th className="text-right font-medium">Requests</th><th className="text-right font-medium">Tokens in / out</th><th className="px-4 text-right font-medium">Cost</th></tr></thead>
        <tbody>
          {groups.slice(0, 12).map((g) => (
            <tr key={g.key} className="border-t">
              <td className="px-4 py-1.5">
                <span className="block">{label(g.key)}</span>
                {extra ? <span className="block text-[11px] text-muted-foreground">{extra(g.key)}</span> : null}
                {max > 0 ? <span className="mt-1 block h-1 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (g.cost / max) * 100)}%` }} aria-hidden /> : null}
              </td>
              <td className="text-right text-xs tabular-nums">{g.requests}{g.failed ? <span className="text-destructive"> ({g.failed} failed)</span> : null}</td>
              <td className="text-right text-xs tabular-nums">{tokens(g.input + g.cached)} / {tokens(g.output)}</td>
              <td className="px-4 text-right text-xs tabular-nums">{usd(g.cost)}{g.unpriced ? "*" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.some((g) => g.unpriced) ? <p className="border-t px-4 py-1.5 text-[11px] text-muted-foreground">* includes requests without a cost estimate</p> : null}
    </section>
  );
}
