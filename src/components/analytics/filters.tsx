"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FUNNEL_STAGES } from "@/lib/domain/constants";
import { STAGES } from "@/lib/production/model";
import { CONTENT_TYPES, contentTypeLabel, platformLabelOf, stageLabelOf } from "@/lib/analytics/compute";
import { useT } from "@/i18n/client";

const RANGES = [
  { key: "7d", label: "last7" }, { key: "30d", label: "last30" }, { key: "90d", label: "last90" },
  { key: "month", label: "month" }, { key: "quarter", label: "quarter" }, { key: "custom", label: "custom" },
] as const;
const DETAIL_KEYS = ["pillar", "funnel", "platform", "format", "campaign", "status", "assignee", "account"];
const KEYS = ["range", "from", "to", "compare", "pillar", "funnel", "platform", "format", "campaign", "status", "assignee", "account"];

/** Shared filters, kept in the URL so the page, the CSV export and the report all read the same selection. */
export function AnalyticsFilters({
  preset, period, compare, filters, options, simple = false,
}: {
  preset: string; period: { from: string; to: string }; compare: boolean; simple?: boolean;
  filters: Record<string, string>;
  options: { pillars: { id: string; name: string }[]; campaigns: { id: string; name: string }[]; platforms: string[]; people: { user_id: string; name: string }[]; accounts?: { id: string; label: string }[] };
}) {
  const t = useT("analytics");
  const tc = useT("common");
  const td = useT("domain");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const active = KEYS.some((k) => sp.get(k));
  const detailCount = DETAIL_KEYS.filter((k) => sp.get(k)).length;
  const clear = () => set(Object.fromEntries(DETAIL_KEYS.map((k) => [k, null])));

  const select = (key: string, label: string, opts: { value: string; label: string }[], all = tc("states.all")) => (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect className="h-8 text-[13px]" value={filters[key] ?? ""} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );

  return (
    <section aria-label={t("filters.label")} aria-busy={pending} className="rounded-xl border bg-card p-3 shadow-xs print:hidden">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("filters.period")}
          <NativeSelect className="h-8 text-[13px]" value={preset} onChange={(e) => set(e.target.value === "custom" ? { range: "custom", from: period.from, to: period.to } : { range: e.target.value, from: null, to: null })}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{t(`filters.ranges.${r.label}`)}</option>)}
          </NativeSelect>
        </label>
        {preset === "custom" ? (
          <>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">{t("filters.from")}<Input type="date" className="h-8 text-[13px]" defaultValue={period.from} max={period.to} onChange={(e) => e.target.value.length === 10 && set({ range: "custom", from: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">{t("filters.to")}<Input type="date" className="h-8 text-[13px]" defaultValue={period.to} min={period.from} onChange={(e) => e.target.value.length === 10 && set({ range: "custom", to: e.target.value })} /></label>
          </>
        ) : null}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("filters.compareWith")}
          <NativeSelect className="h-8 text-[13px]" value={compare ? "previous" : "none"} onChange={(e) => set({ compare: e.target.value === "none" ? "none" : null })}>
            <option value="previous">{t("filters.previousPeriod")}</option>
            <option value="none">{t("filters.noComparison")}</option>
          </NativeSelect>
        </label>
        {simple ? null : (<>
        {select("pillar", t("filters.pillar"), [...options.pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: t("labels.noPillar") }])}
        {select("funnel", t("filters.funnelStage"), FUNNEL_STAGES.map((s) => ({ value: s, label: td(`funnel.${s}`) })))}
        {select("platform", t("filters.platform"), options.platforms.map((p) => ({ value: p, label: platformLabelOf(td, p) })))}
        {select("format", t("filters.contentType"), CONTENT_TYPES.map((x) => ({ value: x, label: contentTypeLabel(t, x) })))}
        {options.campaigns.length ? select("campaign", t("filters.campaign"), options.campaigns.map((c) => ({ value: c.id, label: c.name }))) : null}
        {select("status", t("filters.productionStage"), STAGES.map((s) => ({ value: s, label: stageLabelOf(t, s) })))}
        {options.accounts && options.accounts.length > 1 ? select("account", t("filters.socialAccount"), options.accounts.map((a) => ({ value: a.id, label: a.label })), t("filters.allAccounts")) : null}
        {options.people.length > 1 ? select("assignee", t("filters.collaborator"), [...options.people.map((p) => ({ value: p.user_id, label: p.name })), { value: "none", label: t("labels.unassigned") }], t("filters.everyone")) : null}
        </>)}
        {simple && detailCount ? (
          <div className="col-span-2 flex items-end gap-2 text-[13px] text-muted-foreground">
            <span>{t("filters.detailApplied", { count: detailCount })}</span>
            <Button type="button" variant="link" size="sm" className="h-8 px-0" onClick={clear}>{tc("actions.clear")}</Button>
          </div>
        ) : null}
        <div className="flex items-end">
          <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!active || pending} onClick={() => start(() => router.replace(pathname, { scroll: false }))}>
            <RotateCcw className="size-3.5" /> {tc("actions.reset")}
          </Button>
        </div>
      </div>
    </section>
  );
}
