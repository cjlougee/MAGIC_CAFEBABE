/**
 * Claims on targets, so two colonists never fight over the same rock.
 *
 * Without this, every idle pawn independently picks the *nearest* piece of work and
 * they all walk to the same one — the colony looks broken in a way that is instantly
 * visible and deeply unconvincing. It is not an optimisation; it is what makes
 * autonomous labour look intentional.
 *
 * Reservations are held for the life of a job and released when it ends **by any
 * route**: completion, failure, or preemption. A leaked reservation is worse than no
 * reservation, because the target becomes permanently untouchable and nothing in the
 * game will ever tell you why.
 */

import type { EntityId } from '../core/entityStore';

interface Held {
  readonly cells: Set<number>;
  readonly items: Set<EntityId>;
}

export class Reservations {
  private readonly cellOwner = new Map<number, EntityId>();
  private readonly itemOwner = new Map<EntityId, EntityId>();
  private readonly held = new Map<EntityId, Held>();

  /** True when `pawn` may claim this cell — free, or already theirs. */
  canReserveCell(cellIndex: number, pawn: EntityId): boolean {
    const owner = this.cellOwner.get(cellIndex);
    return owner === undefined || owner === pawn;
  }

  reserveCell(cellIndex: number, pawn: EntityId): boolean {
    if (!this.canReserveCell(cellIndex, pawn)) return false;
    this.cellOwner.set(cellIndex, pawn);
    this.heldBy(pawn).cells.add(cellIndex);
    return true;
  }

  canReserveItem(item: EntityId, pawn: EntityId): boolean {
    const owner = this.itemOwner.get(item);
    return owner === undefined || owner === pawn;
  }

  reserveItem(item: EntityId, pawn: EntityId): boolean {
    if (!this.canReserveItem(item, pawn)) return false;
    this.itemOwner.set(item, pawn);
    this.heldBy(pawn).items.add(item);
    return true;
  }

  cellOwnedBy(cellIndex: number): EntityId | undefined {
    return this.cellOwner.get(cellIndex);
  }

  /** Drops every claim a pawn holds. Called from exactly one place: endJob(). */
  releaseAll(pawn: EntityId): void {
    const holdings = this.held.get(pawn);
    if (!holdings) return;

    for (const cell of holdings.cells) {
      if (this.cellOwner.get(cell) === pawn) this.cellOwner.delete(cell);
    }
    for (const item of holdings.items) {
      if (this.itemOwner.get(item) === pawn) this.itemOwner.delete(item);
    }
    this.held.delete(pawn);
  }

  /** Total outstanding claims. Used by tests to prove nothing leaks. */
  get activeCount(): number {
    return this.cellOwner.size + this.itemOwner.size;
  }

  private heldBy(pawn: EntityId): Held {
    let holdings = this.held.get(pawn);
    if (!holdings) {
      holdings = { cells: new Set<number>(), items: new Set<EntityId>() };
      this.held.set(pawn, holdings);
    }
    return holdings;
  }
}
