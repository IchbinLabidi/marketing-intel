"use client";

import * as React from "react";
import { useTransition } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SubmitButton, useResultToast, useFormAction } from "@/components/app/form";
import { archiveProjectAction, updateProjectAction } from "@/server/actions/projects";
import type { Project } from "@/types/domain";
import { ProjectFormFields } from "./project-form-fields";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { useT } from "@/i18n/client";

export function ProjectActions({ project, canEdit, canAdmin }: { project: Project; canEdit: boolean; canAdmin: boolean }) {
  const t = useT("projects");
  const tc = useT("common");
  const [dialog, setDialog] = React.useState<"edit" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const { state, pending: saving, formProps } = useFormAction(updateProjectAction.bind(null, project.id));
  useResultToast(state, () => setDialog(null));

  if (!canEdit) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={t("menu.label")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <Pencil /> {t("menu.edit")}
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
            {project.archived_at ? t("menu.restore") : t("menu.archive")}
          </DropdownMenuItem>
          {canAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                <Trash2 /> {t("menu.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("menu.editTitle")}</DialogTitle>
          </DialogHeader>
          <form {...formProps} className="grid gap-5">
            <ProjectFormFields project={project} state={state} />
            <DialogFooter>
              <SubmitButton pending={saving} pendingLabel={tc("actions.saving")}>{tc("actions.save")}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {canAdmin ? (
        <DeleteProjectDialog project={project} open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)} />
      ) : null}
    </>
  );
}
