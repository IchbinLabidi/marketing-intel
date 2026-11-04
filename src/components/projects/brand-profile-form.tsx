"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { saveBrandProfileAction } from "@/server/actions/projects";
import type { BrandProfile } from "@/types/domain";
import { useT } from "@/i18n/client";

export function BrandProfileForm({ projectId, brand, readOnly }: { projectId: string; brand: BrandProfile | null; readOnly: boolean }) {
  const t = useT("projects");
  const tc = useT("common");
  const { state, pending, formProps } = useFormAction(saveBrandProfileAction.bind(null, projectId));
  useResultToast(state);
  const products = (brand?.products_services ?? []).map((p) => (p.description ? `${p.name} - ${p.description}` : p.name)).join("\n");
  return (
    <form {...formProps} className="grid gap-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("brand.brandName")} htmlFor="brand_name" error={fieldError(state, "brand_name")}>
          <Input id="brand_name" name="brand_name" defaultValue={brand?.brand_name ?? ""} />
        </Field>
        <Field label={t("brand.personality")} htmlFor="personality" hint={t("brand.personalityHint")}>
          <Input id="personality" name="personality" defaultValue={brand?.personality ?? ""} />
        </Field>
        <Field label={t("brand.mission")} htmlFor="mission">
          <Textarea id="mission" name="mission" defaultValue={brand?.mission ?? ""} rows={3} />
        </Field>
        <Field label={t("brand.vision")} htmlFor="vision">
          <Textarea id="vision" name="vision" defaultValue={brand?.vision ?? ""} rows={3} />
        </Field>
        <Field label={t("brand.targetAudience")} htmlFor="target_audience" className="sm:col-span-2" hint={t("brand.targetAudienceHint")}>
          <Textarea id="target_audience" name="target_audience" defaultValue={brand?.target_audience ?? ""} rows={3} />
        </Field>
        <Field label={t("brand.products")} htmlFor="products_services" hint={t("brand.productsHint")}>
          <Textarea id="products_services" name="products_services" defaultValue={products} rows={5} placeholder={t("brand.productsPlaceholder")} />
        </Field>
        <Field label={t("brand.values")} htmlFor="values" hint={t("brand.valuesHint")}>
          <Textarea id="values" name="values" defaultValue={(brand?.values ?? []).join("\n")} rows={5} />
        </Field>
        <Field label={t("brand.differentiators")} htmlFor="differentiators">
          <Textarea id="differentiators" name="differentiators" defaultValue={brand?.differentiators ?? ""} rows={3} />
        </Field>
        <Field label={t("brand.visualIdentity")} htmlFor="visual_identity" hint={t("brand.visualIdentityHint")}>
          <Textarea id="visual_identity" name="visual_identity" defaultValue={brand?.visual_identity ?? ""} rows={3} />
        </Field>
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <SubmitButton pending={pending} pendingLabel={tc("actions.saving")}>{t("brand.save")}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
