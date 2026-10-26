import { contentTokens } from "./text";

export type SimilarityInput = { id: string; text: string; date: string | null; format: string | null; platform: string | null };

export type RepetitionCluster = {
  ids: string[];
  label: string;            // most common shared words
  similarity: number;       // average pairwise similarity in the cluster, 0..1
  firstDate: string | null;
  lastDate: string | null;
  spanDays: number | null;
  sameFormat: boolean;
  /**
   * near_duplicate: almost identical content close together; refresh_angle: the same treatment keeps coming back;
   * recurring_theme: an evergreen subject spread over time, which is normal for education and only listed for information.
   */
  kind: "near_duplicate" | "refresh_angle" | "recurring_theme";
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

const daysBetween = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 86400000;

/**
 * Groups items whose titles/topics share most of their content words. Lexical (not embedding-based) on purpose:
 * it is deterministic and explainable; semantic grouping is left to the AI recommendation step.
 */
export function findRepetitions(items: SimilarityInput[], threshold = 0.5): RepetitionCluster[] {
  const tokens = items.map((i) => new Set(contentTokens(i.text)));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairScores = new Map<string, number>();

  // Inverted index keeps this near-linear for real calendars (thousands of rows).
  const index = new Map<string, number[]>();
  tokens.forEach((set, i) => set.forEach((t) => {
    const list = index.get(t);
    if (list) list.push(i);
    else index.set(t, [i]);
  }));
  tokens.forEach((set, i) => {
    if (set.size < 2) return; // one-word titles are too weak to call a repetition
    const candidates = new Set<number>();
    set.forEach((t) => {
      const list = index.get(t) ?? [];
      if (list.length <= 200) list.forEach((j) => j > i && candidates.add(j)); // ignore ubiquitous words
    });
    for (const j of candidates) {
      if (tokens[j].size < 2) continue;
      const s = jaccard(set, tokens[j]);
      if (s >= threshold) {
        pairScores.set(`${i}:${j}`, s);
        parent[find(i)] = find(j);
      }
    }
  });

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  });
  // pair scores summed per cluster in one pass (both ends of a scored pair share the final root)
  const scoreSum = new Map<number, { total: number; n: number }>();
  for (const [k, v] of pairScores) {
    const root = find(Number(k.slice(0, k.indexOf(":"))));
    const s = scoreSum.get(root) ?? { total: 0, n: 0 };
    s.total += v;
    s.n++;
    scoreSum.set(root, s);
  }

  const clusters: RepetitionCluster[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const sum = scoreSum.get(root);
    const similarity = sum ? sum.total / sum.n : 0;
    const dates = members.map((i) => items[i].date).filter((d): d is string => Boolean(d)).sort();
    const spanDays = dates.length >= 2 ? Math.round(daysBetween(dates[0], dates[dates.length - 1])) : null;
    const formats = new Set(members.map((i) => (items[i].format ?? "").toLowerCase()).filter(Boolean));
    const sameFormat = formats.size === 1;

    const counts = new Map<string, number>();
    members.forEach((i) => tokens[i].forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    const label = [...counts.entries()]
      .filter(([, c]) => c >= Math.ceil(members.length / 2))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t)
      .join(" ");

    let minGap = Infinity;
    for (let k = 1; k < dates.length; k++) minGap = Math.min(minGap, daysBetween(dates[k - 1], dates[k]));
    const kind: RepetitionCluster["kind"] =
      similarity >= 0.8 && minGap <= 45
        ? "near_duplicate"
        : sameFormat && (members.length >= 3 || minGap <= 60)
          ? "refresh_angle"
          : "recurring_theme";

    clusters.push({
      ids: members.map((i) => items[i].id),
      label,
      similarity: Math.round(similarity * 100) / 100,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      spanDays,
      sameFormat,
      kind,
    });
  }
  const order = { near_duplicate: 0, refresh_angle: 1, recurring_theme: 2 };
  return clusters.sort((a, b) => order[a.kind] - order[b.kind] || b.ids.length - a.ids.length);
}
