"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { saveBrandProfileAction } from "@/server/actions/projects";
import type { BrandProfile } from "@/types/domain";

export function BrandProfileForm({ projectId, brand, readOnly }: { projectId: string; brand: BrandProfile | null; readOnly: boolean }) {
  const { state, pending, formProps } = useFormAction(saveBrandProfileAction.bind(null, projectId));
  useResultToast(state);
  const products = (brand?.products_services ?? []).map((p) => (p.description ? `${p.name} - ${p.description}` : p.name)).join("\n");
  return (
    <form {...formProps} className="grid gap-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand name" htmlFor="brand_name" error={fieldError(state, "brand_name")}>
          <Input id="brand_name" name="brand_name" defaultValue={brand?.brand_name ?? ""} />
        </Field>
        <Field label="Personality" htmlFor="personality" hint="e.g. warm, expert, playful">
          <Input id="personality" name="personality" defaultValue={brand?.personality ?? ""} />
        </Field>
        <Field label="Mission" htmlFor="mission">
          <Textarea id="mission" name="mission" defaultValue={brand?.mission ?? ""} rows={3} />
        </Field>
        <Field label="Vision" htmlFor="vision">
          <Textarea id="vision" name="vision" defaultValue={brand?.vision ?? ""} rows={3} />
        </Field>
        <Field label="Target audience" htmlFor="target_audience" className="sm:col-span-2" hint="Who you sell to, in plain words. Personas are detailed in the strategy.">
          <Textarea id="target_audience" name="target_audience" defaultValue={brand?.target_audience ?? ""} rows={3} />
        </Field>
        <Field label="Products & services" htmlFor="products_services" hint='One per line. Optional description after " - ".'>
          <Textarea id="products_services" name="products_services" defaultValue={products} rows={5} placeholder={"Argan serum - flagship product\nGift boxes"} />
        </Field>
        <Field label="Brand values" htmlFor="values" hint="One per line.">
          <Textarea id="values" name="values" defaultValue={(brand?.values ?? []).join("\n")} rows={5} />
        </Field>
        <Field label="Differentiators" htmlFor="differentiators">
          <Textarea id="differentiators" name="differentiators" defaultValue={brand?.differentiators ?? ""} rows={3} />
        </Field>
        <Field label="Visual identity" htmlFor="visual_identity" hint="Colours, typography, imagery style.">
          <Textarea id="visual_identity" name="visual_identity" defaultValue={brand?.visual_identity ?? ""} rows={3} />
        </Field>
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <SubmitButton pending={pending} pendingLabel="Saving…">Save brand identity</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
