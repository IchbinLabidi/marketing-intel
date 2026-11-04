"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton, useResultToast, useFormAction } from "@/components/app/form";
import { createProjectAction } from "@/server/actions/projects";
import { ProjectFormFields } from "./project-form-fields";
import { useT } from "@/i18n/client";

export function CreateProjectDialog({ defaultOpen = false, disabled }: { defaultOpen?: boolean; disabled?: boolean }) {
  const t = useT("projects");
  const tc = useT("common");
  const [open, setOpen] = React.useState(defaultOpen);
  const { state, pending, formProps } = useFormAction(createProjectAction);
  useResultToast(state);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled} title={disabled ? t("create.readOnly") : undefined}>
          <Plus /> {t("create.newProject")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("create.newProject")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <form {...formProps} className="grid gap-5">
          <ProjectFormFields state={state} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <SubmitButton pending={pending} pendingLabel={tc("actions.creating")}>{t("create.submit")}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
