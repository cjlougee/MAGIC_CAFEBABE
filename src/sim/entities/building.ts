/**
 * A placed structure.
 *
 * `owner` exists so a bed can belong to one colonist. Nothing assigns owners yet —
 * beds are claimed opportunistically — but sleeping in *someone else's* bed is a
 * classic mood thought, and the field costs nothing now against a save migration later.
 *
 * A **workbench** is not a separate entity type. It is a building that happens to carry
 * bills and a ledger of loaded ingredients, because the alternative — a parallel
 * `Workbench` store — would need its own reservation keys, its own save section, and its
 * own answer to "what is standing on this cell", all of which already exist here.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { buildingDef, type BuildingId } from '../defs/buildings';
import { recipeDef, recipesFor, type RecipeId } from '../defs/recipes';
import { cellsOf, footprintOfBuilding, type Rotation } from '../world/footprint';
import { emptyLedger, hasAllOf, missingOf } from './materials';

/**
 * A standing order on a bench.
 *
 * There is no `active` flag. A bill is suspended *by arithmetic* — the giver counts the
 * product in the world and skips the bill when the colony already has enough — so the
 * bench idles when stocked and restarts when supplies drop, with no state that can fall
 * out of step with reality.
 */
export interface Bill {
  readonly recipe: RecipeId;
  /** Stop once the colony holds this many of the product. The player's to set. */
  untilCount: number;
}

export interface Building {
  readonly id: EntityId;
  readonly def: BuildingId;
  /**
   * The **anchor**: the minimum x and y of the rotated footprint, not a centre.
   *
   * Which cells follow from it is `world/footprint.ts`'s business and is never stored —
   * a saved copy could disagree with the def it came from, and nothing could say which
   * was right.
   */
  readonly pos: TilePos;
  readonly rotation: Rotation;
  /**
   * Barred against colonists. Only ever true for something whose def is `lockable`.
   *
   * Flips `buildingBlocks` and leaves `buildingSealsRoom` alone: a locked door is still
   * a room edge, because it is still a door in a wall.
   */
  locked: boolean;
  /** Colonist this belongs to, or null if unclaimed. */
  owner: EntityId | null;
  /** Standing orders, in the order they should be worked. Empty for anything not a bench. */
  readonly bills: Bill[];
  /** Ingredients loaded into this bench so far, indexed by ItemDefId. */
  readonly loaded: number[];
}

export function createBuilding(
  id: EntityId,
  def: BuildingId,
  pos: TilePos,
  rotation: Rotation = 0,
): Building {
  return { id, def, pos, rotation, locked: false, owner: null, bills: [], loaded: emptyLedger() };
}

/** The cells this building stands on. Derived every time; never cached, never saved. */
export function buildingCells(building: Building): TilePos[] {
  return cellsOf(building.pos, footprintOfBuilding(building.def), building.rotation);
}

export function isBed(building: Building): boolean {
  return buildingDef(building.def).isBed;
}

export function isLockable(building: Building): boolean {
  return buildingDef(building.def).lockable;
}

/** Whether this structure stops movement *right now*, locking included. */
export function blocksMovement(building: Building): boolean {
  const def = buildingDef(building.def);
  return !def.passable || building.locked;
}

/** Whether anything can be made here at all. Drives the bill panel appearing. */
export function isWorkbench(building: Building): boolean {
  return recipesFor(building.def).length > 0;
}

/** True once every ingredient for `bill` has been loaded and only labour remains. */
export function hasIngredientsFor(building: Building, bill: Bill): boolean {
  return hasAllOf(building.loaded, recipeDef(bill.recipe).ingredients);
}

/** Which ingredients for `bill` are still short, for the giver to go looking for. */
export function missingIngredientsFor(building: Building, bill: Bill) {
  return missingOf(building.loaded, recipeDef(bill.recipe).ingredients);
}
