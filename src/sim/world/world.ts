/**
 * World state — everything that must be saved, and nothing that must not.
 *
 * Kept as plain data plus the Rng so serialization stays mechanical. Later
 * milestones extend this in place: M1 adds an entity store, M2 designations and
 * reservations, M4 rooms.
 */

import { DEFAULT_MAP_SIZE, STARTING_TICK } from '../core/constants';
import { Rng } from '../core/rng';
import type { TileMap } from './tilemap';
import { generateMap } from './worldgen';

export interface World {
  /** The seed this world was generated from. Reproduces the map exactly. */
  readonly seed: number;
  /** Absolute simulation time. Starts at STARTING_TICK (08:00 on day 1), not zero. */
  tick: number;
  /** The only source of randomness. Saved and restored with the world. */
  readonly rng: Rng;
  readonly map: TileMap;
}

export interface WorldOptions {
  readonly width?: number;
  readonly height?: number;
}

export function createWorld(seed: number, options: WorldOptions = {}): World {
  const width = options.width ?? DEFAULT_MAP_SIZE;
  const height = options.height ?? DEFAULT_MAP_SIZE;

  return {
    seed,
    tick: STARTING_TICK,
    // Offset so the simulation's random stream is independent of the noise fields
    // worldgen consumed — otherwise gameplay randomness would correlate with terrain.
    rng: new Rng(seed ^ 0x9e3779b9),
    map: generateMap(width, height, seed),
  };
}
