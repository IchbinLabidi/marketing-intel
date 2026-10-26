import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, fieldError } from "@/components/app/form";
import { LANGUAGES, LANGUAGE_LABELS } from "@/lib/domain/constants";
import type { ActionResult } from "@/lib/validation/common";
import type { Project } from "@/types/domain";

export function ProjectFormFields({ project, state }: { project?: Project; state: ActionResult | null }) {
  return (
    <div className="grid gap-4">
      <Field label="Project name" htmlFor="name" error={fieldError(state, "name")}>
        <Input id="name" name="name" defaultValue={project?.name} placeholder="e.g. Maison Jasmin — 2026" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Industry" htmlFor="industry" error={fieldError(state, "industry")}>
          <Input id="industry" name="industry" defaultValue={project?.industry ?? ""} placeholder="e.g. Cosmetics" />
        </Field>
        <Field label="Default content language" htmlFor="default_language">
          <NativeSelect id="default_language" name="default_language" defaultValue={project?.default_language ?? "fr"}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Website" htmlFor="website" error={fieldError(state, "website")}>
        <Input id="website" name="website" defaultValue={project?.website ?? ""} placeholder="example.com" />
      </Field>
      <Field label="Description" htmlFor="description" error={fieldError(state, "description")}>
        <Textarea id="description" name="description" defaultValue={project?.description ?? ""} placeholder="What is this brand and what does this project cover?" />
      </Field>
    </div>
  );
}
