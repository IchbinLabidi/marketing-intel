"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FUNNEL_LABELS, PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { validatePlan, type Plan } from "@/lib/editorial/plan";

type Result = { ok: boolean; error?: string; message?: string };
const pl = (p: Platform) => (p === "blog" ? "Website / SEO" : PLATFORM_LABELS[p]);

/** Step 4: the proposed content mix, editable. Every distribution must add up to the number of posts. */
export function MixEditor({ plan: initial, pillarName, campaignName, save, readOnly }: {
  plan: Plan; pillarName: Record<string, string>; campaignName: Record<string, string>; save: (plan: unknown) => Promise<Result>; readOnly: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const total = plan.platforms.reduce((t, p) => t + p.count, 0);
  const errors = validatePlan({ ...plan, total });
  const dirty = JSON.stringify(plan) !== JSON.stringify(initial);
  const set = <K extends "platforms" | "pillars" | "funnel" | "formats" | "campaigns">(key: K, k: number, count: number) =>
    setPlan({ ...plan, [key]: plan[key].map((x, j) => (j === k ? { ...x, count: Math.max(0, Math.min(200, Math.round(count) || 0)) } : x)) });

  const submit = async () => {
    setBusy(true);
    const r = await save({ ...plan, total });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? "Saved");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Box title="Platforms and frequency" right={<span className="text-xs text-muted-foreground">{total} posts</span>}>
          {plan.platforms.map((p, k) => (
            <Row key={p.platform} label={pl(p.platform)} hint={p.timingBasis === "history" && p.bestDays.length ? `best days from your data: ${p.bestDays.slice(0, 3).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}` : "days spread evenly (no timing data)"}>
              <Num readOnly={readOnly} value={p.count} label={`${pl(p.platform)} posts`} onChange={(n) => set("platforms", k, n)} />
            </Row>
          ))}
          <Row label="Team capacity" hint="posts per week; used by the workload check">
            <Input type="number" min={1} max={100} value={plan.capacityPerWeek ?? ""} disabled={readOnly} className="h-8 w-16 text-right" aria-label="Capacity per week" onChange={(e) => setPlan({ ...plan, capacityPerWeek: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
          </Row>
        </Box>
        <Box title="Content pillars" right={<Total list={plan.pillars} of={total} />}>
          {plan.pillars.length ? plan.pillars.map((p, k) => (
            <Row key={p.pillar_id} label={pillarName[p.pillar_id] ?? p.name} hint={p.target_share != null ? `target ${p.target_share}% in the strategy` : `no target share (${p.share}% of the rest)`}>
              <Num readOnly={readOnly} value={p.count} label={`${p.name} posts`} onChange={(n) => set("pillars", k, n)} />
            </Row>
          )) : <p className="text-xs text-muted-foreground">No pillar in the strategy.</p>}
        </Box>
        <Box title="Funnel stages" right={<Total list={plan.funnel} of={total} />}>
          {plan.funnel.map((f, k) => <Row key={f.stage} label={FUNNEL_LABELS[f.stage]} hint={`${f.share}% proposed`}><Num readOnly={readOnly} value={f.count} label={`${f.stage} posts`} onChange={(n) => set("funnel", k, n)} /></Row>)}
        </Box>
        <Box title="Formats" right={<span className="text-xs text-muted-foreground">per platform</span>}>
          {plan.platforms.map((p) => (
            <div key={p.platform} className="space-y-1 border-b pb-2 last:border-0">
              <p className="flex justify-between text-xs font-medium">{pl(p.platform)} <Total list={plan.formats.filter((f) => f.platform === p.platform)} of={p.count} /></p>
              {plan.formats.map((f, k) => f.platform !== p.platform ? null : (
                <Row key={`${f.platform}-${f.format}`} label={f.format} hint={f.basis === "history" ? `×${f.lift} vs your median` : "default mix"}>
                  <Num readOnly={readOnly} value={f.count} label={`${f.format} posts`} onChange={(n) => set("formats", k, n)} />
                </Row>
              ))}
            </div>
          ))}
        </Box>
        {plan.campaigns.length ? (
          <Box title="Campaign coverage">
            {plan.campaigns.map((c, k) => <Row key={c.campaign_id} label={campaignName[c.campaign_id] ?? c.name} hint={`${c.starts_on ?? "…"} → ${c.ends_on ?? "…"}`}><Num readOnly={readOnly} value={c.count} label={`${c.name} posts`} onChange={(n) => set("campaigns", k, n)} /></Row>)}
          </Box>
        ) : null}
        <Box title="Important dates">
          {plan.dates.length ? plan.dates.map((d, k) => <p key={k} className="flex justify-between text-[13px]"><span>{d.label}</span><span className="text-xs text-muted-foreground">{d.start}{d.end !== d.start ? ` → ${d.end}` : ""} · {d.kind}</span></p>) : <p className="text-xs text-muted-foreground">No season, campaign start or custom date in this month.</p>}
        </Box>
      </div>
      {plan.notes.length ? <ul className="space-y-0.5 text-xs text-muted-foreground">{plan.notes.map((n, k) => <li key={k}>• {n}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1">{errors.length ? errors.map((e) => <Badge key={e} variant="destructive">{e}</Badge>) : <Badge variant="outline">Distributions add up</Badge>}</span>
        {!readOnly ? <Button onClick={submit} disabled={busy || errors.length > 0} variant={dirty ? "default" : "outline"}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Save the content mix</Button> : null}
      </div>
    </div>
  );
}

const sumOf = (l: { count: number }[]) => l.reduce((t, x) => t + x.count, 0);
function Num({ value, onChange, label, readOnly }: { value: number; onChange: (n: number) => void; label: string; readOnly: boolean }) {
  return <Input type="number" min={0} max={200} value={value} aria-label={label} disabled={readOnly} className="h-8 w-16 text-right tabular-nums" onChange={(e) => onChange(Number(e.target.value))} />;
}
function Total({ list, of }: { list: { count: number }[]; of: number }) {
  return <span className={sumOf(list) === of ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>{sumOf(list)} / {of}</span>;
}
function Box({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-2 rounded-xl border bg-card p-4 shadow-xs"><p className="flex items-center justify-between text-[13px] font-semibold">{title}{right}</p>{children}</section>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="min-w-0 text-[13px]"><span className="block truncate" dir="auto">{label}</span>{hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}</span>{children}</div>;
}
