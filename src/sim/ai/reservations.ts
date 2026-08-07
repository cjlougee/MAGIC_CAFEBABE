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
  readonly entities: Set<EntityId>;
}

export interface ReservationSave {
  readonly cells: [number, EntityId][];
  readonly entities: [EntityId, EntityId][];
}

export class Reservations {
  private readonly cellOwner = new Map<number, EntityId>();
  private readonly entityOwner = new Map<EntityId, EntityId>();
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

  /**
   * Entity-keyed, not item-keyed: colonists claim plants, beds, and stacks through the
   * same map, because "nobody else take this" is one idea however many kinds of thing
   * it applies to.
   */
  canReserveEntity(entity: EntityId, pawn: EntityId): boolean {
    const owner = this.entityOwner.get(entity);
    return owner === undefined || owner === pawn;
  }

  reserveEntity(entity: EntityId, pawn: EntityId): boolean {
    if (!this.canReserveEntity(entity, pawn)) return false;
    this.entityOwner.set(entity, pawn);
    this.heldBy(pawn).entities.add(entity);
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
    for (const entity of holdings.entities) {
      if (this.entityOwner.get(entity) === pawn) this.entityOwner.delete(entity);
    }
    this.held.delete(pawn);
  }

  /** Total outstanding claims. Used by tests to prove nothing leaks. */
  get activeCount(): number {
    return this.cellOwner.size + this.entityOwner.size;
  }

  /**
   * Claims, as plain data.
   *
   * Saved rather than rebuilt, because a pawn restored mid-job is still holding its
   * targets. Dropping the claims would let a second colonist take the same rock the
   * moment the game reloaded.
   */
  save(): ReservationSave {
    return {
      cells: [...this.cellOwner.entries()],
      entities: [...this.entityOwner.entries()],
    };
  }

  static restore(data: ReservationSave): Reservations {
    const reservations = new Reservations();
    for (const [cell, pawn] of data.cells) reservations.reserveCell(cell, pawn);
    for (const [entity, pawn] of data.entities) reservations.reserveEntity(entity, pawn);
    return reservations;
  }

  private heldBy(pawn: EntityId): Held {
    const existing = this.held.get(pawn);
    if (existing) return existing;

    const holdings: Held = { cells: new Set<number>(), entities: new Set<EntityId>() };
    this.held.set(pawn, holdings);
    return holdings;
  }
}
