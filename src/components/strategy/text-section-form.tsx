"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Field, SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import type { ActionResult } from "@/lib/validation/common";
import type { StrategySection } from "@/server/ai/strategy";
import { AISuggest, PreviewField, type SuggestionNotes } from "./ai-suggest";

export type TextField = { name: string; label: string; hint?: string; placeholder?: string; rows?: number };

/** A strategy section made of free-text fields, with save + AI suggestion (applied into the form, not saved). */
export function TextSectionForm({
  projectId,
  section,
  fields,
  initial,
  action: serverAction,
  readOnly,
  aiEnabled,
  submitLabel = "Save",
  columns = 1,
}: {
  projectId: string;
  section: StrategySection;
  fields: TextField[];
  initial: Record<string, string | null | undefined>;
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  readOnly: boolean;
  aiEnabled: boolean;
  submitLabel?: string;
  columns?: 1 | 2;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? ""])),
  );
  const [dirty, setDirty] = React.useState(false);
  const { state, pending, formProps } = useFormAction(serverAction);
  useResultToast(state, () => setDirty(false));

  return (
    <form {...formProps} className="grid gap-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : " "}</p>
        {!readOnly ? (
          <AISuggest<Record<string, string> & { notes: SuggestionNotes }>
            projectId={projectId}
            section={section}
            aiEnabled={aiEnabled}
            label={Object.values(values).some(Boolean) ? "Improve with AI" : "Draft with AI"}
            renderPreview={(d) => (
              <div className="grid gap-3">
                {fields.map((f) => (
                  <PreviewField key={f.name} label={f.label} value={d[f.name]} />
                ))}
              </div>
            )}
            onApply={(d) => {
              setValues(Object.fromEntries(fields.map((f) => [f.name, d[f.name] ?? ""])));
              setDirty(true);
            }}
          />
        ) : null}
      </div>
      <fieldset disabled={readOnly} className={columns === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {fields.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint} error={fieldError(state, f.name)}>
            <Textarea
              id={f.name}
              name={f.name}
              rows={f.rows ?? 4}
              placeholder={f.placeholder}
              value={values[f.name]}
              onChange={(e) => {
                setValues((v) => ({ ...v, [f.name]: e.target.value }));
                setDirty(true);
              }}
            />
          </Field>
        ))}
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <SubmitButton pending={pending} pendingLabel="Saving…">{submitLabel}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
