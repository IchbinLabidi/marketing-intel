"use client";

import { MailCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Field, SubmitButton, fieldError, useFormAction } from "@/components/app/form";
import { signUpAction } from "@/server/actions/auth";

export function SignupForm() {
  const { state, pending, formProps } = useFormAction(signUpAction);
  if (state?.ok && state.message) {
    return <Alert variant="success" title="Check your inbox">
        <span className="inline-flex items-start gap-1.5"><MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{state.message}</span>
      </Alert>;
  }
  return (
    <form {...formProps} className="grid gap-4">
      <Field label="Full name" htmlFor="full_name" error={fieldError(state, "full_name")}>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field label="Company or agency" htmlFor="workspace_name" optional hint="Becomes your workspace name. You can change it later.">
        <Input id="workspace_name" name="workspace_name" autoComplete="organization" />
      </Field>
      <Field label="Work email" htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldError(state, "password")} hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state && !state.ok && !state.fieldErrors ? <Alert variant="destructive">{state.error}</Alert> : null}
      <SubmitButton pending={pending} pendingLabel="Creating account…" size="lg" className="mt-1 w-full">Create account</SubmitButton>
    </form>
  );
}
