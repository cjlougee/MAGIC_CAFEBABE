/**
 * Cells the player has marked for work.
 *
 * A designation is *intent*, held separately from the terrain it points at. Marking a
 * rock doesn't change the rock; it adds a standing request that any qualified colonist
 * may pick up. That separation is what makes the work grid meaningful — the player says
 * what should happen, and the colony decides who and when.
 */

export const Designation = {
  Mine: 0,
  /** Take down something the colony built, salvaging part of what it cost. */
  Deconstruct: 1,
} as const;

export type DesignationKind = (typeof Designation)[keyof typeof Designation];

export class Designations {
  private readonly sets = new Map<DesignationKind, Set<number>>();

  add(kind: DesignationKind, cellIndex: number): void {
    this.setFor(kind).add(cellIndex);
  }

  remove(kind: DesignationKind, cellIndex: number): void {
    this.sets.get(kind)?.delete(cellIndex);
  }

  has(kind: DesignationKind, cellIndex: number): boolean {
    return this.sets.get(kind)?.has(cellIndex) ?? false;
  }

  /** Insertion-ordered, so iteration is deterministic. */
  cells(kind: DesignationKind): ReadonlySet<number> {
    return this.sets.get(kind) ?? EMPTY;
  }

  count(kind: DesignationKind): number {
    return this.sets.get(kind)?.size ?? 0;
  }

  clear(kind: DesignationKind): void {
    this.sets.get(kind)?.clear();
  }

  private setFor(kind: DesignationKind): Set<number> {
    let set = this.sets.get(kind);
    if (!set) {
      set = new Set<number>();
      this.sets.set(kind, set);
    }
    return set;
  }
}

const EMPTY: ReadonlySet<number> = new Set<number>();
