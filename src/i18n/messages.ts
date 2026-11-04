import type { Locale } from "./config";
import type { Leaves, MessageTree, Translator } from "./core";
import type { Messages, Namespace } from "./locales/en";

export type { Messages, Namespace } from "./locales/en";

/** Lazy per-locale loaders: only the active language is sent to the browser. */
export const MESSAGE_LOADERS: Record<Locale, () => Promise<MessageTree>> = {
  fr: () => import("./locales/fr").then((m) => m.default as unknown as MessageTree),
  en: () => import("./locales/en").then((m) => m.default as unknown as MessageTree),
};

/** Every valid key, per namespace (computed once, so generic code stays cheap to type-check). */
export type KeysOf = { [N in Namespace]: Leaves<Messages[N]> };

/** Translator type for one namespace, for helpers that receive `t` as a parameter. */
export type TFor<N extends Namespace> = Translator<KeysOf[N]>;
