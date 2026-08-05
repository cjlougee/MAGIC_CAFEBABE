/**
 * Items, plus the cell index that makes finding them cheap.
 *
 * Every haul scan asks "what is lying on this cell" and "is there room here", so those
 * cannot be a linear walk of every item in the world. The store keeps a `cell -> ids`
 * map in sync with item positions; nothing outside may move an item without going
 * through here, or the index silently rots.
 */

import { EntityStore, type EntityId } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import { itemDef, type ItemDefId } from '../defs/items';
import { createItem, type Item } from '../entities/item';
import type { TileMap } from './tilemap';

/** How far to look for somewhere to put the overflow from a full cell. */
const SPILL_RADIUS = 6;

export class ItemStore {
  private readonly entities = new EntityStore<Item>();
  private readonly byCell = new Map<number, EntityId[]>();

  get size(): number {
    return this.entities.size;
  }

  get nextIdForSave(): number {
    return this.entities.nextIdForSave;
  }

  get(id: EntityId): Item | undefined {
    return this.entities.get(id);
  }

  values(): IterableIterator<Item> {
    return this.entities.values();
  }

  /** Items resting on a cell. Never includes carried items. */
  at(cellIndex: number): Item[] {
    const ids = this.byCell.get(cellIndex);
    if (!ids) return [];
    const items: Item[] = [];
    for (const id of ids) {
      const item = this.entities.get(id);
      if (item) items.push(item);
    }
    return items;
  }

  /** The single stack of `def` on a cell, if any. */
  stackAt(cellIndex: number, def: ItemDefId): Item | undefined {
    return this.at(cellIndex).find((item) => item.def === def);
  }

  /** How much more of `def` this cell can take. */
  capacityAt(cellIndex: number, def: ItemDefId): number {
    const limit = itemDef(def).stackLimit;
    const existing = this.stackAt(cellIndex, def);
    return existing ? Math.max(0, limit - existing.count) : limit;
  }

  /**
   * Puts `count` of `def` on the map at `pos`, merging into the stack already there and
   * spilling any remainder onto nearby cells.
   *
   * Spilling rather than clamping matters: mining a rock yields more than a cell can
   * hold, and silently deleting the difference would make the economy leak.
   */
  spawn(map: TileMap, def: ItemDefId, count: number, pos: TilePos): Item[] {
    const created: Item[] = [];
    let remaining = count;

    for (const cell of this.spillCells(map, pos)) {
      if (remaining <= 0) break;
      const room = this.capacityAt(cell.index, def);
      if (room <= 0) continue;

      const amount = Math.min(room, remaining);
      remaining -= amount;

      const existing = this.stackAt(cell.index, def);
      if (existing) {
        existing.count += amount;
      } else {
        const item = this.entities.add((id) => createItem(id, def, amount, cell.pos));
        this.addToCell(cell.index, item.id);
        created.push(item);
      }
    }

    return created;
  }

  /** Lifts an item off the ground into a pawn's hands. */
  beginCarry(item: Item, pawnId: EntityId, map: TileMap): void {
    if (item.pos) this.removeFromCell(map.idx(item.pos.x, item.pos.y, item.pos.z), item.id);
    item.pos = null;
    item.carriedBy = pawnId;
  }

  /**
   * Puts a carried item down, merging into a matching stack if one is there.
   *
   * Returns the surviving item — which may not be the one passed in, because merging
   * consumes the carried stack. Callers must not keep holding the old reference.
   */
  placeAt(item: Item, map: TileMap, pos: TilePos): Item {
    const index = map.idx(pos.x, pos.y, pos.z);
    const existing = this.stackAt(index, item.def);

    if (existing) {
      const room = this.capacityAt(index, item.def);
      const merged = Math.min(room, item.count);
      existing.count += merged;
      item.count -= merged;

      if (item.count <= 0) {
        this.entities.remove(item.id);
        return existing;
      }
    }

    item.pos = pos;
    item.carriedBy = null;
    this.addToCell(index, item.id);
    return item;
  }

  remove(id: EntityId, map: TileMap): void {
    const item = this.entities.get(id);
    if (!item) return;
    if (item.pos) this.removeFromCell(map.idx(item.pos.x, item.pos.y, item.pos.z), id);
    this.entities.remove(id);
  }

  /** Cells to try when placing, nearest first. */
  private *spillCells(map: TileMap, origin: TilePos): Generator<{ index: number; pos: TilePos }> {
    const z = origin.z ?? GROUND_LEVEL;
    for (let radius = 0; radius <= SPILL_RADIUS; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = origin.x + dx;
          const y = origin.y + dy;
          if (!map.isPassable(x, y, z)) continue;
          yield { index: map.idx(x, y, z), pos: { x, y, z } };
        }
      }
    }
  }

  private addToCell(index: number, id: EntityId): void {
    const ids = this.byCell.get(index);
    if (ids) ids.push(id);
    else this.byCell.set(index, [id]);
  }

  private removeFromCell(index: number, id: EntityId): void {
    const ids = this.byCell.get(index);
    if (!ids) return;
    const at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1);
    if (ids.length === 0) this.byCell.delete(index);
  }
}
