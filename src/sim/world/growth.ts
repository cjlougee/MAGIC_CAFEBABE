/**
 * Plants maturing.
 *
 * A flat pass over every plant each tick. At the target map size that is a few hundred
 * integer increments — cheaper than any scheme for tracking which plants are "close to
 * ripe", and immune to the bugs such a scheme would introduce.
 *
 * If plant counts ever reach the thousands, the fix is a ripening queue keyed by the
 * tick each plant matures, not a partial sweep.
 */

import { plantDef } from '../defs/plants';
import type { World } from './world';

export function growPlants(world: World): void {
  for (const plant of world.plants.values()) {
    const ripeAt = plantDef(plant.def).growTicks;
    if (plant.growth < ripeAt) plant.growth++;
  }
}
