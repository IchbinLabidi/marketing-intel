import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/app/form";
import type { comparePeriods } from "@/lib/history/compare";
import { getT } from "@/i18n/server";
import { Legend, PairedBar } from "./charts";

type Comparison = ReturnType<typeof comparePeriods>;

export async function ComparePanel({
  projectId,
  periods,
  a,
  b,
  labelA,
  labelB,
  result,
}: {
  projectId: string;
  periods: { key: string; label: string }[];
  a?: string;
  b?: string;
  labelA?: string;
  labelB?: string;
  result: Comparison | null;
}) {
  const t = await getT("history");
  return (
    <div className="space-y-6">
      <form method="get" action={`/p/${projectId}/history`} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <input type="hidden" name="tab" value="compare" />
        <Field label={t("compare.periodA")} htmlFor="cmp-a" className="flex-1">
          <NativeSelect id="cmp-a" name="a" defaultValue={a ?? periods[0]?.key}>{periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</NativeSelect>
        </Field>
        <Field label={t("compare.periodB")} htmlFor="cmp-b" className="flex-1">
          <NativeSelect id="cmp-b" name="b" defaultValue={b ?? periods[1]?.key}>{periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</NativeSelect>
        </Field>
        <Button type="submit" size="sm">{t("compare.submit")}</Button>
      </form>

      {!result ? (
        <p className="text-[13px] text-muted-foreground">
          {t("compare.pick")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t("compare.itemsA")} value={result.volume.a} />
            <Tile label={t("compare.itemsB")} value={result.volume.b} hint={result.volume.deltaPct != null ? `${result.volume.delta >= 0 ? "+" : ""}${result.volume.delta} (${result.volume.deltaPct >= 0 ? "+" : ""}${result.volume.deltaPct}%)` : undefined} />
            <Tile label={t("compare.perWeekA")} value={result.perWeek.a ?? "—"} />
            <Tile label={t("compare.perWeekB")} value={result.perWeek.b ?? "—"} />
          </div>
          <Legend a={labelA ?? "A"} b={labelB ?? "B"} />
          <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
            {result.dimensions.map((d) => {
              const max = Math.max(1, ...d.rows.flatMap((r) => [r.a, r.b]));
              return (
                <Card key={d.key}>
                  <CardHeader><CardTitle>{d.label}</CardTitle><CardDescription>{t("compare.dimensionHint")}</CardDescription></CardHeader>
                  <CardContent>
                    <ul className="grid gap-3">
                      {d.rows.slice(0, 10).map((r) => (
                        <li key={r.name} className="grid gap-1 text-[13px]">
                          <div className="flex justify-between gap-2">
                            <span className="truncate">{r.name}</span>
                            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {r.a} → {r.b} <span className={r.deltaShare > 0 ? "text-foreground" : ""}>({t("compare.points", { delta: `${r.deltaShare > 0 ? "+" : ""}${r.deltaShare}` })})</span>
                            </span>
                          </div>
                          <PairedBar a={r.a} b={r.b} max={max} />
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardHeader><CardTitle>{t("compare.campaigns")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-[13px] md:grid-cols-3">
              <CampaignList title={t("compare.onlyA")} items={result.campaigns.onlyA} />
              <CampaignList title={t("compare.both")} items={result.campaigns.both} />
              <CampaignList title={t("compare.onlyB")} items={result.campaigns.onlyB} />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{t("compare.footer")}</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CampaignList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length ? <div className="flex flex-wrap gap-1">{items.map((c) => <Badge key={c} variant="secondary">{c}</Badge>)}</div> : <p className="text-muted-foreground">—</p>}
    </div>
  );
}
