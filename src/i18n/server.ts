import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "./config";
import { createTranslator, type MessageTree } from "./core";
import type { KeysOf, TFor } from "./messages";
import { createFormatter } from "./format";
import en from "./locales/en";
import fr from "./locales/fr";
import type { Namespace } from "./locales/en";

const DICTIONARIES: Record<Locale, MessageTree> = { en: en as unknown as MessageTree, fr: fr as unknown as MessageTree };

/**
 * The request's language: the explicit choice (cookie, which the proxy also restores from the user's saved
 * profile preference), then the browser's Accept-Language, then French.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

export function getMessages(locale: Locale): MessageTree {
  return DICTIONARIES[locale];
}

/** Translator for one namespace in Server Components, Server Actions and Route Handlers. */
export async function getT<N extends Namespace>(namespace: N): Promise<TFor<N>> {
  const locale = await getLocale();
  return translatorFor(locale, namespace);
}

/** Synchronous variant when the locale is already known (e.g. passed into a helper). */
export function translatorFor<N extends Namespace>(locale: Locale, namespace: N): TFor<N> {
  return createTranslator<KeysOf[N]>(locale, namespace, DICTIONARIES[locale][namespace] as MessageTree, DICTIONARIES.en[namespace] as MessageTree);
}

export async function getFormatter() {
  return createFormatter(await getLocale());
}
