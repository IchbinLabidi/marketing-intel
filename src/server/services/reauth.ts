import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "@/lib/env";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { CurrentUser } from "./session";

/**
 * Re-checks the signed-in user's account password on the server, for destructive actions.
 * Uses a throwaway client with no cookies, so the browser session is never touched, and signs the
 * temporary session out again right away.
 */
export async function verifyCurrentPassword(user: CurrentUser, password: string): Promise<boolean> {
  if (!user.email || !password) return false;
  const verifier = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (error || !data.user) return false;
  const sameUser = data.user.id === user.id;
  await verifier.auth.signOut({ scope: "local" }).catch(() => {});
  return sameUser;
}

/** How long an emailed sign-in link counts as a fresh identity check for destructive actions. */
export const RECENT_EMAIL_REAUTH_MS = 10 * 60 * 1000;

/** Sign-in methods that prove the person controls the account's inbox (or identity provider) right now. */
const LINK_METHODS = new Set(["otp", "magiclink", "oauth", "email/signup"]);

/**
 * When the current session was last confirmed through an emailed link (or an identity provider),
 * read from the verified JWT's `amr` claim. Returns the time in ms, or null.
 * A password sign-in never counts here: password accounts keep confirming with the password.
 */
export async function lastLinkReauthAt(user: CurrentUser): Promise<number | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims || data.claims.sub !== user.id) return null;
  const amr = Array.isArray(data.claims.amr) ? data.claims.amr : [];
  let latest: number | null = null;
  for (const entry of amr) {
    if (!entry || typeof entry !== "object") continue;
    const { method, timestamp } = entry as { method?: string; timestamp?: number };
    if (!method || !LINK_METHODS.has(method) || typeof timestamp !== "number") continue;
    const ms = timestamp * 1000;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/** True when the session was confirmed through an emailed link in the last few minutes. */
export async function hasRecentLinkReauth(user: CurrentUser): Promise<boolean> {
  const at = await lastLinkReauthAt(user);
  return at !== null && Date.now() - at <= RECENT_EMAIL_REAUTH_MS && at <= Date.now() + 60_000;
}

/**
 * Emails the signed-in user a one-time sign-in link to their own address. Opening it (in this
 * browser) refreshes the session with a new "otp" sign-in, which hasRecentLinkReauth accepts.
 * Never creates an account.
 */
export async function sendReauthLink(user: CurrentUser, redirectTo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!user.email) return { ok: false, error: "no_email" };
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
