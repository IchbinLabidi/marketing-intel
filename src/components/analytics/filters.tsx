"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FUNNEL_LABELS, FUNNEL_STAGES, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { STAGE_LABELS, STAGES } from "@/lib/production/model";

const RANGES = [
  { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" }, { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" }, { key: "quarter", label: "This quarter" }, { key: "custom", label: "Custom" },
];
const TYPES = ["Post", "Carousel", "Reel", "Story", "Video", "Article", "Other"];
const DETAIL_KEYS = ["pillar", "funnel", "platform", "format", "campaign", "status", "assignee"];
const KEYS = ["range", "from", "to", "compare", "pillar", "funnel", "platform", "format", "campaign", "status", "assignee"];

/** Shared filters, kept in the URL so the page, the CSV export and the report all read the same selection. */
export function AnalyticsFilters({
  preset, period, compare, filters, options, simple = false,
}: {
  preset: string; period: { from: string; to: string }; compare: boolean; simple?: boolean;
  filters: Record<string, string>;
  options: { pillars: { id: string; name: string }[]; campaigns: { id: string; name: string }[]; platforms: string[]; people: { user_id: string; name: string }[] };
}) {
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

  const select = (key: string, label: string, opts: { value: string; label: string }[], all = "All") => (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect className="h-8 text-[13px]" value={filters[key] ?? ""} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </label>
  );

  return (
    <section aria-label="Filters" aria-busy={pending} className="rounded-xl border bg-card p-3 shadow-xs print:hidden">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Period
          <NativeSelect className="h-8 text-[13px]" value={preset} onChange={(e) => set(e.target.value === "custom" ? { range: "custom", from: period.from, to: period.to } : { range: e.target.value, from: null, to: null })}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </NativeSelect>
        </label>
        {preset === "custom" ? (
          <>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">From<Input type="date" className="h-8 text-[13px]" defaultValue={period.from} max={period.to} onChange={(e) => e.target.value.length === 10 && set({ range: "custom", from: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">To<Input type="date" className="h-8 text-[13px]" defaultValue={period.to} min={period.from} onChange={(e) => e.target.value.length === 10 && set({ range: "custom", to: e.target.value })} /></label>
          </>
        ) : null}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Compare with
          <NativeSelect className="h-8 text-[13px]" value={compare ? "previous" : "none"} onChange={(e) => set({ compare: e.target.value === "none" ? "none" : null })}>
            <option value="previous">Previous period</option>
            <option value="none">No comparison</option>
          </NativeSelect>
        </label>
        {simple ? null : (<>
        {select("pillar", "Pillar", [...options.pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No pillar" }])}
        {select("funnel", "Funnel stage", FUNNEL_STAGES.map((s) => ({ value: s, label: FUNNEL_LABELS[s] })))}
        {select("platform", "Platform", options.platforms.map((p) => ({ value: p, label: PLATFORM_LABELS[p as Platform] ?? p })))}
        {select("format", "Content type", TYPES.map((t) => ({ value: t, label: t })))}
        {options.campaigns.length ? select("campaign", "Campaign", options.campaigns.map((c) => ({ value: c.id, label: c.name }))) : null}
        {select("status", "Production stage", STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })))}
        {options.people.length > 1 ? select("assignee", "Collaborator", [...options.people.map((p) => ({ value: p.user_id, label: p.name })), { value: "none", label: "Unassigned" }], "Everyone") : null}
        </>)}
        {simple && detailCount ? (
          <div className="col-span-2 flex items-end gap-2 text-[13px] text-muted-foreground">
            <span>{detailCount} detailed filter{detailCount === 1 ? "" : "s"} applied (set in Expert view).</span>
            <Button type="button" variant="link" size="sm" className="h-8 px-0" onClick={clear}>Clear</Button>
          </div>
        ) : null}
        <div className="flex items-end">
          <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!active || pending} onClick={() => start(() => router.replace(pathname, { scroll: false }))}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </div>
      </div>
    </section>
  );
}
