"use client";

import { Input } from "@/components/ui/input";
import { SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { createWorkspaceAction, renameWorkspaceAction } from "@/server/actions/workspaces";
import { useT } from "@/i18n/client";

export function RenameWorkspaceForm({ workspaceId, name, disabled }: { workspaceId: string; name: string; disabled: boolean }) {
  const t = useT("dashboard");
  const tc = useT("common");
  const { state, pending, formProps } = useFormAction(renameWorkspaceAction.bind(null, workspaceId));
  useResultToast(state);
  return (
    <form {...formProps} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input name="name" defaultValue={name} disabled={disabled} aria-label={t("workspace.nameLabel")} />
        {fieldError(state, "name") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "name")}</p> : null}
      </div>
      {!disabled ? <SubmitButton pending={pending} variant="outline" pendingLabel={tc("actions.saving")}>{t("workspace.rename")}</SubmitButton> : null}
    </form>
  );
}

export function CreateWorkspaceForm() {
  const t = useT("dashboard");
  const tc = useT("common");
  const { state, pending, formProps } = useFormAction(createWorkspaceAction, { resetOnSuccess: true });
  useResultToast(state);
  return (
    <form {...formProps} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input name="name" placeholder={t("workspace.newNamePlaceholder")} aria-label={t("workspace.newNameLabel")} />
        {fieldError(state, "name") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "name")}</p> : null}
      </div>
      <SubmitButton pending={pending} variant="outline" pendingLabel={tc("actions.creating")}>{t("workspace.create")}</SubmitButton>
    </form>
  );
}
