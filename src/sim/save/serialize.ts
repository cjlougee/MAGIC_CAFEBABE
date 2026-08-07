/**
 * Turning a world into plain data, and back.
 *
 * Produces a JSON-safe object and nothing else — no strings, no storage, no `localStorage`.
 * Where a save *lives* is the app's problem (see `app/saveStorage.ts`); this stays inside
 * the headless boundary so save/load is testable in Node like everything else in sim/.
 *
 * **Derived indices are never saved.** Pathfinder scratch, reachability components, and
 * the room map are all rebuilt from the saved state on load. Saving them would double the
 * file size and add a way for a save to be internally inconsistent.
 *
 * When you add persistent state to World, add it here **and** to `hashWorld()`. The
 * round-trip test compares hashes, so a field missing from both passes silently.
 */

import { EntityStore } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import { Rng, type RngState } from '../core/rng';
import type { BuildableId } from '../defs/buildables';
import type { BuildingId } from '../defs/buildings';
import type { ItemDefId } from '../defs/items';
import type { PlantId } from '../defs/plants';
import { createBuilding, type Building } from '../entities/building';
import { createSite, type ConstructionSite } from '../entities/constructionSite';
import { createItem, type Item } from '../entities/item';
import { createPawn, type Pawn, type PawnAppearance } from '../entities/pawn';
import { createPlant, type Plant } from '../entities/plant';
import type { ActiveJob } from '../ai/job';
import { Reservations, type ReservationSave } from '../ai/reservations';
import { Pathfinder } from '../pathfind/pathfinder';
import { ReachabilityMap } from '../pathfind/reachability';
import { Designation, Designations } from '../world/designations';
import { ItemStore } from '../world/itemStore';
import { RoomMap } from '../world/rooms';
import { TileMap } from '../world/tilemap';
import type { World } from '../world/world';
import { Zones } from '../world/zones';

/** Bumped whenever the save shape changes. See migrate.ts. */
export const SAVE_VERSION = 1;

// ── Run-length encoding for the map grids ───────────────────────────────────────
// Terrain is enormously repetitive — long runs of the same value — so RLE turns tens of
// thousands of numbers into a few hundred. Hand-rolled rather than base64 so the format
// stays readable and depends on nothing.

export function encodeRle(data: Uint8Array): number[] {
  const out: number[] = [];
  if (data.length === 0) return out;

  let value = data[0];
  let run = 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i] === value && run < 0xffff) {
      run++;
      continue;
    }
    out.push(value, run);
    value = data[i];
    run = 1;
  }
  out.push(value, run);
  return out;
}

export function decodeRle(rle: readonly number[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const value = rle[i];
    const run = rle[i + 1];
    for (let n = 0; n < run && at < size; n++) out[at++] = value;
  }
  return out;
}

// ── Save shape ──────────────────────────────────────────────────────────────────

export interface SavedPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SavedPawn {
  readonly id: number;
  readonly name: string;
  readonly appearance: PawnAppearance;
  readonly pos: SavedPos;
  readonly moveTarget: SavedPos | null;
  readonly moveTicksTotal: number;
  readonly moveTicksElapsed: number;
  readonly path: SavedPos[];
  readonly pathIndex: number;
  readonly job: ActiveJob | null;
  readonly carryingItemId: number | null;
  readonly priorities: number[];
  readonly needs: number[];
  readonly memories: { def: number; age: number }[];
  readonly health: number;
  readonly dead: boolean;
  readonly breakTicks: number;
  readonly asleep: boolean;
}

export interface SaveData {
  readonly version: number;
  readonly seed: number;
  readonly tick: number;
  readonly rng: RngState;
  readonly map: {
    readonly width: number;
    readonly height: number;
    readonly levels: number;
    readonly terrain: number[];
    readonly blocks: number[];
    readonly seals: number[];
  };
  readonly landingSite: SavedPos;
  readonly pawns: SavedPawn[];
  readonly nextPawnId: number;
  readonly items: {
    id: number;
    def: number;
    count: number;
    pos: SavedPos | null;
    carriedBy: number | null;
  }[];
  readonly nextItemId: number;
  readonly plants: { id: number; def: number; pos: SavedPos; growth: number }[];
  readonly nextPlantId: number;
  readonly buildings: { id: number; def: number; pos: SavedPos; owner: number | null }[];
  readonly nextBuildingId: number;
  readonly sites: {
    id: number;
    def: number;
    pos: SavedPos;
    delivered: number[];
    workDone: number;
  }[];
  readonly nextSiteId: number;
  readonly mineDesignations: number[];
  readonly stockpiles: number[];
  readonly reservations: ReservationSave;
}

const at = (p: TilePos): SavedPos => ({ x: p.x, y: p.y, z: p.z ?? GROUND_LEVEL });

