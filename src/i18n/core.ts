import * as React from "react";
import { FALLBACK_LOCALE, LOCALE_META, type Locale } from "./config";

/* ------------------------------------------------------------------ types */

/** A plural message: picked with Intl.PluralRules from the `count` value. `zero` is optional and wins for 0. */
export type PluralForms = { zero?: string; one: string; other: string; two?: string; few?: string; many?: string };
/** Plural forms are recognised by having both `one` and `other` (and only plural categories), so a vocabulary
 * that merely contains an "other" entry (e.g. platform.other) stays a normal group of keys. */
type PluralLike = { one: string; other: string } & { [k: string]: string };
export type MessageTree = { [key: string]: string | PluralForms | MessageTree };

/** Same shape as the English dictionary, with free text at every leaf: what every other locale must provide. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends PluralLike ? { [P in keyof T[K]]: string } : Translation<T[K]>;
};

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];
/** Every dotted key path to a leaf message (string or plural forms) of a dictionary (up to 7 levels deep). */
export type Leaves<T, D extends number = 7> = [D] extends [never]
  ? never
  : T extends string
    ? never
    : T extends PluralLike
      ? never
      : { [K in keyof T & string]: T[K] extends string ? K : T[K] extends PluralLike ? K : Join<K, Leaves<T[K], Prev[D]>> }[keyof T & string];

export type Values = Record<string, string | number | null | undefined>;
export type RichValues = Record<string, string | number | null | undefined | ((chunks: React.ReactNode) => React.ReactNode)>;

export type Translator<K extends string = string> = {
  (key: K, values?: Values): string;
  /** Like t(), with `<tag>…</tag>` in the message rendered by the matching function in `values`. */
  rich(key: K, values: RichValues): React.ReactNode;
  has(key: string): boolean;
  locale: Locale;
};

/* ------------------------------------------------------------------ lookup */

function lookup(tree: MessageTree | undefined, path: string): string | PluralForms | undefined {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (isPlural(node)) return node;
  return undefined;
}

const PLURAL_KEYS = new Set(["zero", "one", "two", "few", "many", "other"]);
function isPlural(node: unknown): node is PluralForms {
  if (!node || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  return typeof o.one === "string" && typeof o.other === "string" && Object.keys(o).every((k) => PLURAL_KEYS.has(k) && typeof o[k] === "string");
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const numberFormats = new Map<Locale, Intl.NumberFormat>();
const rules = (l: Locale) => pluralRules.get(l) ?? pluralRules.set(l, new Intl.PluralRules(LOCALE_META[l].intl)).get(l)!;
const numbers = (l: Locale) => numberFormats.get(l) ?? numberFormats.set(l, new Intl.NumberFormat(LOCALE_META[l].intl)).get(l)!;

function choose(message: string | PluralForms, locale: Locale, values?: Values | RichValues): string {
  if (typeof message === "string") return message;
  const count = Number(values?.count ?? 0);
  if (count === 0 && message.zero != null) return message.zero;
  const form = rules(locale).select(count) as keyof PluralForms;
  return message[form] ?? message.other;
}

function interpolate(text: string, locale: Locale, values?: Values | RichValues): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = values[name];
    if (v === undefined || typeof v === "function") return match;
    if (v === null) return "";
    return typeof v === "number" ? numbers(locale).format(v) : String(v);
  });
}

/** Renders `<b>bold</b>`-style tags (no attributes, nesting allowed) with the functions given in `values`. */
function renderRich(text: string, values: RichValues): React.ReactNode {
  const out: React.ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const fn = values[m[1]];
    const inner = renderRich(m[2], values);
    out.push(typeof fn === "function" ? React.createElement(React.Fragment, { key: i++ }, fn(inner)) : inner);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out;
}

const reported = new Set<string>();
function reportMissing(locale: Locale, ns: string, key: string) {
  if (process.env.NODE_ENV === "production") return;
  const id = `${locale}:${ns}.${key}`;
  if (reported.has(id)) return;
  reported.add(id);
  console.warn(`[i18n] Missing message "${ns}.${key}" for locale "${locale}"`);
}

/**
 * Builds a translator for one namespace. Missing keys fall back to the English message, then to the key itself,
 * so a gap never blanks the UI (and is logged in development).
 */
export function createTranslator<K extends string = string>(
  locale: Locale,
  namespace: string,
  messages: MessageTree | undefined,
  fallback?: MessageTree,
): Translator<K> {
  const resolve = (key: string) => {
    const own = lookup(messages, key);
    if (own !== undefined) return own;
    reportMissing(locale, namespace, key);
    return locale === FALLBACK_LOCALE ? undefined : lookup(fallback, key);
  };
  const t = ((key: string, values?: Values) => {
    const msg = resolve(key);
    if (msg === undefined) return `${namespace}.${key}`;
    return interpolate(choose(msg, locale, values), locale, values);
  }) as unknown as Translator<K>;
  t.rich = (key: string, values: RichValues) => {
    const msg = resolve(key);
    if (msg === undefined) return `${namespace}.${key}`;
    return renderRich(interpolate(choose(msg, locale, values), locale, values), values);
  };
  t.has = (key: string) => lookup(messages, key) !== undefined;
  t.locale = locale;
  return t;
}
