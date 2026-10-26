"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton, useResultToast, useFormAction } from "@/components/app/form";
import { createProjectAction } from "@/server/actions/projects";
import { ProjectFormFields } from "./project-form-fields";

export function CreateProjectDialog({ defaultOpen = false, disabled }: { defaultOpen?: boolean; disabled?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const { state, pending, formProps } = useFormAction(createProjectAction);
  useResultToast(state);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled} title={disabled ? "Your role is read-only" : undefined}>
          <Plus /> New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>A project is one brand or client with its own strategy, history, competitors and calendar.</DialogDescription>
        </DialogHeader>
        <form {...formProps} className="grid gap-5">
          <ProjectFormFields state={state} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending} pendingLabel="Creating…">Create project</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
