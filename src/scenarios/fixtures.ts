/**
 * The ground a scenario stands on: one seed, one clock, one way to make a plain field.
 *
 * Everything here is shared by every scenario, which is the point — a scenario that rolled
 * its own seed or its own idea of dusk would produce a different picture each time it was
 * looked at, and a review surface you cannot compare against yesterday is not a review
 * surface.
 */

import { TICKS_PER_HOUR } from '../sim/core/constants';
import { Terrain, type TerrainId } from '../sim/defs/terrain';
import type { World } from '../sim/world/world';

/**
 * The seed every scenario world is generated from.
 *
 * Fixed rather than per-scenario so two runs of one scenario are the same picture, and
 * so a diff between two runs means something changed in the code.
 *
 * 0xCAFE puts the landing party near the middle of a small map with nothing else on it —
 * no ruins, no bushes — which keeps a flattened field genuinely empty for anything
 * placed at the edges of it.
 */
export const SCENARIO_SEED = 0xcafe;

/**
 * How big a scenario world is unless it asks otherwise.
 *
 * Far smaller than the real map, because a scenario is photographed rather than played:
 * the frame covers a few dozen tiles and worldgen over 512² would be time spent on
 * ground nobody will ever see.
 */
export const SCENARIO_SIZE = 48;

/**
 * How many colonists a scenario world lands with.
 *
 * More than the game's starting party, because a scenario poses people rather than
 * playing them — showing four beds occupied needs four bodies, and running out mid-build
 * is a failure with no obvious cause. The spares stand at the landing site, which is
 * outside the frame of anything that places its own structures.
 */
export const SCENARIO_COLONISTS = 8;

/** The hours a scenario asks for by name. Dusk is late enough that the light has turned. */
export const HOURS = { dawn: 6, noon: 12, dusk: 19, night: 23 } as const;

export type HourName = keyof typeof HOURS;

/**
 * The absolute tick at which an hour of the first day begins.
 *
 * Day one, so a scenario's clock is a function of the hour alone. Worlds start at 08:00
 * and this deliberately winds back past that: a scenario world has never been played, so
 * there is nothing already in it that a rewound clock could leave stranded in the future.
 */
export function tickAtHour(hour: number): number {
  return Math.round(hour * TICKS_PER_HOUR);
}

/**
 * Replaces every tile with the same plain ground.
 *
 * `setTerrainAt`, not `setSurfaceAt`: *the ground itself* is being changed, so the
 * remembered natural terrain has to change with it. Laying a surface over the map would
 * leave rock underneath, and the first floor deconstructed in front of the camera would
 * hand back stone from a mountain that is no longer there.
 */
export function flatten(world: World, terrain: TerrainId = Terrain.Grass): void {
  const map = world.map;
  for (let i = 0; i < map.size; i++) map.setTerrainAt(i, terrain);

  // The blanket forms, which are the *right* ones here and would be wrong for a single
  // cell: every cell changed, so there is nothing for a per-chunk invalidation to be
  // cheaper than. Without them, reachability still describes the rock this just erased.
  world.reachability.markDirty();
  world.rooms.markDirty();
}
