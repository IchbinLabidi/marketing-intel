"use client";

import * as React from "react";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form";
import { deleteProjectAction } from "@/server/actions/projects";
import { useT } from "@/i18n/client";

/**
 * Password-confirmed hard delete. Only render it for owners and admins; the server checks the role
 * and the password again, so hiding it is a convenience, not the protection.
 */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  after = "projects",
}: {
  project: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  after?: "dashboard" | "projects";
}) {
  const t = useT("projects");
  const tc = useT("common");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = React.useId();

  const changeOpen = (o: boolean) => {
    if (pending) return;
    if (!o) {
      setPassword("");
      setError(null);
    }
    onOpenChange(o);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || pending) return;
    setError(null);
    startTransition(async () => {
      // On success the action redirects, so only a failure comes back here.
      const r = await deleteProjectAction(project.id, password, after);
      if (r && !r.ok) setError(r.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("delete.title", { name: project.name })}</DialogTitle>
            <DialogDescription>{t("delete.description")}</DialogDescription>
          </DialogHeader>
          <Field label={t("delete.password")} htmlFor={inputId} error={error ?? undefined}>
            <Input
              id={inputId}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!password} loading={pending}>
              {t("delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Small trash button for project cards (dashboard). */
export function DeleteProjectButton({ project, after = "dashboard" }: { project: { id: string; name: string }; after?: "dashboard" | "projects" }) {
  const t = useT("projects");
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label={t("delete.buttonLabel", { name: project.name })}
        title={t("delete.buttonTitle")}
      >
        <Trash2 className="size-4" />
      </button>
      <DeleteProjectDialog project={project} open={open} onOpenChange={setOpen} after={after} />
    </>
  );
}
