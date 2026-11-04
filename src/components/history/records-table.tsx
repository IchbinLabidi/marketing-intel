"use client";

import * as React from "react";
import { useTransition } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, SubmitButton, fieldError, useFormAction, useResultToast } from "@/components/app/form";
import { FUNNEL_STAGES, METRICS, PLATFORMS } from "@/lib/domain/constants";
import { deleteHistoricalItemAction, updateHistoricalItemAction } from "@/server/actions/history";
import type { HistoricalItem } from "@/types/domain";
import { confirm } from "@/components/ui/confirm";
import { useFormatter, useT } from "@/i18n/client";
import { platformLabel } from "@/lib/history/parse";

type Option = { value: string; label: string };
export type RecordFilters = { from?: string; to?: string; platform?: string; format?: string; pillar?: string; campaign?: string; status?: string; import?: string; q?: string };

export function RecordsTable({
  projectId,
  items,
  total,
  page,
  pageCount,
  filters,
  options,
  pillars,
  campaigns,
  imports,
  readOnly,
}: {
  projectId: string;
  items: HistoricalItem[];
  total: number;
  page: number;
  pageCount: number;
  filters: RecordFilters;
  options: { formats: Option[]; statuses: Option[]; platforms: Option[]; campaigns: Option[] };
  pillars: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  imports: { id: string; label: string }[];
  readOnly: boolean;
}) {
  const t = useT("history");
  const td = useT("domain");
  const tc = useT("common");
  const [editing, setEditing] = React.useState<HistoricalItem | null>(null);
  const [pending, startTransition] = useTransition();
  const pillarName = (id: string | null) => (id ? pillars.find((p) => p.id === id)?.name : undefined);
  const base = `/p/${projectId}/history`;
  const pageHref = (p: number) => `${base}?${new URLSearchParams({ tab: "records", ...clean(filters), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <form method="get" action={base} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="tab" value="records" />
        <Field label={t("records.search")} htmlFor="f-q"><Input id="f-q" name="q" defaultValue={filters.q} placeholder={t("records.searchPlaceholder")} /></Field>
        <Field label={t("records.from")} htmlFor="f-from"><Input id="f-from" name="from" type="date" defaultValue={filters.from} /></Field>
        <Field label={t("records.to")} htmlFor="f-to"><Input id="f-to" name="to" type="date" defaultValue={filters.to} /></Field>
        <Field label={t("records.calendar")} htmlFor="f-import">
          <NativeSelect id="f-import" name="import" defaultValue={filters.import ?? ""}><option value="">{t("records.allImports")}</option>{imports.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.platform")} htmlFor="f-platform">
          <NativeSelect id="f-platform" name="platform" defaultValue={filters.platform ?? ""}><option value="">{tc("states.all")}</option>{options.platforms.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.format")} htmlFor="f-format">
          <NativeSelect id="f-format" name="format" defaultValue={filters.format ?? ""}><option value="">{tc("states.all")}</option>{options.formats.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.pillar")} htmlFor="f-pillar">
          <NativeSelect id="f-pillar" name="pillar" defaultValue={filters.pillar ?? ""}>
            <option value="">{tc("states.all")}</option>
            {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">{t("records.notLinkedPillar")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("records.campaign")} htmlFor="f-campaign">
          <NativeSelect id="f-campaign" name="campaign" defaultValue={filters.campaign ?? ""}><option value="">{tc("states.all")}</option>{options.campaigns.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.statusImported")} htmlFor="f-status">
          <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}><option value="">{tc("states.all")}</option>{options.statuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 lg:justify-end">
          <Button asChild variant="ghost" size="sm"><Link href={`${base}?tab=records`}>{tc("actions.clear")}</Link></Button>
          <Button type="submit" size="sm">{t("records.applyFilters")}</Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">{t("records.matches", { count: total })}</p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 font-medium">{t("records.columns.date")}</th><th className="pr-3 font-medium">{t("records.platform")}</th><th className="pr-3 font-medium">{t("records.columns.title")}</th>
              <th className="pr-3 font-medium">{t("records.format")}</th><th className="pr-3 font-medium">{t("records.pillar")}</th><th className="pr-3 font-medium">{t("records.campaign")}</th><th className="pr-3 font-medium">{t("records.columns.status")}</th><th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b align-top last:border-0 hover:bg-accent/30">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {i.actual_publication_date ?? i.publication_date ?? <span className="text-muted-foreground">—</span>}
                  {i.actual_publication_date && i.publication_date && i.actual_publication_date !== i.publication_date ? (
                    <p className="text-[11px] text-muted-foreground">{t("records.planned", { date: i.publication_date })}</p>
                  ) : null}
                </td>
                <td className="pr-3">
                  {i.platform ? platformLabel(td, i.platform) : <span className="text-muted-foreground">—</span>}
                  <p className="text-[11px] text-muted-foreground">
                    {i.source === "meta_api" ? (
                      i.permalink ? <a href={i.permalink} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t("records.metaOpen")}</a> : "Meta"
                    ) : (
                      t("records.fileSource", { source: i.source })
                    )}
                  </p>
                </td>
                <td className="max-w-sm pr-3">
                  <p className="line-clamp-2">{i.title ?? i.topic ?? i.caption ?? i.description}</p>
                  {i.title && i.topic ? <p className="text-xs text-muted-foreground">{i.topic}</p> : null}
                </td>
                <td className="pr-3">{i.format ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="pr-3">
                  {pillarName(i.pillar_id) ?? (i.content_pillar ? <span className="text-muted-foreground" title={t("records.notLinkedHint")}>{i.content_pillar}*</span> : <span className="text-muted-foreground">—</span>)}
                  {i.pillar_id && i.pillar_assigned_by === "ai" ? <Badge variant="outline" className="ml-1" title={t("records.aiAssignedHint")}>{t("records.ai")}</Badge> : null}
                </td>
                <td className="pr-3">{i.campaign ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="pr-3">{i.publication_status ? <Badge variant="secondary">{i.publication_status}</Badge> : <span className="text-xs text-muted-foreground">{t("records.notRecorded")}</span>}</td>
                <td className="pr-2 text-right">
                  {!readOnly ? (
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon-sm" aria-label={t("records.edit")} onClick={() => setEditing(i)}><Pencil /></Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("records.delete")}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            if (!(await confirm({ title: t("records.deleteTitle"), description: t("records.deleteDescription"), confirmLabel: tc("actions.delete"), destructive: true }))) return;
                            const r = await deleteHistoricalItemAction(projectId, i.id);
                            if (r.ok) toast.success(r.message);
                            else toast.error(r.error);
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? <p className="p-6 text-center text-[13px] text-muted-foreground">{t("records.noMatch")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("records.footnote")}</p>

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[13px]">
          {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={pageHref(page - 1)}>{tc("actions.previous")}</Link></Button> : null}
          <span className="text-muted-foreground">{t("records.page", { page, pageCount })}</span>
          {page < pageCount ? <Button asChild variant="outline" size="sm"><Link href={pageHref(page + 1)}>{tc("actions.next")}</Link></Button> : null}
        </div>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{t("records.edit")}</DialogTitle></DialogHeader>
          {editing ? <EditForm key={editing.id} projectId={projectId} item={editing} pillars={pillars} campaigns={campaigns} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditForm({ projectId, item, pillars, campaigns, onDone }: { projectId: string; item: HistoricalItem; pillars: { id: string; name: string }[]; campaigns: { id: string; name: string }[]; onDone: () => void }) {
  const t = useT("history");
  const td = useT("domain");
  const tc = useT("common");
  const fmt = useFormatter();
  const { state, pending, formProps } = useFormAction(updateHistoricalItemAction.bind(null, projectId, item.id));
  useResultToast(state, onDone);
  const v = (k: keyof HistoricalItem) => (item[k] == null ? "" : String(item[k]));
  const err = (k: string) => fieldError(state, k);
  return (
    <form {...formProps} className="grid gap-4">
      <div className="grid max-h-[65vh] gap-4 overflow-y-auto px-0.5 sm:grid-cols-2">
        <Field label={t("records.form.plannedDate")} htmlFor="publication_date" error={err("publication_date")}><Input id="publication_date" name="publication_date" type="date" defaultValue={v("publication_date")} /></Field>
        <Field label={t("fields.actual_publication_date.label")} htmlFor="actual_publication_date" error={err("actual_publication_date")}><Input id="actual_publication_date" name="actual_publication_date" type="date" defaultValue={v("actual_publication_date")} /></Field>
        <Field label={t("fields.title.label")} htmlFor="title" error={err("title")} className="sm:col-span-2"><Input id="title" name="title" defaultValue={v("title")} /></Field>
        <Field label={t("fields.topic.label")} htmlFor="topic"><Input id="topic" name="topic" defaultValue={v("topic")} /></Field>
        <Field label={t("records.platform")} htmlFor="platform">
          <NativeSelect id="platform" name="platform" defaultValue={v("platform")}><option value="">—</option>{PLATFORMS.map((p) => <option key={p} value={p}>{platformLabel(td, p)}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.format")} htmlFor="format"><Input id="format" name="format" defaultValue={v("format")} /></Field>
        <Field label={t("records.form.status")} htmlFor="publication_status"><Input id="publication_status" name="publication_status" defaultValue={v("publication_status")} /></Field>
        <Field label={t("fields.content_pillar.label")} htmlFor="pillar_id" hint={!item.pillar_id && item.content_pillar ? t("records.form.fileSays", { value: item.content_pillar }) : undefined}>
          <NativeSelect id="pillar_id" name="pillar_id" defaultValue={v("pillar_id")}><option value="">{t("records.form.notLinked")}</option>{pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.campaign")} htmlFor="campaign_id" hint={!item.campaign_id && item.campaign ? t("records.form.fileSays", { value: item.campaign }) : undefined}>
          <NativeSelect id="campaign_id" name="campaign_id" defaultValue={v("campaign_id")}><option value="">{t("records.form.notLinked")}</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        </Field>
        <Field label={t("records.form.funnel")} htmlFor="funnel_stage">
          <NativeSelect id="funnel_stage" name="funnel_stage" defaultValue={v("funnel_stage")}><option value="">—</option>{FUNNEL_STAGES.map((f) => <option key={f} value={f}>{td(`funnel.${f}`)}</option>)}</NativeSelect>
        </Field>
        <Field label={t("fields.cta.label")} htmlFor="cta"><Input id="cta" name="cta" defaultValue={v("cta")} /></Field>
        <Field label={t("fields.description.label")} htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" rows={2} defaultValue={v("description")} /></Field>
        <Field label={t("fields.caption.label")} htmlFor="caption" className="sm:col-span-2"><Textarea id="caption" name="caption" rows={3} defaultValue={v("caption")} /></Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[13px] font-medium">
            {t("records.form.metrics")}{" "}
            <span className="font-normal text-muted-foreground">
              {item.source === "meta_api" ? (item.metrics_updated_at ? t("records.form.syncedOn", { date: fmt.dateTime(item.metrics_updated_at) }) : t("records.form.synced")) : t("records.form.leaveEmpty")}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {METRICS.map((m) => (
              <Field key={m} label={td(`metric.${m}`)} htmlFor={m} error={err(m)}>
                {/* disabled inputs are not submitted, so synced metrics can't be overwritten from the form */}
                <Input id={m} name={m} type="number" min={0} step={1} defaultValue={v(m)} disabled={item.source === "meta_api"} />
              </Field>
            ))}
          </div>
          {item.source === "meta_api" && Object.keys(item.metrics_raw ?? {}).length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("records.form.rawValues")} {Object.entries(item.metrics_raw).map(([k, val]) => `${k} ${val}`).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      <DialogFooter><SubmitButton pending={pending} pendingLabel={tc("actions.saving")}>{tc("actions.save")}</SubmitButton></DialogFooter>
    </form>
  );
}

const clean = (f: RecordFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>;
