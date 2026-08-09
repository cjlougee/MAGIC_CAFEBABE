/**
 * World state — everything that must be saved, plus the derived indices built from it.
 *
 * The saved half is plain data plus the Rng, so serialization stays mechanical. The
 * derived half (pathfinder scratch, reachability components) is rebuildable from the
 * saved half and is deliberately excluded from `hashWorld` — hashing a cache would make
 * determinism tests fail for reasons that don't affect the game.
 */

import { Reservations } from '../ai/reservations';
import { DEFAULT_MAP_SIZE, STARTING_TICK } from '../core/constants';
import { EntityStore } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { Rng } from '../core/rng';
import { STARTING_BEDROLLS_PER_COLONIST } from '../defs/buildings';
import { STARTING_COLONISTS } from '../defs/pawnKind';
import type { Building } from '../entities/building';
import type { ConstructionSite } from '../entities/constructionSite';
import type { Pawn } from '../entities/pawn';
import type { Plant } from '../entities/plant';
import type { PointOfInterest } from '../entities/pointOfInterest';
import { Pathfinder } from '../pathfind/pathfinder';
import { ReachabilityMap } from '../pathfind/reachability';
import { Designations } from './designations';
import { ItemStore } from './itemStore';
import { placePointsOfInterest } from './poiPlacement';
import { RoomMap } from './rooms';
import { placeBedrolls, scatterPlants, spawnColonists } from './spawn';
import type { TileMap } from './tilemap';
import { generateMap } from './worldgen';
import { Zones } from './zones';

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
  readonly items: ItemStore;
  readonly plants: EntityStore<Plant>;
  readonly buildings: EntityStore<Building>;
  readonly sites: EntityStore<ConstructionSite>;
  /**
   * Named places. Sited by constraint at worldgen and *kept* — their names are the one
   * thing in the world that cannot be recomputed from the seed and the terrain.
   */
  readonly pois: EntityStore<PointOfInterest>;
  /** Cells the player has marked for work. */
  readonly designations: Designations;
  /** Player-painted areas — stockpiles, for now. */
  readonly zones: Zones;
  /** Claims on targets, so two colonists never pick the same rock. */
  readonly reservations: Reservations;
  /** Where the colony set down. Used to frame the camera on load. */
  readonly landingSite: TilePos;

  // ── Derived indices — rebuilt, never saved, never hashed ──────────────────
  readonly pathfinder: Pathfinder;
  readonly reachability: ReachabilityMap;
  readonly rooms: RoomMap;
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
  const plants = new EntityStore<Plant>();
  const buildings = new EntityStore<Building>();
  const sites = new EntityStore<ConstructionSite>();

  // Offset so the simulation's random stream is independent of the noise fields
  // worldgen consumed — otherwise gameplay randomness would correlate with terrain.
  const rng = new Rng(seed ^ 0x9e3779b9);
  const landingSite = spawnColonists(map, pawns, rng, colonists);

  // Places are sited *after* the landing site, because "far enough away to be a journey"
  // is measured from it, and *before* plants are scattered, so nothing grows on ground a
  // compound is about to be stamped over.
  const pois = new EntityStore<PointOfInterest>();
  placePointsOfInterest(map, pois, rng, landingSite);

  placeBedrolls(map, buildings, landingSite, colonists * STARTING_BEDROLLS_PER_COLONIST);
  scatterPlants(map, plants, rng);

  return {
    seed,
    tick: STARTING_TICK,
    rng,
    map,
    pawns,
    plants,
    buildings,
    sites,
    pois,
    items: new ItemStore(),
    designations: new Designations(),
    zones: new Zones(),
    reservations: new Reservations(),
    landingSite,
    pathfinder: new Pathfinder(map),
    reachability: new ReachabilityMap(map),
    rooms: new RoomMap(map),
  };
}
