"use client";

import { Input } from "@/components/ui/input";
import { Field, SubmitButton, fieldError, useFormAction } from "@/components/app/form";
import { signUpAction } from "@/server/actions/auth";

export function SignupForm() {
  const { state, pending, formProps } = useFormAction(signUpAction);
  if (state?.ok && state.message) {
    return <div className="rounded-lg border bg-card p-4 text-[13px]">{state.message}</div>;
  }
  return (
    <form {...formProps} className="grid gap-4">
      <Field label="Full name" htmlFor="full_name" error={fieldError(state, "full_name")}>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field label="Company or agency" htmlFor="workspace_name" hint="Becomes your workspace name. You can change it later.">
        <Input id="workspace_name" name="workspace_name" autoComplete="organization" />
      </Field>
      <Field label="Work email" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldError(state, "password")} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state && !state.ok && !state.fieldErrors ? <p className="text-[13px] text-destructive">{state.error}</p> : null}
      <SubmitButton pending={pending} pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}
