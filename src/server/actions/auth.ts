"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formToObject, zodErrorToResult, type ActionResult } from "@/lib/validation/common";

const credentials = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  next: z.string().optional().nullable(),
});

/** Network failures surface as "fetch failed" from the HTTP client; say what it means instead. */
function authErrorMessage(error: { message: string; status?: number; name?: string }) {
  if (/fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND/i.test(error.message) || error.name === "AuthRetryableFetchError") {
    return "Can't reach the sign-in service right now. Check your internet connection and try again.";
  }
  return error.message;
}

function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signInAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { ok: false, error: authErrorMessage(error) };
  redirect(safeNext(parsed.data.next));
}

const signUpSchema = credentials.extend({
  full_name: z.string().trim().min(1, "Required").max(120),
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
      emailRedirectTo: `${origin}/auth/callback`,
      data: { full_name: parsed.data.full_name, workspace_name: parsed.data.workspace_name || "" },
    },
  });
  if (error) return { ok: false, error: authErrorMessage(error) };
  if (!data.session) {
    return { ok: true, message: "Check your inbox to confirm your email, then sign in." };
  }
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
