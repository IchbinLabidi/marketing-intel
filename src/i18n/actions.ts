"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "./config";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/** Saves the explicit language choice: a long-lived cookie, plus the signed-in user's profile so it follows them to other devices. */
export async function setLocaleAction(locale: Locale): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE });
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user && data.user.user_metadata?.locale !== locale) await supabase.auth.updateUser({ data: { locale } });
    } catch {
      // The cookie alone still keeps the choice on this browser.
    }
  }
  return { ok: true };
}
