import { describe, expect, it } from "vitest";
import { compareManual, dropNeighbours, materialise, positionBetween, type Orderable } from "@/lib/production/board-order";

const card = (id: string, position: number | null, column = "idea", created = "2026-11-01T00:00:00Z"): Orderable =>
  ({ id, production_stage: "idea", created_at: created, board_column: position === null ? null : column, board_position: position });
const order = (cards: Orderable[]) => [...cards].sort(compareManual).map((c) => c.id);

describe("manual board order", () => {
  it("sorts by saved position, then cards without one oldest first", () => {
    const cards = [card("d", null, "idea", "2026-11-03T00:00:00Z"), card("b", 2048), card("c", null, "idea", "2026-11-02T00:00:00Z"), card("a", 1024)];
    expect(order(cards)).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores a position saved in another column (the card changed stage elsewhere)", () => {
    expect(order([card("x", 10, "brief"), card("y", 5000)])).toEqual(["y", "x"]);
  });
  it("drag the last card to the top: A B C D -> D A B C", () => {
    const full = ["a", "b", "c"]; // column without the moved card D
    const place = dropNeighbours(full, full, 0);
    expect(place).toEqual({ after: null, before: "a" });
    const pos = materialise("idea", [card("a", 1024), card("b", 2048), card("c", 3072)]);
    const d = positionBetween(null, pos.get("a")!);
    expect(order([card("a", 1024), card("b", 2048), card("c", 3072), card("d", d)])).toEqual(["d", "a", "b", "c"]);
  });
  it("drops between two cards and at the bottom", () => {
    expect(dropNeighbours(["a", "b", "c"], ["a", "b", "c"], 2)).toEqual({ after: "b", before: "c" });
    expect(dropNeighbours(["a", "b", "c"], ["a", "b", "c"], 3)).toEqual({ after: "c", before: null });
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(3072, null)).toBe(4096);
  });
  it("into an empty column", () => {
    expect(dropNeighbours([], [], 0)).toEqual({ after: null, before: null });
    expect(positionBetween(null, null)).toBe(1024);
  });
  it("with filters, lands next to visible cards and keeps hidden cards in order", () => {
    // full order a h1 b h2 c, only a b c visible
    const full = ["a", "h1", "b", "h2", "c"]; const shown = ["a", "b", "c"];
    expect(dropNeighbours(full, shown, 1)).toEqual({ after: "h1", before: "b" }); // just above b
    expect(dropNeighbours(full, shown, 3)).toEqual({ after: "c", before: null }); // below c
    expect(dropNeighbours(full, [], 0)).toEqual({ after: "c", before: null }); // nothing visible: goes last
  });
  it("fills in missing positions after the largest, like production_reorder()", () => {
    const pos = materialise("idea", [card("a", 1024), card("n2", null, "idea", "2026-11-05T00:00:00Z"), card("n1", null, "idea", "2026-11-04T00:00:00Z")]);
    expect([...pos]).toEqual([["a", 1024], ["n1", 2048], ["n2", 3072]]);
  });
});
