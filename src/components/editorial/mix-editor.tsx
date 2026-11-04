"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Platform } from "@/lib/domain/constants";
import { planFormatLabel, validatePlan, type Plan } from "@/lib/editorial/plan";
import { platformLabel } from "@/lib/history/parse";
import { SEASONS } from "@/lib/history/seasons";
import { useT } from "@/i18n/client";

type Result = { ok: boolean; error?: string; message?: string };
const CAMPAIGN_STARTS = " starts";

/** Step 4: the proposed content mix, editable. Every distribution must add up to the number of posts. */
export function MixEditor({ plan: initial, pillarName, campaignName, save, readOnly }: {
  plan: Plan; pillarName: Record<string, string>; campaignName: Record<string, string>; save: (plan: unknown) => Promise<Result>; readOnly: boolean;
}) {
  const router = useRouter();
  const t = useT("editorial");
  const th = useT("history");
  const td = useT("domain");
  const pl = (p: Platform) => (p === "blog" ? t("platforms.blog") : platformLabel(td, p));
  // Date labels are stored in English (they also feed the AI prompts): seasons and campaign starts are re-worded here.
  const dateLabel = (d: Plan["dates"][number]) => {
    const season = d.kind === "season" ? SEASONS.find((s) => s.label === d.label) : undefined;
    if (season) return th(`seasons.${season.key}`);
    if (d.kind === "campaign" && d.label.endsWith(CAMPAIGN_STARTS)) return t("mix.campaignStarts", { name: d.label.slice(0, -CAMPAIGN_STARTS.length) });
    return d.label;
  };
  const [plan, setPlan] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const total = plan.platforms.reduce((n, p) => n + p.count, 0);
  const errors = validatePlan({ ...plan, total }, t);
  const dirty = JSON.stringify(plan) !== JSON.stringify(initial);
  const set = <K extends "platforms" | "pillars" | "funnel" | "formats" | "campaigns">(key: K, k: number, count: number) =>
    setPlan({ ...plan, [key]: plan[key].map((x, j) => (j === k ? { ...x, count: Math.max(0, Math.min(200, Math.round(count) || 0)) } : x)) });

  const submit = async () => {
    setBusy(true);
    const r = await save({ ...plan, total });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? t("mix.saved"));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Box title={t("mix.platforms")} right={<span className="text-xs text-muted-foreground">{t("mix.posts", { count: total })}</span>}>
          {plan.platforms.map((p, k) => (
            <Row key={p.platform} label={pl(p.platform)} hint={p.timingBasis === "history" && p.bestDays.length ? t("mix.bestDays", { days: p.bestDays.slice(0, 3).map((d) => t(`weekdays.d${d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)).join(", ") }) : t("mix.evenDays")}>
              <Num readOnly={readOnly} value={p.count} label={t("mix.postsOf", { name: pl(p.platform) })} onChange={(n) => set("platforms", k, n)} />
            </Row>
          ))}
          <Row label={t("mix.capacity")} hint={t("mix.capacityHint")}>
            <Input type="number" min={1} max={100} value={plan.capacityPerWeek ?? ""} disabled={readOnly} className="h-8 w-16 text-right" aria-label={t("mix.capacityLabel")} onChange={(e) => setPlan({ ...plan, capacityPerWeek: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
          </Row>
        </Box>
        <Box title={t("mix.pillars")} right={<Total list={plan.pillars} of={total} />}>
          {plan.pillars.length ? plan.pillars.map((p, k) => (
            <Row key={p.pillar_id} label={pillarName[p.pillar_id] ?? p.name} hint={p.target_share != null ? t("mix.pillarTarget", { share: Number(p.target_share) }) : t("mix.pillarNoTarget", { share: p.share })}>
              <Num readOnly={readOnly} value={p.count} label={t("mix.postsOf", { name: p.name })} onChange={(n) => set("pillars", k, n)} />
            </Row>
          )) : <p className="text-xs text-muted-foreground">{t("mix.noPillars")}</p>}
        </Box>
        <Box title={t("mix.funnel")} right={<Total list={plan.funnel} of={total} />}>
          {plan.funnel.map((f, k) => <Row key={f.stage} label={td(`funnel.${f.stage}`)} hint={t("mix.proposed", { share: f.share })}><Num readOnly={readOnly} value={f.count} label={t("mix.postsOf", { name: td(`funnel.${f.stage}`) })} onChange={(n) => set("funnel", k, n)} /></Row>)}
        </Box>
        <Box title={t("mix.formats")} right={<span className="text-xs text-muted-foreground">{t("mix.perPlatform")}</span>}>
          {plan.platforms.map((p) => (
            <div key={p.platform} className="space-y-1 border-b pb-2 last:border-0">
              <p className="flex justify-between text-xs font-medium">{pl(p.platform)} <Total list={plan.formats.filter((f) => f.platform === p.platform)} of={p.count} /></p>
              {plan.formats.map((f, k) => f.platform !== p.platform ? null : (
                <Row key={`${f.platform}-${f.format}`} label={planFormatLabel(t, f.format)} hint={f.basis === "history" ? t("mix.lift", { lift: f.lift ?? "?" }) : t("mix.defaultMix")}>
                  <Num readOnly={readOnly} value={f.count} label={t("mix.postsOf", { name: f.format })} onChange={(n) => set("formats", k, n)} />
                </Row>
              ))}
            </div>
          ))}
        </Box>
        {plan.campaigns.length ? (
          <Box title={t("mix.campaigns")}>
            {plan.campaigns.map((c, k) => <Row key={c.campaign_id} label={campaignName[c.campaign_id] ?? c.name} hint={`${c.starts_on ?? "…"} → ${c.ends_on ?? "…"}`}><Num readOnly={readOnly} value={c.count} label={t("mix.postsOf", { name: c.name })} onChange={(n) => set("campaigns", k, n)} /></Row>)}
          </Box>
        ) : null}
        <Box title={t("mix.dates")}>
          {plan.dates.length ? plan.dates.map((d, k) => <p key={k} className="flex justify-between text-[13px]"><span>{dateLabel(d)}</span><span className="text-xs text-muted-foreground">{d.start}{d.end !== d.start ? ` → ${d.end}` : ""} · {t(`mix.dateKind.${d.kind}`)}</span></p>) : <p className="text-xs text-muted-foreground">{t("mix.noDates")}</p>}
        </Box>
      </div>
      {plan.notes.length ? <ul className="space-y-0.5 text-xs text-muted-foreground">{plan.notes.map((n, k) => <li key={k}>• {n}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1">{errors.length ? errors.map((e) => <Badge key={e} variant="destructive">{e}</Badge>) : <Badge variant="outline">{t("mix.balanced")}</Badge>}</span>
        {!readOnly ? <Button onClick={submit} disabled={busy || errors.length > 0} variant={dirty ? "default" : "outline"}>{busy ? <Loader2 className="animate-spin" /> : <Save />} {t("mix.save")}</Button> : null}
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
