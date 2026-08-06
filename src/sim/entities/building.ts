/**
 * A placed structure.
 *
 * `owner` exists so a bed can belong to one colonist. Nothing assigns owners yet —
 * beds are claimed opportunistically — but sleeping in *someone else's* bed is a
 * classic mood thought, and the field costs nothing now against a save migration later.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { buildingDef, type BuildingId } from '../defs/buildings';

export interface Building {
  readonly id: EntityId;
  readonly def: BuildingId;
  readonly pos: TilePos;
  /** Colonist this belongs to, or null if unclaimed. */
  owner: EntityId | null;
}

export function createBuilding(id: EntityId, def: BuildingId, pos: TilePos): Building {
  return { id, def, pos, owner: null };
}

export function isBed(building: Building): boolean {
  return buildingDef(building.def).isBed;
}
