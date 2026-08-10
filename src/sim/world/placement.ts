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
import {
  buildableDef,
  buildableProducing,
  buildableProducingTerrain,
  type BuildableId,
} from '../defs/buildables';
import { isMineable } from '../defs/terrain';
import { buildingDef } from '../defs/buildings';
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

/**
 * Which way a blueprint should face, given what is already around it.
 *
 * Only meaningful for something that is **passable and still seals a room** — which is
 * to say a door, and which is exactly the flag pair M4 kept separate. A door is one cell,
 * so the toolbar offers no Rotate button for it and there is otherwise no way at all for
 * the player to say which way it runs; orienting from the neighbouring walls is not a
 * convenience, it is the only chance the sprite has of lining up with the run it
 * interrupts.
 *
 * Reads `sealsRoomAt` rather than "is there a wall", so a door lines up with a run of
 * walls, with other doors, and with a compound's stamped bulkheads alike. Ties keep the
 * requested rotation, so a free-standing door is still placed rather than refused.
 */
export function orientToNeighbours(
  world: World,
  anchor: TilePos,
  buildable: BuildableId,
  requested: Rotation,
): Rotation {
  const result = buildableDef(buildable).result;
  if (result.kind !== 'building') return requested;

  const def = buildingDef(result.building);
  if (!def.blocksRoom || !def.passable) return requested;

  const seals = (dx: number, dy: number): number => {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    if (!world.map.inBounds(x, y, anchor.z)) return 0;
    return world.map.sealsRoomAt(world.map.idx(x, y, anchor.z)) ? 1 : 0;
  };

  const alongX = seals(1, 0) + seals(-1, 0);
  const alongY = seals(0, 1) + seals(0, -1);

  if (alongX > alongY) return 0;
  if (alongY > alongX) return 1;
  return requested;
}

/** Whether a single cell could take a blueprint. The footprint check above calls it per cell. */
export function canPlaceBlueprint(world: World, cellIndex: number): boolean {
  if (!world.map.isStorableAt(cellIndex)) return false;
  if (buildingAt(world, cellIndex)) return false;
  if (siteAt(world, cellIndex)) return false;
  return true;
}
