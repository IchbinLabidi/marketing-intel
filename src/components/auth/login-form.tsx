"use client";

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
      {state && !state.ok && !state.fieldErrors ? <p className="text-[13px] text-destructive">{state.error}</p> : null}
      <SubmitButton pending={pending} pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
