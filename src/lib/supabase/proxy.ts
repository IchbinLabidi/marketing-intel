import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from "@/lib/env";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";

// Meta's server-to-server callbacks and the scheduler have no user session; they authenticate with a
// signed_request (HMAC with the app secret) or CRON_SECRET instead.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/setup", "/api/meta/deauthorize", "/api/meta/data-deletion", "/api/cron", "/tiktok-media", "/meta/data-deletion", "/privacy", "/terms", "/invite"];
export const ACTIVE_PROJECT_COOKIE = "mi_project";

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    if (pathname.startsWith("/setup")) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the auth token if needed. Do not put logic between client creation and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `?lang=fr|en` (shareable links, hreflang alternates of public pages) is an explicit choice: remember it.
  const langParam = request.nextUrl.searchParams.get("lang");
  if (isLocale(langParam) && request.cookies.get(LOCALE_COOKIE)?.value !== langParam) {
    request.cookies.set(LOCALE_COOKIE, langParam);
    const forwarded = NextResponse.next({ request });
    response.cookies.getAll().forEach((c) => forwarded.cookies.set(c));
    response = forwarded;
    response.cookies.set(LOCALE_COOKIE, langParam, { path: "/", sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE });
  }

  // Restore the language saved on the user's profile (e.g. chosen on another device) when this browser has no choice yet.
  const savedLocale = user?.user_metadata?.locale;
  if (!request.cookies.get(LOCALE_COOKIE) && isLocale(savedLocale)) {
    request.cookies.set(LOCALE_COOKIE, savedLocale);
    const forwarded = NextResponse.next({ request });
    response.cookies.getAll().forEach((c) => forwarded.cookies.set(c));
    response = forwarded;
    response.cookies.set(LOCALE_COOKIE, savedLocale, { path: "/", sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE });
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Server Function calls (POST + Next-Action header) are never redirected here: a redirected call receives an HTML
  // page instead of its result ("An unexpected response was received from the server"), e.g. signing in while the
  // session became valid in another tab, or any action after the session expired. Each action checks the user itself
  // (requireUser / getProjectContext), and its own redirect() is handled correctly by the client.
  const isServerFunction = request.method === "POST" && request.headers.has("next-action");
  if (isServerFunction) return response;
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Remember the last opened project so the sidebar's project modules point to it.
  const match = pathname.match(/^\/p\/([0-9a-f-]{36})/);
  if (match && request.cookies.get(ACTIVE_PROJECT_COOKIE)?.value !== match[1]) {
    // Also set it on the forwarded request so this very render already sees the new project.
    request.cookies.set(ACTIVE_PROJECT_COOKIE, match[1]);
    const forwarded = NextResponse.next({ request });
    response.cookies.getAll().forEach((c) => forwarded.cookies.set(c));
    response = forwarded;
    response.cookies.set(ACTIVE_PROJECT_COOKIE, match[1], { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }

  return response;
}
