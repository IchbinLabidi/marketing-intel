"use client";

import * as React from "react";
import { useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/app/empty-state";
import { Field, SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { addEntitiesAction, deleteEntityAction, upsertEntityAction } from "@/server/actions/strategy";
import type { StrategyEntity } from "@/lib/validation/strategy";
import type { StrategySection } from "@/server/ai/strategy";
import { cn } from "@/lib/utils";
import { AISuggest, type SuggestionNotes } from "./ai-suggest";
import { confirm } from "@/components/ui/confirm";
import { useT } from "@/i18n/client";

export type EntityField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkboxes";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
};

type Item = { id: string } & Record<string, unknown>;

export function EntityList<T extends Item>({
  projectId,
  entity,
  icon,
  fields,
  items,
  readOnly,
  aiEnabled,
  renderItem,
}: {
  projectId: string;
  entity: StrategyEntity;
  icon: LucideIcon;
  fields: EntityField[];
  items: T[];
  readOnly: boolean;
  aiEnabled: boolean;
  renderItem: (item: T) => React.ReactNode;
}) {
  const t = useT("strategy");
  const tc = useT("common");
  const [editing, setEditing] = React.useState<T | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (item: T) =>
    startTransition(async () => {
      if (!(await confirm({ title: t(`entities.${entity}.deleteTitle`), description: t("entityList.deleteDescription"), confirmLabel: tc("actions.delete"), destructive: true }))) return;
      const r = await deleteEntityAction(entity, projectId, item.id);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <div className="flex justify-end gap-2">
          <AISuggest<{ items: Record<string, unknown>[]; notes: SuggestionNotes }>
            projectId={projectId}
            section={entity as StrategySection}
            aiEnabled={aiEnabled}
            label={t(`entities.${entity}.suggest`)}
            applyLabel={t("entityList.addSelected")}
            renderPreview={(d, { selected, toggle }) => (
              <ul className="grid gap-2">
                {d.items.map((item, i) => (
                  <li key={i}>
                    <label
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                        selected.has(i) ? "border-primary/50 bg-primary/5" : "opacity-70",
                      )}
                    >
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-1 accent-[var(--primary)]" />
                      <div className="min-w-0 flex-1">{renderItem({ id: `s${i}`, ...item } as T)}</div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            onApply={async (d, selected) => {
              const chosen = d.items.filter((_, i) => selected.has(i));
              if (!chosen.length) {
                toast.error(t("entityList.selectOne"));
                return false;
              }
              const r = await addEntitiesAction(entity, projectId, chosen);
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
              return r.ok;
            }}
          />
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> {t(`entities.${entity}.add`)}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon={icon} title={t(`entities.${entity}.empty`)} description={t(`entities.${entity}.emptyText`)} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="group relative rounded-xl border bg-card p-4.5 shadow-xs transition-shadow hover:shadow-sm">
              {renderItem(item)}
              {!readOnly ? (
                <div className="absolute right-2.5 top-2.5 flex gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
                  <Button variant="ghost" size="icon-sm" aria-label={t(`entities.${entity}.edit`)} onClick={() => setEditing(item)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t(`entities.${entity}.delete`)} disabled={pending} onClick={() => remove(item)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t(`entities.${entity}.add`) : t(`entities.${entity}.edit`)}</DialogTitle>
          </DialogHeader>
          {editing !== null ? (
            <EntityForm
              key={editing === "new" ? "new" : editing.id}
              projectId={projectId}
              entity={entity}
              fields={fields}
              item={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntityForm({
  projectId,
  entity,
  fields,
  item,
  onDone,
}: {
  projectId: string;
  entity: StrategyEntity;
  fields: EntityField[];
  item: Item | null;
  onDone: () => void;
}) {
  const tc = useT("common");
  const { state, pending, formProps } = useFormAction(upsertEntityAction.bind(null, entity, projectId, item?.id ?? null));
  useResultToast(state, onDone);
  return (
    <form {...formProps} className="grid gap-4">
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto px-0.5 sm:grid-cols-2">
        {fields.map((f) => {
          const value = item?.[f.name];
          const common = { id: f.name, name: f.name, required: f.required };
          return (
            <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint} error={fieldError(state, f.name)} className={f.wide || f.type === "textarea" || f.type === "checkboxes" ? "sm:col-span-2" : undefined}>
              {f.type === "textarea" ? (
                <Textarea {...common} rows={3} defaultValue={(value as string) ?? ""} />
              ) : f.type === "select" ? (
                <NativeSelect {...common} defaultValue={(value as string) ?? ""}>
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : f.type === "checkboxes" ? (
                <div className="flex flex-wrap gap-2">
                  {f.options?.map((o) => (
                    <label key={o.value} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                      <input
                        type="checkbox"
                        name={`${f.name}[]`}
                        value={o.value}
                        defaultChecked={Array.isArray(value) && value.includes(o.value)}
                        className="accent-[var(--primary)]"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              ) : (
                <Input
                  {...common}
                  type={f.type}
                  step={f.type === "number" ? "any" : undefined}
                  defaultValue={value === null || value === undefined ? "" : String(value)}
                />
              )}
            </Field>
          );
        })}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc("actions.cancel")}
        </Button>
        <SubmitButton pending={pending} pendingLabel={tc("actions.saving")}>{tc("actions.save")}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
