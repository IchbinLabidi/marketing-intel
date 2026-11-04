// Translators for unit tests and other code that runs outside a request (English unless told otherwise).
import { createTranslator, type MessageTree } from "./core";
import type { KeysOf, TFor } from "./messages";
import type { Locale } from "./config";
import en from "./locales/en";
import fr from "./locales/fr";
import type { Namespace } from "./locales/en";

export function testT<N extends Namespace>(namespace: N, locale: Locale = "en"): TFor<N> {
  const dict = (locale === "fr" ? fr : en) as unknown as Record<string, MessageTree>;
  return createTranslator<KeysOf[N]>(locale, namespace, dict[namespace], (en as unknown as Record<string, MessageTree>)[namespace]);
}
