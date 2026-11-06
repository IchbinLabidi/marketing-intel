import { columnOf, type BoardStage, type ProductionStage } from "./model";

/**
 * Manual card order on the Production board (migration 0034, table content_board_positions).
 * A card's saved position only counts in the column it was ordered in. Cards without one (new cards, or cards moved to
 * another stage outside the board) go after the positioned ones, oldest first. production_reorder() in the database
 * uses the same rule when it fills in missing positions, so the board and the database never disagree.
 */
export type Orderable = { id: string; production_stage: ProductionStage; created_at: string; board_column?: string | null; board_position?: number | null };

export const positionIn = (item: Orderable, column: BoardStage = columnOf(item.production_stage)) =>
  item.board_column === column && typeof item.board_position === "number" ? item.board_position : null;

/** Compares two cards of the same column in manual order. */
export function compareManual(a: Orderable, b: Orderable) {
  const pa = positionIn(a), pb = positionIn(b);
  if (pa !== null && pb !== null) return pa - pb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (pa !== null) return -1;
  if (pb !== null) return 1;
  return a.created_at.localeCompare(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Where a dropped card goes, as the cards just above and below it in the column's full manual order.
 * `full` is the whole column in manual order (hidden cards included), `shown` the cards the user saw in that column
 * (filtered, in the current sort), both without the moved card; `index` is the drop index in `shown`.
 * The card lands right before the visible card it was dropped on, or right after the last visible card; hidden cards
 * keep their order relative to each other.
 */
export function dropNeighbours(full: string[], shown: string[], index: number): { after: string | null; before: string | null } {
  if (!shown.length) return { after: full.at(-1) ?? null, before: null };
  if (index < shown.length) {
    const at = full.indexOf(shown[Math.max(0, index)]);
    return { after: at > 0 ? full[at - 1] : null, before: full[at] ?? null };
  }
  const at = full.indexOf(shown[shown.length - 1]);
  return { after: full[at] ?? null, before: full[at + 1] ?? null };
}

/** The position the database will give the card (used for the optimistic board until the server answers). */
export function positionBetween(after: number | null, before: number | null) {
  if (after !== null && before !== null) return (after + before) / 2;
  if (after !== null) return after + 1024;
  if (before !== null) return before - 1024;
  return 1024;
}

/** Positions of a column as the database would materialise them (missing ones appended after the largest). */
export function materialise<T extends Orderable>(column: BoardStage, cards: T[]): Map<string, number> {
  const sorted = [...cards].sort(compareManual);
  let max = Math.max(0, ...sorted.map((c) => positionIn(c, column) ?? 0));
  const out = new Map<string, number>();
  for (const c of sorted) { const p = positionIn(c, column); out.set(c.id, p ?? (max += 1024)); }
  return out;
}
