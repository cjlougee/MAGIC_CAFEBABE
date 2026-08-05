/**
 * A stack of stuff, either lying on a cell or in a pawn's hands.
 *
 * Follows RimWorld's rule of **one stack per cell per definition**. Without it, a
 * hundred separate one-stone piles accumulate on a single tile and every haul scan has
 * to walk them all — the invariant is a performance decision as much as a display one.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import type { ItemDefId } from '../defs/items';

export interface Item {
  readonly id: EntityId;
  readonly def: ItemDefId;
  count: number;
  /** Cell it rests on. Null exactly when carried. */
  pos: TilePos | null;
  /** Pawn holding it. Null exactly when on the ground. */
  carriedBy: EntityId | null;
}

export function createItem(
  id: EntityId,
  def: ItemDefId,
  count: number,
  pos: TilePos | null,
): Item {
  return { id, def, count, pos, carriedBy: null };
}

export function isOnGround(item: Item): boolean {
  return item.pos !== null && item.carriedBy === null;
}
