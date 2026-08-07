/**
 * Identity and lookup for everything that lives in the world.
 *
 * Ids are handed out sequentially and `nextId` is part of saved state, so a reloaded
 * world keeps minting ids where it left off — reusing an id would let a stale
 * reference silently resolve to a different entity.
 *
 * Backed by a Map, whose iteration order is insertion order and therefore
 * deterministic. Anything that iterates entities and draws from the RNG depends on
 * that, so do not swap this for a plain object.
 */

export type EntityId = number;

export interface Entity {
  readonly id: EntityId;
}

export class EntityStore<T extends Entity> {
  private readonly items = new Map<EntityId, T>();
  private nextId = 1;

  /** Builds an entity with a fresh id and stores it. */
  add(create: (id: EntityId) => T): T {
    const entity = create(this.nextId++);
    this.items.set(entity.id, entity);
    return entity;
  }

  get(id: EntityId): T | undefined {
    return this.items.get(id);
  }

  has(id: EntityId): boolean {
    return this.items.has(id);
  }

  remove(id: EntityId): boolean {
    return this.items.delete(id);
  }

  /** Insertion-ordered. Safe to iterate while reading; do not add or remove during. */
  values(): IterableIterator<T> {
    return this.items.values();
  }

  get size(): number {
    return this.items.size;
  }

  /** Included in the world hash so id drift shows up as a determinism failure. */
  get nextIdForSave(): number {
    return this.nextId;
  }

  restoreNextId(value: number): void {
    this.nextId = value;
  }

  /**
   * Reinstates an entity with the id it already had.
   *
   * Load only. Ids must survive a save/load cycle intact, because everything else
   * references entities by id — a bed's owner, a job's target, a reservation.
   */
  restore(entity: T): void {
    this.items.set(entity.id, entity);
  }
}
