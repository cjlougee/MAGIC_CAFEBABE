/**
 * Plants — the colony's renewable food supply.
 *
 * Deliberately renewable rather than a starting stockpile. A finite pile makes survival
 * a countdown; a regrowing bush makes it a *loop* the player can reason about and
 * eventually improve on. Farming in Slice 2 is then a better version of something that
 * already works, not the first version of something that doesn't.
 */

import { TICKS_PER_DAY } from '../core/constants';
import { ItemDef, type ItemDefId } from './items';

export const Plant = {
  BerryBush: 0,
} as const;

export type PlantId = (typeof Plant)[keyof typeof Plant];

export interface PlantDef {
  readonly id: PlantId;
  readonly name: string;
  /** Ticks from bare to ripe. */
  readonly growTicks: number;
  /** Ticks of work to strip a ripe plant. */
  readonly harvestWork: number;
  readonly yield: { readonly def: ItemDefId; readonly count: number };
}

/** Indexed by PlantId — array position must equal `id`. */
export const PLANT_DEFS: readonly PlantDef[] = [
  {
    id: Plant.BerryBush,
    name: 'Berry Bush',
    // A little over half a day, so a bush picked in the morning is worth revisiting
    // before nightfall and the colony has a rhythm rather than a chore list.
    growTicks: Math.round(TICKS_PER_DAY * 0.6),
    harvestWork: 220,
    yield: { def: ItemDef.RawFood, count: 9 },
  },
];

export function plantDef(id: PlantId): PlantDef {
  return PLANT_DEFS[id];
}

/** Fraction of cells that get a bush where bushes can grow. */
export const BUSH_DENSITY = 0.045;
