import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldError } from "@/components/app/form";
import { LANGUAGES } from "@/lib/domain/constants";
import type { ActionResult } from "@/lib/validation/common";
import type { Project } from "@/types/domain";
import { useT } from "@/i18n/client";

export function ProjectFormFields({ project, state }: { project?: Project; state: ActionResult | null }) {
  const t = useT("projects");
  const td = useT("domain");
  return (
    <div className="grid gap-4">
      <Field label={t("form.name")} htmlFor="name" error={fieldError(state, "name")}>
        <Input id="name" name="name" defaultValue={project?.name} placeholder={t("form.namePlaceholder")} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.industry")} htmlFor="industry" error={fieldError(state, "industry")}>
          <Input id="industry" name="industry" defaultValue={project?.industry ?? ""} placeholder={t("form.industryPlaceholder")} />
        </Field>
        <Field label={t("form.language")} htmlFor="default_language">
          <NativeSelect id="default_language" name="default_language" defaultValue={project?.default_language ?? "fr"}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {td(`language.${l}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label={t("form.website")} htmlFor="website" error={fieldError(state, "website")}>
        <Input id="website" name="website" defaultValue={project?.website ?? ""} placeholder="example.com" />
      </Field>
      <Field label={t("form.description")} htmlFor="description" error={fieldError(state, "description")}>
        <Textarea id="description" name="description" defaultValue={project?.description ?? ""} placeholder={t("form.descriptionPlaceholder")} />
      </Field>
    </div>
  );
}
