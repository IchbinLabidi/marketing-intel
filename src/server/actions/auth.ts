"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formToObject, type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
import { getT } from "@/i18n/server";
import { authErrorText } from "./auth-errors";

const credentials = z.object({
  email: z.email("v:invalidEmailEntry"),
  password: z.string().min(8, "v:passwordLength"),
  next: z.string().optional().nullable(),
});

/** Network failures surface as "fetch failed" from the HTTP client; say what it means instead (in the user's language). */
async function authErrorMessage(error: { message: string; status?: number; name?: string }) {
  return authErrorText(error.message, await getT("auth"), error.name);
}

function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signInAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { ok: false, error: await authErrorMessage(error) };
  redirect(safeNext(parsed.data.next));
}

const signUpSchema = credentials.extend({
  full_name: z.string().trim().min(1, "v:required").max(120),
  workspace_name: z.string().trim().max(120).optional().nullable(),
});

export async function signUpAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback${parsed.data.next ? `?next=${encodeURIComponent(safeNext(parsed.data.next))}` : ""}`,
      data: { full_name: parsed.data.full_name, workspace_name: parsed.data.workspace_name || "" },
    },
  });
  if (error) return { ok: false, error: await authErrorMessage(error) };
  if (!data.session) {
    return { ok: true, message: (await getT("auth"))("signup.confirmEmail") };
  }
  // from an invitation: back to it, so the person joins the team instead of staying in their own new workspace
  redirect(safeNext(parsed.data.next));
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
