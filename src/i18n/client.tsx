"use client";

import * as React from "react";
import { createTranslator, type MessageTree } from "./core";
import type { KeysOf, TFor } from "./messages";
import { createFormatter, type Formatter } from "./format";
import type { Locale } from "./config";
import type { Namespace } from "./locales/en";

type I18nState = { locale: Locale; messages: MessageTree; fmt: Formatter; setMessages: (locale: Locale, messages: MessageTree) => void };
const I18nContext = React.createContext<I18nState | null>(null);

/** Mounted once in the root layout with the server-resolved locale, so the first paint is already in the right language. */
export function I18nProvider({ locale: initialLocale, messages: initialMessages, children }: { locale: Locale; messages: MessageTree; children: React.ReactNode }) {
  const [state, setState] = React.useState({ locale: initialLocale, messages: initialMessages });
  // A server refresh after a switch (or a new tab) brings a new locale down: adopt it.
  const [seen, setSeen] = React.useState(initialLocale);
  if (initialLocale !== seen) {
    setSeen(initialLocale);
    setState({ locale: initialLocale, messages: initialMessages });
  }
  const value = React.useMemo<I18nState>(
    () => ({
      locale: state.locale,
      messages: state.messages,
      fmt: createFormatter(state.locale),
      setMessages: (locale, messages) => setState({ locale, messages }),
    }),
    [state],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18nState() {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useT/useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Translator for one namespace in Client Components: `const t = useT("calendar"); t("toolbar.today")`. */
export function useT<N extends Namespace>(namespace: N): TFor<N> {
  const { locale, messages } = useI18nState();
  return React.useMemo(
    () => createTranslator<KeysOf[N]>(locale, namespace, messages[namespace] as MessageTree | undefined),
    [locale, messages, namespace],
  );
}

/** Current locale and its formatter (dates, numbers, currency, relative time). */
export function useI18n() {
  const { locale, fmt, setMessages } = useI18nState();
  return { locale, fmt, setMessages };
}

export function useFormatter() {
  return useI18nState().fmt;
}
