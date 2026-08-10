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

import type { TilePos } from '../core/position';
import { buildableProducing, buildableProducingTerrain, type BuildableId } from '../defs/buildables';
import { isMineable } from '../defs/terrain';
import { cellsOf, footprintOfBuildable, type Rotation } from './footprint';
import { buildingAt, siteAt } from './lookup';
import type { TileMap } from './tilemap';
import type { World } from './world';

/** Rock and bulkheads can be cut; open ground and water cannot. */
export function canDesignateMine(map: TileMap, cellIndex: number): boolean {
  return isMineable(map.terrainAt(cellIndex));
}

/**
 * You may take down what the colony put up, and nothing else.
 *
 * The rule is "something a blueprint produced", not "something solid", which settles
 * three questions at once. Natural rock is mined, not deconstructed — it has no
 * blueprint and so no cost to refund. Bedrolls came with the landing party, so they
 * aren't in the list either. And a finished wall and a half-built one are different
 * tools: an unbuilt site is a *mark*, cleared instantly by Erase, while a standing wall
 * is real and costs labour to remove.
 */
export function canDesignateDeconstruct(world: World, cellIndex: number): boolean {
  // A site here means the structure isn't finished yet — that's Erase's job, not this.
  if (siteAt(world, cellIndex)) return false;

  const building = buildingAt(world, cellIndex);
  if (building) return buildableProducing(building.def) !== undefined;

  return buildableProducingTerrain(world.map.terrainAt(cellIndex)) !== undefined;
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
 *
 * **Every cell of the footprint must pass, and one failure is enough.** A 2×2 hearth
 * with three good cells and one in a stream is not three-quarters placeable; it is
 * refused. Getting this wrong would let the player build across a river bank and then
 * wonder why the salvage from deconstructing it vanished.
 */
export function canPlaceFootprint(
  world: World,
  anchor: TilePos,
  buildable: BuildableId,
  rotation: Rotation,
): boolean {
  for (const cell of cellsOf(anchor, footprintOfBuildable(buildable), rotation)) {
    if (!world.map.inBounds(cell.x, cell.y, cell.z)) return false;
    if (!canPlaceBlueprint(world, world.map.idx(cell.x, cell.y, cell.z))) return false;
  }
  return true;
}

/** Whether a single cell could take a blueprint. The footprint check above calls it per cell. */
export function canPlaceBlueprint(world: World, cellIndex: number): boolean {
  if (!world.map.isStorableAt(cellIndex)) return false;
  if (buildingAt(world, cellIndex)) return false;
  if (siteAt(world, cellIndex)) return false;
  return true;
}
