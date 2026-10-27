"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/validation/common";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  optional,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Marks the field as required in the label (the input itself still needs `required`). */
  required?: boolean;
  /** Marks the field as optional in the label; use where most fields in the form are required. */
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : optional ? (
          <span className="font-normal text-subtle-foreground">Optional</span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  pending: pendingProp,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/**
 * Wraps a Server Action for a <form onSubmit>. Unlike <form action>, React does not reset the form
 * afterwards, so a validation error keeps what the user typed. Pass `resetOnSuccess` to clear it on success.
 */
export function useFormAction<R extends ActionResult<unknown>>(
  serverAction: (prev: R | null, formData: FormData) => Promise<R>,
  { resetOnSuccess = false }: { resetOnSuccess?: boolean } = {},
) {
  const [state, dispatch, pending] = React.useActionState(serverAction, null);
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    React.startTransition(() => dispatch(formData));
  };
  return { state, pending, formProps: { ref: formRef, onSubmit } };
}

/** Shows a toast whenever a Server Action returns a new result. */
export function useResultToast(state: ActionResult<unknown> | null, onSuccess?: () => void) {
  const last = React.useRef<typeof state>(null);
  React.useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      onSuccess?.();
    } else {
      toast.error(state.error);
    }
  }, [state, onSuccess]);
}

export function fieldError(state: ActionResult<unknown> | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}
