"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, readPreference, THEME_KEY, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// The preference lives in localStorage (read before paint by THEME_SCRIPT); this store keeps every switcher in sync.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === THEME_KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function setPreference(p: ThemePreference) {
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {
    // Private mode: the choice still applies for this page view.
  }
  applyTheme(p);
  listeners.forEach((l) => l());
}

export function useThemePreference() {
  return React.useSyncExternalStore(subscribe, readPreference, () => "light" as ThemePreference);
}

/** Light / Dark / System. `size="sm"` is the compact icon-only version for the sidebar. */
export function ThemeSwitcher({ size = "default", className }: { size?: "default" | "sm"; className?: string }) {
  const pref = useThemePreference();

  // Follow the OS while "System" is selected, and other tabs' changes.
  React.useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex items-center gap-0.5 rounded-md bg-secondary p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={size === "sm" ? `${label} theme` : undefined}
          title={size === "sm" ? `${label} theme` : undefined}
          onClick={() => setPreference(value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors",
            size === "sm" ? "size-6" : "h-7 px-2.5 text-[13px]",
            pref === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
          {size === "sm" ? null : label}
        </button>
      ))}
    </div>
  );
}
