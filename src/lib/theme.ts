// Theme preference: "light" (default when nothing is stored), "dark", or "system" (follows the OS).
export const THEME_KEY = "signal-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

/**
 * Runs in <head> before the first paint, so the page never flashes the wrong theme.
 * Kept tiny and dependency-free; any storage error falls back to light.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export function readPreference(): ThemePreference {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === "dark" || p === "system" ? p : "light";
  } catch {
    return "light";
  }
}

export function resolveDark(p: ThemePreference) {
  return p === "dark" || (p === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Applies a theme to <html> without re-rendering the app, so forms, filters and views keep their state. */
export function applyTheme(p: ThemePreference) {
  const dark = resolveDark(p);
  const root = document.documentElement;
  // Suppress transitions for the instant of the switch so colours don't animate one by one.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}
