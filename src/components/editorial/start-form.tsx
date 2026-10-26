"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { OBJECTIVE_LABELS, OBJECTIVES, type Objective } from "@/lib/editorial/plan";
import { cn } from "@/lib/utils";
import { startCalendarAction } from "@/server/actions/editorial";

const CHOICES: Platform[] = ["instagram", "facebook", "blog", "linkedin", "tiktok", "youtube"];
const label = (p: Platform) => (p === "blog" ? "Website / SEO" : PLATFORM_LABELS[p]);

/** Steps 1–2: month and platforms, publishing frequency and business objective. */
export function StartForm({ projectId, defaults, readOnly }: {
  projectId: string; readOnly: boolean;
  defaults: { month: string; platforms: { platform: Platform; perWeek: number }[] };
}) {
  const router = useRouter();
  const [month, setMonth] = React.useState(defaults.month);
  const [rows, setRows] = React.useState(defaults.platforms);
  const [objective, setObjective] = React.useState<Objective>("engagement");
  const [capacity, setCapacity] = React.useState("");
  const [instruction, setInstruction] = React.useState("");
  const [dates, setDates] = React.useState<{ label: string; date: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const on = (p: Platform) => rows.some((r) => r.platform === p);
  const toggle = (p: Platform) => setRows(on(p) ? rows.filter((r) => r.platform !== p) : [...rows, { platform: p, perWeek: p === "blog" ? 1 : 3 }]);
  const total = Math.round(rows.reduce((t, r) => t + r.perWeek, 0) * (30 / 7));

  const submit = async () => {
    setBusy(true);
    const r = await startCalendarAction(projectId, {
      month, platforms: rows.filter((x) => x.perWeek > 0), objective, capacityPerWeek: capacity ? Number(capacity) : null,
      instruction: instruction.trim() || null, customDates: dates.filter((d) => d.label.trim() && d.date),
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? "Plan proposed");
    router.push(`/p/${projectId}/calendar/plan/${r.data!.id}`);
  };

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <div>
        <p className="text-[13px] font-semibold">1 · Month and platforms</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <label className="grid gap-1 text-xs font-medium">Month<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <fieldset className="grid gap-1 text-xs font-medium"><legend className="mb-1">Platforms</legend>
            <span className="flex flex-wrap gap-1">{CHOICES.map((p) => <button key={p} type="button" aria-pressed={on(p)} onClick={() => toggle(p)} className={cn("h-9 rounded-md border px-3 text-[13px]", on(p) ? "border-primary/50 bg-primary/10 font-medium" : "text-muted-foreground hover:bg-accent")}>{label(p)}</button>)}</span>
          </fieldset>
        </div>
      </div>
      <div>
        <p className="text-[13px] font-semibold">2 · Publishing frequency and business objective</p>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            {rows.map((r) => (
              <label key={r.platform} className="flex items-center gap-2 text-[13px]">
                <span className="w-32">{label(r.platform)}</span>
                <Input type="number" min={0} max={21} step={1} value={r.perWeek} className="w-20" onChange={(e) => setRows(rows.map((x) => (x.platform === r.platform ? { ...x, perWeek: Math.max(0, Math.min(21, Number(e.target.value) || 0)) } : x)))} />
                <span className="text-xs text-muted-foreground">posts per week</span>
              </label>
            ))}
            {!rows.length ? <p className="text-xs text-muted-foreground">Choose at least one platform.</p> : <p className="text-xs text-muted-foreground">About {total} posts in the month.</p>}
          </div>
          <div className="space-y-2">
            <label className="grid gap-1 text-xs font-medium">Business objective of the month
              <NativeSelect value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>{OBJECTIVES.map((o) => <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>)}</NativeSelect>
            </label>
            <label className="grid gap-1 text-xs font-medium">Team capacity (posts per week, optional)
              <Input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 8" />
            </label>
          </div>
        </div>
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Important dates and instructions (optional)</summary>
          <div className="mt-2 space-y-2">
            {dates.map((d, k) => (
              <div key={k} className="flex gap-2">
                <Input value={d.label} placeholder="e.g. Open day" onChange={(e) => setDates(dates.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
                <Input type="date" value={d.date} className="w-44" onChange={(e) => setDates(dates.map((x, j) => (j === k ? { ...x, date: e.target.value } : x)))} />
                <Button variant="ghost" size="icon" aria-label="Remove date" onClick={() => setDates(dates.filter((_, j) => j !== k))}><X /></Button>
              </div>
            ))}
            {dates.length < 10 ? <Button variant="outline" size="sm" onClick={() => setDates([...dates, { label: "", date: "" }])}><Plus /> Add a date</Button> : null}
            <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Anything the plan should take into account (offers, events, topics to avoid…)" maxLength={1000} />
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Next: the engine checks which data is available and proposes a content mix. No AI cost at this step.</p>
        <Button onClick={submit} disabled={readOnly || busy || !rows.some((r) => r.perWeek > 0) || !/^\d{4}-\d{2}$/.test(month)}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Analyse and propose a plan
        </Button>
      </div>
    </section>
  );
}