export function serializeWorld(world: World): SaveData {
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    tick: world.tick,
    rng: world.rng.save(),
    map: {
      width: world.map.width,
      height: world.map.height,
      levels: world.map.levels,
      terrain: encodeRle(world.map.terrain),
      blocks: encodeRle(world.map.buildingBlocks),
      seals: encodeRle(world.map.buildingSealsRoom),
    },
    landingSite: at(world.landingSite),
    pawns: [...world.pawns.values()].map((pawn) => ({
      id: pawn.id,
      name: pawn.name,
      appearance: { ...pawn.appearance },
      pos: at(pawn.pos),
      moveTarget: pawn.moveTarget ? at(pawn.moveTarget) : null,
      moveTicksTotal: pawn.moveTicksTotal,
      moveTicksElapsed: pawn.moveTicksElapsed,
      path: pawn.path.map(at),
      pathIndex: pawn.pathIndex,
      job: pawn.job,
      carryingItemId: pawn.carryingItemId,
      priorities: [...pawn.priorities],
      needs: [...pawn.needs],
      memories: pawn.memories.map((m) => ({ def: m.def, age: m.age })),
      health: pawn.health,
      dead: pawn.dead,
      breakTicks: pawn.breakTicks,
      asleep: pawn.asleep,
    })),
    nextPawnId: world.pawns.nextIdForSave,
    items: [...world.items.values()].map((item) => ({
      id: item.id,
      def: item.def,
      count: item.count,
      pos: item.pos ? at(item.pos) : null,
      carriedBy: item.carriedBy,
    })),
    nextItemId: world.items.nextIdForSave,
    plants: [...world.plants.values()].map((p) => ({
      id: p.id,
      def: p.def,
      pos: at(p.pos),
      growth: p.growth,
    })),
    nextPlantId: world.plants.nextIdForSave,
    buildings: [...world.buildings.values()].map((b) => ({
      id: b.id,
      def: b.def,
      pos: at(b.pos),
      owner: b.owner,
    })),
    nextBuildingId: world.buildings.nextIdForSave,
    sites: [...world.sites.values()].map((s) => ({
      id: s.id,
      def: s.def,
      pos: at(s.pos),
      delivered: [...s.delivered],
      workDone: s.workDone,
    })),
    nextSiteId: world.sites.nextIdForSave,
    mineDesignations: [...world.designations.cells(Designation.Mine)],
    stockpiles: [...world.zones.stockpiles],
    reservations: world.reservations.save(),
  };
}

export function deserializeWorld(save: SaveData): World {
  const map = new TileMap(save.map.width, save.map.height, save.map.levels);
  map.terrain.set(decodeRle(save.map.terrain, map.size));
  map.buildingBlocks.set(decodeRle(save.map.blocks, map.size));
  map.buildingSealsRoom.set(decodeRle(save.map.seals, map.size));
  // walkCost is derived, so rebuild it rather than trusting a saved copy to agree.
  map.rebuildWalkCost();

  const pawns = new EntityStore<Pawn>();
  for (const saved of save.pawns) {
    const pawn = createPawn(saved.id, saved.name, saved.pos, saved.appearance);
    pawn.moveTarget = saved.moveTarget;
    pawn.moveTicksTotal = saved.moveTicksTotal;
    pawn.moveTicksElapsed = saved.moveTicksElapsed;
    pawn.path = saved.path;
    pawn.pathIndex = saved.pathIndex;
    pawn.job = saved.job;
    pawn.carryingItemId = saved.carryingItemId;
    pawn.priorities = [...saved.priorities];
    pawn.needs = [...saved.needs];
    pawn.memories = saved.memories.map((m) => ({ def: m.def as never, age: m.age }));
    pawn.health = saved.health;
    pawn.dead = saved.dead;
    pawn.breakTicks = saved.breakTicks;
    pawn.asleep = saved.asleep;
    pawns.restore(pawn);
  }
  pawns.restoreNextId(save.nextPawnId);

  const items = new ItemStore();
  for (const saved of save.items) {
    const item: Item = createItem(saved.id, saved.def as ItemDefId, saved.count, saved.pos);
    item.carriedBy = saved.carriedBy;
    items.restore(item, map);
  }
  items.restoreNextId(save.nextItemId);

  const plants = new EntityStore<Plant>();
  for (const saved of save.plants) {
    plants.restore(createPlant(saved.id, saved.def as PlantId, saved.pos, saved.growth));
  }
  plants.restoreNextId(save.nextPlantId);

  const buildings = new EntityStore<Building>();
  for (const saved of save.buildings) {
    const building = createBuilding(saved.id, saved.def as BuildingId, saved.pos);
    building.owner = saved.owner;
    buildings.restore(building);
  }
  buildings.restoreNextId(save.nextBuildingId);

  const sites = new EntityStore<ConstructionSite>();
  for (const saved of save.sites) {
    const site = createSite(saved.id, saved.def as BuildableId, saved.pos);
    saved.delivered.forEach((count, def) => {
      site.delivered[def] = count;
    });
    site.workDone = saved.workDone;
    sites.restore(site);
  }
  sites.restoreNextId(save.nextSiteId);

  const designations = new Designations();
  for (const cell of save.mineDesignations) designations.add(Designation.Mine, cell);

  const zones = new Zones();
  for (const cell of save.stockpiles) zones.addStockpile(cell);

  return {
    seed: save.seed,
    tick: save.tick,
    rng: Rng.fromState(save.rng),
    map,
    pawns,
    items,
    plants,
    buildings,
    sites,
    designations,
    zones,
    reservations: Reservations.restore(save.reservations),
    landingSite: save.landingSite,
    // Rebuilt, never saved. They are caches of everything above.
    pathfinder: new Pathfinder(map),
    reachability: new ReachabilityMap(map),
    rooms: new RoomMap(map),
  };
}
