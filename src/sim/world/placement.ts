/**
 * Where the player is allowed to put things.
 *
 * These predicates have two callers that must never disagree: the command handlers that
 * apply a designation, and the drag preview that tells the player what will happen.
 * If they drift, the preview promises something the simulation then refuses — the worst
 * kind of UI bug, because it looks like the click didn't register.
 *
 * Note the distinction these encode: **passable is not storable.** A colonist can wade a
 * shallow ford but must not leave a crate in it. See docs/decisions/0004-water.md.
 */

import { isMineable } from '../defs/terrain';
import { buildingAt, siteAt } from './lookup';
import type { TileMap } from './tilemap';
import type { World } from './world';

/** Rock and bulkheads can be cut; open ground and water cannot. */
export function canDesignateMine(map: TileMap, cellIndex: number): boolean {
  return isMineable(map.terrainAt(cellIndex));
}

/**
 * Stockpiles need dry, walkable ground.
 *
 * Inside a wall it would accept haul jobs nobody can complete; in a river it would have
 * colonists wading out to stack crates in the current.
 */
export function canPlaceStockpile(map: TileMap, cellIndex: number): boolean {
  return map.isStorableAt(cellIndex);
}

/**
 * Blueprints go on dry, open ground that isn't already occupied.
 *
 * Uses `isStorableAt` for the same reason stockpiles do — you cannot build in a river,
 * and bridges are a later problem. The occupancy checks stop a drag across an existing
 * wall from queueing a second wall on top of it.
 */
export function canPlaceBlueprint(world: World, cellIndex: number): boolean {
  if (!world.map.isStorableAt(cellIndex)) return false;
  if (buildingAt(world, cellIndex)) return false;
  if (siteAt(world, cellIndex)) return false;
  return true;
}
