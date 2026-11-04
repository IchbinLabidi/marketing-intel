"use client";

import * as React from "react";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form";
import { deleteProjectAction, getDeleteConfirmationStatusAction, sendDeleteConfirmationLinkAction } from "@/server/actions/projects";
import { useT } from "@/i18n/client";

/**
 * Hard delete, confirmed by typing the project name plus an identity check: the account password,
 * or (for people who sign in without knowing it) a one-time sign-in link sent to their email.
 * Only render it for owners and admins; the server checks the role, the name and the identity
 * again, so hiding it is a convenience, not the protection.
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
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"password" | "email">("password");
  const [status, setStatus] = React.useState<{ emailVerified: boolean; email: string } | null>(null);
  const [linkSent, setLinkSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sending, startSending] = useTransition();
  const nameId = React.useId();
  const passwordId = React.useId();

  // Ask the server whether this session was just confirmed through an emailed link.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getDeleteConfirmationStatusAction(project.id)
      .then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        setStatus(r.data);
        if (r.data.emailVerified) setMode("email");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  const changeOpen = (o: boolean) => {
    if (pending) return;
    if (!o) {
      setName("");
      setPassword("");
      setMode("password");
      setLinkSent(false);
      setError(null);
    }
    onOpenChange(o);
  };

  const emailVerified = Boolean(status?.emailVerified);
  const nameOk = normalizeName(name) === normalizeName(project.name);
  const canSubmit = nameOk && (mode === "password" ? Boolean(password) : emailVerified);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      // On success the action redirects, so only a failure comes back here.
      const r = await deleteProjectAction(project.id, { name, password: mode === "password" ? password : undefined }, after);
      if (r && !r.ok) setError(r.error);
    });
  };

  const sendLink = () => {
    if (sending) return;
    setError(null);
    startSending(async () => {
      const r = await sendDeleteConfirmationLinkAction(project.id, window.location.pathname);
      if (r.ok) setLinkSent(true);
      else setError(r.error);
    });
  };

  const linkButton = "justify-self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("delete.title", { name: project.name })}</DialogTitle>
            <DialogDescription>{t("delete.description")}</DialogDescription>
          </DialogHeader>
          <Field label={t("delete.nameLabel", { name: project.name })} htmlFor={nameId}>
            <Input
              id={nameId}
              autoComplete="off"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </Field>
          {mode === "password" ? (
            <div className="grid gap-2">
              <Field label={t("delete.password")} htmlFor={passwordId} error={error ?? undefined}>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                />
              </Field>
              <button
                type="button"
                className={linkButton}
                onClick={() => {
                  setMode("email");
                  setPassword("");
                  setError(null);
                }}
              >
                {t("delete.noPassword")}
              </button>
            </div>
          ) : (
            <div className="grid gap-3 rounded-md border p-3 text-sm">
              {emailVerified ? (
                <p className="text-foreground">{t("delete.emailVerified")}</p>
              ) : linkSent ? (
                <p className="text-foreground">{t("delete.linkSentHint", { email: status?.email ?? "" })}</p>
              ) : (
                <>
                  <p className="text-muted-foreground">{t("delete.sendingTo", { email: status?.email ?? "" })}</p>
                  <Button type="button" variant="outline" loading={sending} onClick={sendLink} className="justify-self-start">
                    {t("delete.sendLink")}
                  </Button>
                </>
              )}
              {error ? <p className="text-destructive">{error}</p> : null}
              <button
                type="button"
                className={linkButton}
                onClick={() => {
                  setMode("password");
                  setError(null);
                }}
              >
                {t("delete.usePassword")}
              </button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!canSubmit} loading={pending}>
              {t("delete.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Calls onReturn once when the page was opened from the emailed delete-confirmation link for this
 * project, and removes the marker from the address bar so a reload doesn't reopen the dialog.
 */
export function useConfirmDeleteReturn(projectId: string, onReturn: () => void) {
  const callback = React.useRef(onReturn);
  React.useEffect(() => {
    callback.current = onReturn;
  });
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("confirmDelete") !== projectId) return;
    url.searchParams.delete("confirmDelete");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    callback.current();
  }, [projectId]);
}

/** Small trash button for project cards (dashboard). */
export function DeleteProjectButton({ project, after = "dashboard" }: { project: { id: string; name: string }; after?: "dashboard" | "projects" }) {
  const t = useT("projects");
  const [open, setOpen] = React.useState(false);
  useConfirmDeleteReturn(project.id, () => setOpen(true));
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
