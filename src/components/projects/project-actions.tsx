"use client";

import * as React from "react";
import { useTransition } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SubmitButton, useResultToast, useFormAction } from "@/components/app/form";
import { archiveProjectAction, deleteProjectAction, updateProjectAction } from "@/server/actions/projects";
import type { Project } from "@/types/domain";
import { ProjectFormFields } from "./project-form-fields";

export function ProjectActions({ project, canEdit, canAdmin }: { project: Project; canEdit: boolean; canAdmin: boolean }) {
  const [dialog, setDialog] = React.useState<"edit" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const { state, pending: saving, formProps } = useFormAction(updateProjectAction.bind(null, project.id));
  const [confirm, setConfirm] = React.useState("");
  useResultToast(state, () => setDialog(null));

  if (!canEdit) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Project actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <Pencil /> Edit project details
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              startTransition(async () => {
                const r = await archiveProjectAction(project.id, !project.archived_at);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            {project.archived_at ? <ArchiveRestore /> : <Archive />}
            {project.archived_at ? "Restore project" : "Archive project"}
          </DropdownMenuItem>
          {canAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <form {...formProps} className="grid gap-5">
            <ProjectFormFields project={project} state={state} />
            <DialogFooter>
              <SubmitButton pending={saving} pendingLabel="Saving…">Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{project.name}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the project with its strategy, imports, competitors, calendars and content. This cannot be undone.
              Type the project name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={project.name} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm !== project.name || pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await deleteProjectAction(project.id);
                  if (r && !r.ok) toast.error(r.error);
                })
              }
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
