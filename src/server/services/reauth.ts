import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "@/lib/env";
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
