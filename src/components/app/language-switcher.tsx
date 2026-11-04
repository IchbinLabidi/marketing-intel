"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n, useT } from "@/i18n/client";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { MESSAGE_LOADERS } from "@/i18n/messages";
import { setLocaleAction } from "@/i18n/actions";
import { cn } from "@/lib/utils";

/**
 * Switches the language in place: client text updates at once from the new dictionary, then Server Components
 * re-render with router.refresh(). No page reload, so the route, scroll position, open panels and typed form
 * input are all kept.
 */
export function useSwitchLocale() {
  const router = useRouter();
  const { locale, setMessages } = useI18n();
  const [pending, startTransition] = React.useTransition();
  const switchTo = React.useCallback(
    async (next: Locale) => {
      if (next === locale) return;
      const messages = await MESSAGE_LOADERS[next]();
      setMessages(next, messages);
      document.documentElement.lang = next;
      await setLocaleAction(next);
      startTransition(() => router.refresh());
    },
    [locale, router, setMessages],
  );
  return { locale, switchTo, pending };
}

/**
 * `size="sm"`: compact "🇫🇷 FR" menu for the sidebar and auth pages.
 * Default: a segmented control with both languages spelled out, for Settings.
 */
export function LanguageSwitcher({ size = "default", className }: { size?: "default" | "sm"; className?: string }) {
  const t = useT("common");
  const { locale, switchTo, pending } = useSwitchLocale();

  if (size === "sm") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("language.current", { language: LOCALE_META[locale].label })}
          title={t("language.label")}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-secondary px-1.5 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
            pending && "opacity-70",
            className,
          )}
        >
          <span aria-hidden>{LOCALE_META[locale].flag}</span>
          <span>{LOCALE_META[locale].short}</span>
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-40">
          <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
          {LOCALES.map((l) => (
            <DropdownMenuItem key={l} onSelect={() => void switchTo(l)} lang={l} aria-current={l === locale ? "true" : undefined}>
              <span aria-hidden>{LOCALE_META[l].flag}</span>
              <span className="flex-1">{LOCALE_META[l].label}</span>
              {l === locale ? <Check aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div role="radiogroup" aria-label={t("language.label")} className={cn("inline-flex items-center gap-0.5 rounded-md bg-secondary p-0.5", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          lang={l}
          aria-checked={locale === l}
          onClick={() => void switchTo(l)}
          onKeyDown={(e) => {
            // Arrow keys move between the options, as in a native radio group.
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const i = LOCALES.indexOf(l) + (e.key === "ArrowRight" ? 1 : -1);
            const next = LOCALES[(i + LOCALES.length) % LOCALES.length];
            void switchTo(next);
            (e.currentTarget.parentElement?.querySelector(`[lang="${next}"]`) as HTMLElement | null)?.focus();
          }}
          tabIndex={locale === l ? 0 : -1}
          className={cn(
            "inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors",
            locale === l ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span aria-hidden>{LOCALE_META[l].flag}</span>
          {LOCALE_META[l].label}
        </button>
      ))}
    </div>
  );
}
