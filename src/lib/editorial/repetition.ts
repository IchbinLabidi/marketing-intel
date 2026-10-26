import { contentTokens, normalizeText } from "@/lib/history/text";
import { similarity } from "@/lib/opportunities/scoring";

// Repetition: exact repeats are caught by word overlap; close pairs that may only share a recurring topic ("Bac
// Informatique revision") go to a cheap AI judge, which decides whether the purpose/angle is really different.

export type RepItem = { id: string; date: string | null; platform: string | null; title: string; topic?: string | null; hook?: string | null; angle?: string | null; caption?: string | null; format?: string | null };
export type RepPair = { a: string; b: string; similarity: number; kind: "exact" | "possible"; scope: "calendar" | "published" };
export type RepFlag = { with: string; with_title: string; kind: "exact" | "semantic"; similarity: number; note: string };

const ideaOf = (i: RepItem) => new Set(contentTokens([i.title, i.topic, i.hook, i.angle].filter(Boolean).join(" ")));
const hookOf = (i: RepItem) => normalizeText(i.hook ?? "").trim();
const captionOf = (i: RepItem) => new Set(contentTokens(i.caption ?? ""));

/** Pairs to look at: new items against each other and against previously published / planned content. */
export function repetitionPairs(items: RepItem[], prior: RepItem[], maxPossible = 40): RepPair[] {
  const pairs: RepPair[] = [];
  const idea = new Map([...items, ...prior].map((i) => [i.id, ideaOf(i)]));
  const cap = new Map([...items, ...prior].map((i) => [i.id, captionOf(i)]));
  const check = (a: RepItem, b: RepItem, scope: RepPair["scope"]) => {
    const s = similarity(idea.get(a.id)!, idea.get(b.id)!);
    const c = a.caption && b.caption ? similarity(cap.get(a.id)!, cap.get(b.id)!) : 0;
    const sameHook = hookOf(a).length > 12 && hookOf(a) === hookOf(b);
    if (s >= 0.6 || c >= 0.7 || sameHook) pairs.push({ a: a.id, b: b.id, similarity: Math.max(s, c, sameHook ? 1 : 0), kind: "exact", scope });
    else if (s >= 0.3) pairs.push({ a: a.id, b: b.id, similarity: s, kind: "possible", scope });
  };
  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) check(items[x], items[y], "calendar");
    for (const p of prior) check(items[x], p, "published");
  }
  const exact = pairs.filter((p) => p.kind === "exact");
  const possible = pairs.filter((p) => p.kind === "possible").sort((a, b) => b.similarity - a.similarity).slice(0, maxPossible);
  return [...exact, ...possible];
}

/** Similar posts on the same platform closer than `minDays` (spacing check). */
export function crowded(items: RepItem[], minDays = 5, threshold = 0.35) {
  const out: { a: string; b: string; days: number }[] = [];
  const idea = new Map(items.map((i) => [i.id, ideaOf(i)]));
  for (let x = 0; x < items.length; x++) for (let y = x + 1; y < items.length; y++) {
    const a = items[x], b = items[y];
    if (!a.date || !b.date || a.platform !== b.platform) continue;
    const d = Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86400000;
    if (d < minDays && similarity(idea.get(a.id)!, idea.get(b.id)!) >= threshold) out.push({ a: a.id, b: b.id, days: d });
  }
  return out;
}
