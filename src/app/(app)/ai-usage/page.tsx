import Link from "next/link";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SegmentedNav } from "@/components/app/segmented-nav";
import { StatTile } from "@/components/history/charts";
import { Badge } from "@/components/ui/badge";
import { AI_TIERS, PROVIDER_LABELS, TIERED_FEATURES, featureEnvName, type AIProvider } from "@/lib/ai/models";
import { cn } from "@/lib/utils";
import { AITestPanel } from "@/components/ai/ai-test-panel";
import { canEdit } from "@/lib/domain/constants";
import { providerConfigured, providerHealth } from "@/server/ai/providers";
import { currentRoute } from "@/server/ai/run";
import { monthToDateCost, recentRuns, usageBreakdown, type UsageRow } from "@/server/services/ai-usage";
import { getActiveWorkspace, listMembers } from "@/server/services/workspaces";
import { hasPermission } from "@/server/services/team";
import { PermissionDenied } from "@/components/app/permission-denied";
import { getFormatter, getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";
import type { Formatter } from "@/i18n/format";

export async function generateMetadata() {
  const t = await getT("aiUsage");
  return { title: t("meta.title") };
}

const PERIODS = [{ id: "month" }, { id: "last_month" }, { id: "7d" }, { id: "30d" }] as const;
const PAGE = 50;
const now = () => Date.now();

function range(period: string): [Date, Date] {
  const now = new Date();
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "last_month") return [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), m0];
  if (period === "7d" || period === "30d") return [new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86400000), new Date(now.getTime() + 60000)];
  return [m0, new Date(now.getTime() + 60000)];
}
type Num = { usd: (n: number | null) => string; tokens: (n: number) => string };
function numbers(t: TFor<"aiUsage">, fmt: Formatter): Num {
  const dollars = (n: number, digits: number) => fmt.currency(n, "USD", { currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  const fixed = (n: number, digits: number) => fmt.number(n, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  return {
    usd: (n) => (n == null ? "—" : n === 0 ? dollars(0, 0) : n < 0.01 ? dollars(n, 4) : dollars(n, 2)),
    tokens: (n) => (n >= 1e6 ? t("units.millions", { value: fixed(n / 1e6, 2) }) : n >= 1e3 ? t("units.thousands", { value: fixed(n / 1e3, 1) }) : fixed(n, 0)),
  };
}
const moduleLabel = (t: TFor<"aiUsage">, m: string) => (t.has(`module.${m}`) ? t(`module.${m}` as Parameters<typeof t>[0]) : m);

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
  const [sp, t, fmt] = await Promise.all([searchParams, getT("aiUsage"), getFormatter()]);
  const num = numbers(t, fmt);
  const { usd, tokens } = num;
  const workspace = (await getActiveWorkspace())!;
  if (!(await hasPermission(workspace.id, "ai_usage.view"))) return <PermissionDenied what={t("denied")} />;
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
  const names = new Map(members.map((m) => [m.user_id, m.full_name || t("unnamedMember")]));
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
      <PageHeader title={t("title")} description={t("description", { workspace: workspace.name })} />

      <SegmentedNav label={t("periodLabel")} items={PERIODS.map((p) => ({ key: p.id, label: t(`periods.${p.id}`), href: `/ai-usage?period=${p.id}`, active: period === p.id }))} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("stats.cost")} value={usd(all?.cost ?? 0)} hint={all?.unpriced ? t("stats.unpriced", { count: all.unpriced }) : t("stats.allPriced")} />
        <StatTile label={t("stats.requests")} value={fmt.number(all?.requests ?? 0)} hint={all?.failed ? t("stats.failed", { count: all.failed }) : t("stats.noFailures")} />
        <StatTile label={t("stats.input")} value={tokens((all?.input ?? 0) + (all?.cached ?? 0))} hint={all?.cached ? t("stats.cached", { value: tokens(all.cached) }) : t("stats.noCache")} />
        <StatTile label={t("stats.output")} value={tokens(all?.output ?? 0)} hint={t("stats.outputHint")} />
      </section>

      {budget ? (
        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex justify-between text-[13px]"><span className="font-medium">{t("budget.title")}</span><span className="tabular-nums">{t("budget.progress", { spent: usd(mtd), budget: usd(budget) })}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((mtd / budget) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full", mtd >= budget ? "bg-destructive" : mtd >= budget * 0.8 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, (mtd / budget) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("budget.hint")}</p>
        </section>
      ) : <p className="text-xs text-muted-foreground">{t("budget.none")}</p>}

      {!rows.length ? <EmptyState icon={Gauge} title={t("empty.title")} description={t("empty.description")} /> : (
        <section className="grid gap-4 lg:grid-cols-2">
          <Breakdown t={t} num={num} title={t("breakdown.byFeature")} groups={groupBy(rows, (r) => r.feature)} label={(k) => { const [m, f] = k.split("."); return `${moduleLabel(t, m)} · ${f ?? ""}`; }} extra={(k) => { const r = currentRoute(k); return t("breakdown.now", { model: r.model }); }} />
          <Breakdown t={t} num={num} title={t("breakdown.byModel")} groups={groupBy(rows, (r) => `${r.provider}:${r.model}`)} label={(k) => { const [p, m] = k.split(":"); return `${m} (${PROVIDER_LABELS[p as AIProvider] ?? p})`; }} />
          <Breakdown t={t} num={num} title={t("breakdown.byMember")} groups={groupBy(rows, (r) => r.created_by ?? "")} label={(k) => names.get(k) ?? t("formerMember")} />
          <Breakdown t={t} num={num} title={t("breakdown.byDay")} groups={groupBy(rows, (r) => r.day).sort((a, b) => b.key.localeCompare(a.key))} label={(k) => fmt.day(k, { day: "numeric", month: "short" })} />
        </section>
      )}

      <section className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <p className="text-[13px] font-semibold">{t("log.title")}</p>
          <span className="text-xs text-muted-foreground">{t("log.count", { count: log.total })}</span>
          <span className="ml-auto flex gap-1 text-xs">
            {[undefined, "succeeded", "failed"].map((s) => <Link key={s ?? "all"} href={href({ status: s, page: undefined })} className={cn("rounded px-2 py-0.5", status === s ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{s ? t(`status.${s as "succeeded" | "failed"}`) : t("log.filterAll")}</Link>)}
          </span>
        </div>
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-3 py-2 font-medium">{t("log.when")}</th><th className="font-medium">{t("log.feature")}</th><th className="font-medium">{t("log.model")}</th><th className="font-medium">{t("log.member")}</th><th className="text-right font-medium">{t("log.input")}</th><th className="text-right font-medium">{t("log.output")}</th><th className="text-right font-medium">{t("log.cost")}</th><th className="px-3 font-medium">{t("log.status")}</th></tr></thead>
          <tbody>
            {log.runs.map((r) => (
              <tr key={r.id} className="border-b align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-xs">{fmt.dateTime(r.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="py-2 text-xs">{r.feature}{r.tier ? <span className="text-muted-foreground"> · {r.tier}</span> : null}</td>
                <td className="py-2 text-xs">{r.model}{r.fallback_from ? <span className="block text-muted-foreground">{t("log.fallback", { model: r.fallback_from })}</span> : null}{r.attempts > 1 ? <span className="block text-muted-foreground">{t("log.attempts", { count: r.attempts })}</span> : null}</td>
                <td className="py-2 text-xs">{r.created_by ? names.get(r.created_by) ?? t("formerMember") : "—"}</td>
                <td className="py-2 text-right text-xs tabular-nums">{tokens((r.input_tokens ?? 0) + r.cached_input_tokens)}{r.cached_input_tokens ? <span className="block text-muted-foreground">{t("log.cached", { value: tokens(r.cached_input_tokens) })}</span> : null}</td>
                <td className="py-2 text-right text-xs tabular-nums">{tokens(r.output_tokens ?? 0)}</td>
                <td className="py-2 text-right text-xs tabular-nums">{usd(r.cost_usd)}</td>
                <td className="px-3 py-2 text-xs">
                  {/* a request still "running" after 15 minutes was cut off (server restart, timeout) and never recorded its end */}
                  <Badge variant={r.status === "failed" ? "destructive" : r.status === "running" ? "secondary" : "outline"}>{t(`status.${r.status === "running" && Date.parse(r.created_at) < renderedAt - 15 * 60_000 ? "interrupted" : r.status}`)}</Badge>
                  {r.duration_ms != null ? <span className="ml-1 text-muted-foreground">{t("units.seconds", { value: fmt.number(r.duration_ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }) })}</span> : null}
                  {r.error ? <span className="mt-0.5 block max-w-xs text-destructive">{r.error}</span> : null}
                </td>
              </tr>
            ))}
            {!log.runs.length ? <tr><td colSpan={8} className="px-3 py-4 text-xs text-muted-foreground">{t("log.empty")}</td></tr> : null}
          </tbody>
        </table>
        {log.total > PAGE ? (
          <div className="flex justify-between border-t px-4 py-2 text-xs">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="text-primary hover:underline">{t("log.newer")}</Link> : <span />}
            <span className="text-muted-foreground">{t("log.page", { page, total: Math.ceil(log.total / PAGE) })}</span>
            {page * PAGE < log.total ? <Link href={href({ page: page + 1 })} className="text-primary hover:underline">{t("log.older")}</Link> : <span />}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-[13px] font-semibold">{t("routing.title")}</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {(Object.keys(configured) as AIProvider[]).map((p) => <span key={p} className={configured[p] ? "text-success" : "text-muted-foreground"}>{PROVIDER_LABELS[p]}: {configured[p] ? t("routing.keySet") : t("routing.notConfigured", { env: p === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY" })}</span>)}
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {AI_TIERS.map((tierId) => {
              const sample = TIERED_FEATURES.find(([, tier]) => tier === tierId)?.[0] ?? "strategy.positioning";
              const r = currentRoute(sample);
              return (
                <tr key={tierId} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{t(`tier.${tierId}`)}</td>
                  <td className="py-1.5 pr-3 font-medium">{r.model}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">{tierId === "standard" ? t("routing.standardFeatures") : TIERED_FEATURES.filter(([, tier]) => tier === tierId).map(([f]) => f).join(", ")}{r.fallback ? t("routing.fallsBack", { model: r.fallback.model }) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <AITestPanel
          readOnly={!canEdit(workspace.role)}
          health={(Object.keys(configured) as AIProvider[]).flatMap((p) => { const h = providerHealth(p); return h ? [{ provider: PROVIDER_LABELS[p], label: t(`kind.${h.kind}`), until: fmt.time(h.until, { hour: "2-digit", minute: "2-digit" }) }] : []; })}
        />
        <p className="text-xs text-muted-foreground">{t("routing.serverSettings", { example: featureEnvName("serp.draft") })}</p>
      </section>
    </div>
  );
}

function Breakdown({ t, num, title, groups, label, extra }: { t: TFor<"aiUsage">; num: Num; title: string; groups: Group[]; label: (k: string) => string; extra?: (k: string) => string }) {
  const { usd, tokens } = num;
  const max = Math.max(...groups.map((g) => g.cost), 0);
  return (
    <section className="scrollbar-thin overflow-x-auto rounded-xl border bg-card shadow-xs">
      <p className="border-b px-4 py-3 text-[13px] font-semibold">{title}</p>
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-1.5 font-medium" /><th className="text-right font-medium">{t("breakdown.requests")}</th><th className="text-right font-medium">{t("breakdown.tokens")}</th><th className="px-4 text-right font-medium">{t("breakdown.cost")}</th></tr></thead>
        <tbody>
          {groups.slice(0, 12).map((g) => (
            <tr key={g.key} className="border-t">
              <td className="px-4 py-1.5">
                <span className="block">{label(g.key)}</span>
                {extra ? <span className="block text-[11px] text-muted-foreground">{extra(g.key)}</span> : null}
                {max > 0 ? <span className="mt-1 block h-1 rounded-full bg-primary/70" style={{ width: `${Math.max(2, (g.cost / max) * 100)}%` }} aria-hidden /> : null}
              </td>
              <td className="text-right text-xs tabular-nums">{g.requests}{g.failed ? <span className="text-destructive"> {t("breakdown.failed", { count: g.failed })}</span> : null}</td>
              <td className="text-right text-xs tabular-nums">{tokens(g.input + g.cached)} / {tokens(g.output)}</td>
              <td className="px-4 text-right text-xs tabular-nums">{usd(g.cost)}{g.unpriced ? "*" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.some((g) => g.unpriced) ? <p className="border-t px-4 py-1.5 text-[11px] text-muted-foreground">{t("breakdown.unpricedNote")}</p> : null}
    </section>
  );
}
