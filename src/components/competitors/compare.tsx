"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Loader2, Minus } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import type { Summary } from "@/lib/competitors/analysis";
import { cn } from "@/lib/utils";
import { Bars, fmt, MetricLegend } from "./ui";

export type Entity = { id: string; name: string; own: boolean; followers: number | null; summary: Summary };

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const COLORS = ["bg-primary", "bg-chart-b", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-sky-500"];

/** Facts derived from both summaries with the same method; never AI-written. */
function findings(ours: Entity, others: Entity[]) {
  const out: { side: "them" | "us" | "missing"; text: string }[] = [];
  for (const c of others) {
    const s = c.summary;
    if (ours.summary.perWeek != null && s.perWeek != null && s.perWeek >= ours.summary.perWeek * 1.5 && s.posts >= 10) out.push({ side: "them", text: `${c.name} posts ${s.perWeek}/week vs ${ours.summary.perWeek} for us.` });
    if (ours.summary.perWeek != null && s.perWeek != null && ours.summary.perWeek >= s.perWeek * 1.5 && ours.summary.posts >= 10) out.push({ side: "us", text: `We post ${ours.summary.perWeek}/week vs ${s.perWeek} for ${c.name}.` });
    for (const f of s.byFormat) {
      const mine = ours.summary.byFormat.find((x) => x.key === f.key);
      if ((f.medianLift ?? 0) >= 1.3 && f.n >= 5 && (!mine || mine.share < 10)) out.push({ side: "them", text: `${c.name}'s ${f.label} posts do ×${f.medianLift} their own median (${f.n} posts); ${f.label} is ${mine ? `${mine.share}%` : "absent from"} our mix.` });
    }
    for (const f of ours.summary.byFormat) {
      const theirs = s.byFormat.find((x) => x.key === f.key);
      if ((f.medianLift ?? 0) >= 1.3 && f.n >= 5 && (!theirs || theirs.share < 10)) out.push({ side: "us", text: `Our ${f.label} posts do ×${f.medianLift} our median (${f.n} posts); ${c.name} ${theirs ? `uses it for ${theirs.share}%` : "doesn't use it"}.` });
    }
    const ourTopics = new Set(ours.summary.topics.map((t) => t.key));
    const theirTopics = new Set(s.topics.map((t) => t.key));
    const theyOnly = s.topics.filter((t) => !ourTopics.has(t.key) && (t.medianLift ?? 0) >= 1.2).slice(0, 3);
    if (theyOnly.length) out.push({ side: "them", text: `${c.name} gets above-median engagement on topics we don't post about: ${theyOnly.map((t) => `“${t.label}” (×${t.medianLift}, ${t.n} posts)`).join(", ")}.` });
    const weOnly = ours.summary.topics.filter((t) => !theirTopics.has(t.key)).slice(0, 4);
    if (weOnly.length) out.push({ side: "missing", text: `${c.name} doesn't cover: ${weOnly.map((t) => `“${t.label}”`).join(", ")} (topics we post about).` });
  }
  return out;
}

export function Compare({ entities, competitors, selected, days }: { entities: Entity[]; competitors: { id: string; name: string }[]; selected: string[]; days: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", "compare");
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    start(() => router.push(`${pathname}?${next}`, { scroll: false }));
  };
  const toggle = (id: string) => go({ c: (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(",") || null });
  const ours = entities.find((e) => e.own)!;
  const others = entities.filter((e) => !e.own);
  const facts = others.length ? findings(ours, others) : [];
  const kpis: { label: string; hint: string; get: (e: Entity) => number | null; suffix?: string }[] = [
    { label: "Posts in period", hint: "Collected (competitors) or synced (us) posts in the period", get: (e) => e.summary.posts },
    { label: "Posts per week", hint: "Posts ÷ weeks covered", get: (e) => e.summary.perWeek },
    { label: "Median engagement per post", hint: "Calculated: likes + comments + shares + saves available", get: (e) => median(e.summary.byPlatform.map((p) => p.medianEngagement ?? 0).filter(Boolean)) },
    { label: "Median rate per follower", hint: "Calculated: engagement ÷ followers at collection (competitors only; our follower count isn't stored)", get: (e) => median(e.summary.byPlatform.map((p) => p.medianRate).filter((x): x is number => x != null)), suffix: "%" },
    { label: "Posts at 2× their own median", hint: "Outliers vs the account's own baseline (accounts with 10+ posts)", get: (e) => e.summary.outliers },
    { label: "Formats used (3+ posts)", hint: "Content diversity", get: (e) => e.summary.byFormat.length },
    { label: "Recurring topics (3+ posts)", hint: "Content words used in 3 or more posts", get: (e) => e.summary.topics.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
        <span className="text-xs font-medium">Compare us with</span>
        {competitors.map((c) => (
          <button key={c.id} type="button" aria-pressed={selected.includes(c.id)} onClick={() => toggle(c.id)} className={cn("rounded-md border px-2 py-1 text-xs", selected.includes(c.id) ? "border-primary/50 bg-primary/10" : "text-muted-foreground hover:bg-accent")}>{c.name}</button>
        ))}
        <NativeSelect value={String(days)} onChange={(e) => go({ days: e.target.value })} className="ml-auto h-8 w-40 text-[13px]" aria-label="Period">
          <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option>
        </NativeSelect>
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Calculated from collected posts</th>{entities.map((e, k) => <th key={e.id} className="px-2 py-2 text-right font-medium"><span className={cn("mr-1 inline-block size-2 rounded-full", COLORS[k % COLORS.length])} />{e.name}</th>)}</tr></thead>
          <tbody>
            {kpis.map((k) => (
              <tr key={k.label} className="border-b last:border-0" title={k.hint}>
                <td className="px-3 py-2">{k.label}</td>
                {entities.map((e) => { const v = k.get(e); return <td key={e.id} className="px-2 py-2 text-right tabular-nums">{v == null ? "—" : `${fmt(v)}${k.suffix ?? ""}`}</td>; })}
              </tr>
            ))}
            <tr><td className="px-3 py-2">Followers (public)</td>{entities.map((e) => <td key={e.id} className="px-2 py-2 text-right tabular-nums">{e.own ? "—" : fmt(e.followers)}</td>)}</tr>
          </tbody>
        </table>
      </div>

      {others.length ? (
        <section className="grid gap-3 lg:grid-cols-3">
          {([["them", "What competitors do better", ArrowUpRight], ["us", "What we do better", ArrowDownRight], ["missing", "What competitors are missing", Minus]] as const).map(([side, title, Icon]) => {
            const list = facts.filter((f) => f.side === side);
            return (
              <div key={side} className="rounded-xl border bg-card p-4 shadow-xs">
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="size-4" /> {title}</p>
                {list.length ? <ul className="space-y-1.5 text-xs">{list.slice(0, 6).map((f, k) => <li key={k} dir="auto">• {f.text}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing stands out with the data collected.</p>}
              </div>
            );
          })}
        </section>
      ) : <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">Select at least one competitor with collected posts.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Format mix (% of posts)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={e.summary.byFormat.slice(0, 6).map((f) => ({ label: f.label, value: f.share, right: `${f.share}%`, hint: `${f.n} posts, ×${f.medianLift ?? "?"} own median` }))} max={100} />)}
        </Panel>
        <Panel title="Formats vs own median (lift, normalised)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={e.summary.byFormat.filter((f) => f.medianLift != null).slice(0, 6).map((f) => ({ label: f.label, value: f.medianLift!, right: `×${f.medianLift}`, hint: `${f.n} posts` }))} />)}
        </Panel>
        <Panel title="Publication days (% of posts, project time zone)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={[...e.summary.byWeekday].sort((a, b) => Number(a.key) - Number(b.key)).map((d) => ({ label: d.label, value: d.share, right: `${d.share}%` }))} max={40} />)}
        </Panel>
        <Panel title="Top topics (posts, lift)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={e.summary.topics.slice(0, 6).map((t) => ({ label: t.label, value: t.n, right: `${t.n} · ×${t.medianLift ?? "?"}` }))} />)}
        </Panel>
        <Panel title="Hooks (lift vs own median)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={e.summary.hooks.filter((h) => h.medianLift != null).map((h) => ({ label: h.label, value: h.medianLift!, right: `×${h.medianLift} · ${h.n}` }))} />)}
        </Panel>
        <Panel title="CTAs (lift vs own median)">
          {entities.map((e, k) => <EntityBars key={e.id} e={e} color={COLORS[k % COLORS.length]} rows={e.summary.ctas.filter((h) => h.medianLift != null).slice(0, 5).map((h) => ({ label: h.label, value: h.medianLift!, right: `×${h.medianLift} · ${h.n}` }))} />)}
        </Panel>
      </div>
      <MetricLegend />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs"><p className="text-[13px] font-semibold">{title}</p>{children}</section>;
}
function EntityBars({ e, color, rows, max }: { e: Entity; color: string; rows: { label: string; value: number; right?: string; hint?: string }[]; max?: number }) {
  return <div><p className="mb-1 text-[11px] font-medium text-muted-foreground">{e.name}</p><Bars rows={rows} max={max} tone={color} /></div>;
}
