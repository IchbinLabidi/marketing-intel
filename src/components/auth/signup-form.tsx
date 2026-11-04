"use client";

import { MailCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Field, SubmitButton, fieldError, useFormAction } from "@/components/app/form";
import { signUpAction } from "@/server/actions/auth";
import { useT } from "@/i18n/client";

/** `next` (e.g. an invitation link) is where the new account goes after signing up. */
export function SignupForm({ next }: { next?: string }) {
  const joining = Boolean(next?.startsWith("/invite/"));
  const { state, pending, formProps } = useFormAction(signUpAction);
  const t = useT("auth");
  if (state?.ok && state.message) {
    return <Alert variant="success" title={t("signup.checkInbox")}>
        <span className="inline-flex items-start gap-1.5"><MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{state.message}</span>
      </Alert>;
  }
  return (
    <form {...formProps} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label={t("fields.fullName")} htmlFor="full_name" error={fieldError(state, "full_name")}>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      {joining ? null : (
        <Field label={t("fields.company")} htmlFor="workspace_name" optional hint={t("fields.companyHint")}>
          <Input id="workspace_name" name="workspace_name" autoComplete="organization" />
        </Field>
      )}
      <Field label={t("fields.workEmail")} htmlFor="email" error={fieldError(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={t("fields.password")} htmlFor="password" error={fieldError(state, "password")} hint={t("fields.passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state && !state.ok && !state.fieldErrors ? <Alert variant="destructive">{state.error}</Alert> : null}
      <SubmitButton pending={pending} pendingLabel={t("signup.submitting")} size="lg" className="mt-1 w-full">{t("signup.submit")}</SubmitButton>
    </form>
  );
}
