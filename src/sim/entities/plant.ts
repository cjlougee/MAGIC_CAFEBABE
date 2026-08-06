/**
 * A growing thing.
 *
 * Growth is stored as progress in ticks rather than a 0–1 float so it stays exact
 * across saves and never accumulates rounding drift over the thousands of ticks a
 * plant spends maturing.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { plantDef, type PlantId } from '../defs/plants';

export interface Plant {
  readonly id: EntityId;
  readonly def: PlantId;
  readonly pos: TilePos;
  /** Ticks of growth accumulated. Ripe once it reaches the def's growTicks. */
  growth: number;
}

export function createPlant(id: EntityId, def: PlantId, pos: TilePos, growth = 0): Plant {
  return { id, def, pos, growth };
}

export function isRipe(plant: Plant): boolean {
  return plant.growth >= plantDef(plant.def).growTicks;
}

/** 0–1, for the renderer to size the plant by. */
export function ripeness(plant: Plant): number {
  return Math.min(1, plant.growth / plantDef(plant.def).growTicks);
}
