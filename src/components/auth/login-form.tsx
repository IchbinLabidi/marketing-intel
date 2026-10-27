"use client";

import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Field, SubmitButton, fieldError, useFormAction } from "@/components/app/form";
import { signInAction } from "@/server/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const { state, pending, formProps } = useFormAction(signInAction);
  return (
    <form {...formProps} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldError(state, "password")}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok && !state.fieldErrors ? <Alert variant="destructive">{state.error}</Alert> : null}
      <SubmitButton pending={pending} pendingLabel="Signing in…" size="lg" className="mt-1 w-full">Sign in</SubmitButton>
    </form>
  );
}
