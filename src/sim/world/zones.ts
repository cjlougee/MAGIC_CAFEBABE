/**
 * Player-painted areas.
 *
 * Only stockpiles exist so far: cells where loose items belong. Growing zones, allowed
 * areas, and per-zone filters all layer onto the same idea later — a stockpile with a
 * filter is Slice 2's problem, when there is more than one kind of thing worth sorting.
 */

export class Zones {
  private readonly stockpileCells = new Set<number>();

  addStockpile(cellIndex: number): void {
    this.stockpileCells.add(cellIndex);
  }

  removeStockpile(cellIndex: number): void {
    this.stockpileCells.delete(cellIndex);
  }

  isStockpile(cellIndex: number): boolean {
    return this.stockpileCells.has(cellIndex);
  }

  /** Insertion-ordered, so iteration is deterministic. */
  get stockpiles(): ReadonlySet<number> {
    return this.stockpileCells;
  }

  get stockpileCount(): number {
    return this.stockpileCells.size;
  }
}
