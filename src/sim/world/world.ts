/**
 * World state — everything that must be saved, plus the derived indices built from it.
 *
 * The saved half is plain data plus the Rng, so serialization stays mechanical. The
 * derived half (pathfinder scratch, reachability components) is rebuildable from the
 * saved half and is deliberately excluded from `hashWorld` — hashing a cache would make
 * determinism tests fail for reasons that don't affect the game.
 */

import { DEFAULT_MAP_SIZE, STARTING_TICK } from '../core/constants';
import { EntityStore } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { Rng } from '../core/rng';
import { STARTING_COLONISTS } from '../defs/pawnKind';
import type { Pawn } from '../entities/pawn';
import { Pathfinder } from '../pathfind/pathfinder';
import { ReachabilityMap } from '../pathfind/reachability';
import { spawnColonists } from './spawn';
import type { TileMap } from './tilemap';
import { generateMap } from './worldgen';

export interface World {
  // ── Saved state ───────────────────────────────────────────────────────────
  /** The seed this world was generated from. Reproduces the map exactly. */
  readonly seed: number;
  /** Absolute simulation time. Starts at STARTING_TICK (08:00 on day 1), not zero. */
  tick: number;
  /** The only source of randomness. Saved and restored with the world. */
  readonly rng: Rng;
  readonly map: TileMap;
  readonly pawns: EntityStore<Pawn>;
  /** Where the colony set down. Used to frame the camera on load. */
  readonly landingSite: TilePos;

  // ── Derived indices — rebuilt, never saved, never hashed ──────────────────
  readonly pathfinder: Pathfinder;
  readonly reachability: ReachabilityMap;
}

export interface WorldOptions {
  readonly width?: number;
  readonly height?: number;
  readonly colonists?: number;
}

export function createWorld(seed: number, options: WorldOptions = {}): World {
  const width = options.width ?? DEFAULT_MAP_SIZE;
  const height = options.height ?? DEFAULT_MAP_SIZE;
  const colonists = options.colonists ?? STARTING_COLONISTS;

  const map = generateMap(width, height, seed);
  const pawns = new EntityStore<Pawn>();

  // Offset so the simulation's random stream is independent of the noise fields
  // worldgen consumed — otherwise gameplay randomness would correlate with terrain.
  const rng = new Rng(seed ^ 0x9e3779b9);
  const landingSite = spawnColonists(map, pawns, rng, colonists);

  return {
    seed,
    tick: STARTING_TICK,
    rng,
    map,
    pawns,
    landingSite,
    pathfinder: new Pathfinder(map),
    reachability: new ReachabilityMap(map),
  };
}
