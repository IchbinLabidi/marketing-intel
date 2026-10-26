"use client";

import { Input } from "@/components/ui/input";
import { SubmitButton, fieldError, useResultToast, useFormAction } from "@/components/app/form";
import { createWorkspaceAction, renameWorkspaceAction } from "@/server/actions/workspaces";

export function RenameWorkspaceForm({ workspaceId, name, disabled }: { workspaceId: string; name: string; disabled: boolean }) {
  const { state, pending, formProps } = useFormAction(renameWorkspaceAction.bind(null, workspaceId));
  useResultToast(state);
  return (
    <form {...formProps} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input name="name" defaultValue={name} disabled={disabled} aria-label="Workspace name" />
        {fieldError(state, "name") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "name")}</p> : null}
      </div>
      {!disabled ? <SubmitButton pending={pending} variant="outline" pendingLabel="Saving…">Rename</SubmitButton> : null}
    </form>
  );
}

export function CreateWorkspaceForm() {
  const { state, pending, formProps } = useFormAction(createWorkspaceAction, { resetOnSuccess: true });
  useResultToast(state);
  return (
    <form {...formProps} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Input name="name" placeholder="e.g. Client: Maison Jasmin" aria-label="New workspace name" />
        {fieldError(state, "name") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "name")}</p> : null}
      </div>
      <SubmitButton pending={pending} variant="outline" pendingLabel="Creating…">Create workspace</SubmitButton>
    </form>
  );
}
