/**
 * A cheap, stable fingerprint of world state.
 *
 * This exists to make determinism testable: run from a seed twice, hash both, assert
 * equality. It is also how the M5 save round-trip test proves nothing was lost in
 * serialization.
 *
 * FNV-1a over a canonical byte order. **When you add saved state to World, add it
 * here** — a hash that ignores a field silently stops guarding it.
 */

import { Designation } from '../world/designations';
import type { World } from '../world/world';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function mixByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

function mixInt32(hash: number, value: number): number {
  let h = hash;
  h = mixByte(h, value);
  h = mixByte(h, value >>> 8);
  h = mixByte(h, value >>> 16);
  h = mixByte(h, value >>> 24);
  return h;
}

function mixBytes(hash: number, bytes: Uint8Array): number {
  let h = hash;
  for (let i = 0; i < bytes.length; i++) {
    h = mixByte(h, bytes[i]);
  }
  return h;
}

function mixString(hash: number, text: string): number {
  let h = mixInt32(hash, text.length);
  for (let i = 0; i < text.length; i++) {
    h = mixInt32(h, text.charCodeAt(i));
  }
  return h;
}

/** Hex fingerprint of everything the world considers persistent state. */
export function hashWorld(world: World): string {
  let h = FNV_OFFSET >>> 0;

  h = mixInt32(h, world.seed);
  h = mixInt32(h, world.tick);

  const rng = world.rng.save();
  h = mixInt32(h, rng.a);
  h = mixInt32(h, rng.b);
  h = mixInt32(h, rng.c);
  h = mixInt32(h, rng.d);

  h = mixInt32(h, world.map.width);
  h = mixInt32(h, world.map.height);
  h = mixInt32(h, world.map.levels);
  h = mixBytes(h, world.map.terrain);
  // Saved, so hashed. It cannot be derived from terrain — that is the whole reason it
  // exists — so leaving it out would let a floor's foundation change unnoticed.
  h = mixBytes(h, world.map.naturalTerrain);

  // Pawns, in the entity store's insertion order — which is stable, and part of what
  // determinism means here. Derived indices (pathfinder scratch, reachability
  // components) are deliberately absent: they are caches rebuilt from the above, and
  // hashing them would fail determinism tests for reasons that don't affect the game.
  h = mixInt32(h, world.pawns.size);
  h = mixInt32(h, world.pawns.nextIdForSave);
  for (const pawn of world.pawns.values()) {
    h = mixInt32(h, pawn.id);
    h = mixString(h, pawn.name);
    h = mixInt32(h, pawn.pos.x);
    h = mixInt32(h, pawn.pos.y);
    h = mixInt32(h, pawn.pos.z);
    h = mixInt32(h, pawn.moveTicksElapsed);
    h = mixInt32(h, pawn.moveTicksTotal);
    h = mixInt32(h, pawn.pathIndex);
    h = mixInt32(h, pawn.path.length);
    h = mixInt32(h, pawn.appearance.skinTone);
    h = mixInt32(h, pawn.appearance.hairStyle);
    h = mixInt32(h, pawn.appearance.hairColour);
    h = mixInt32(h, pawn.appearance.apparelColour);

    for (const priority of pawn.priorities) h = mixInt32(h, priority);

    // Job progress, so a determinism failure mid-job is caught at the tick it diverges
    // rather than whenever the outcome happens to differ.
    h = mixInt32(h, pawn.carryingItemId ?? -1);
    h = mixInt32(h, pawn.job ? 1 : 0);
    if (pawn.job) {
      h = mixString(h, pawn.job.job.kind);
      h = mixInt32(h, pawn.job.toilIndex);
      h = mixInt32(h, pawn.job.workDone);
      h = mixInt32(h, pawn.job.attempts);
    }

    // Needs are floats; quantised to a fixed grid so the hash compares exactly without
    // depending on the last bits of a value that drifts by a millionth per tick.
    for (const need of pawn.needs) h = mixInt32(h, Math.round(need * 1e6));
    h = mixInt32(h, Math.round(pawn.health * 1e6));
    h = mixInt32(h, pawn.dead ? 1 : 0);
    h = mixInt32(h, pawn.asleep ? 1 : 0);
    h = mixInt32(h, pawn.breakTicks);
    // Draft state is saved, so it is hashed. A standing order is the difference between
    // a colonist who resumes walking across the map after a reload and one who stands
    // where the reload found them.
    h = mixInt32(h, pawn.drafted ? 1 : 0);
    h = mixInt32(h, pawn.draftTarget?.x ?? -1);
    h = mixInt32(h, pawn.draftTarget?.y ?? -1);
    h = mixInt32(h, pawn.playerCharacter ? 1 : 0);
    h = mixInt32(h, pawn.memories.length);
    for (const memory of pawn.memories) {
      h = mixInt32(h, memory.def);
      h = mixInt32(h, memory.age);
    }
  }

  h = mixInt32(h, world.plants.size);
  for (const plant of world.plants.values()) {
    h = mixInt32(h, plant.id);
    h = mixInt32(h, plant.def);
    h = mixInt32(h, plant.pos.x);
    h = mixInt32(h, plant.pos.y);
    h = mixInt32(h, plant.growth);
  }

  h = mixInt32(h, world.buildings.size);
  for (const building of world.buildings.values()) {
    h = mixInt32(h, building.id);
    h = mixInt32(h, building.def);
    h = mixInt32(h, building.pos.x);
    h = mixInt32(h, building.pos.y);
    h = mixInt32(h, building.owner ?? -1);
    // Bills and loaded ingredients are saved, so they are hashed. A field in one and not
    // the other passes the round-trip test while guarding nothing.
    for (const bill of building.bills) {
      h = mixInt32(h, bill.recipe);
      h = mixInt32(h, bill.untilCount);
    }
    for (const count of building.loaded) h = mixInt32(h, count);
  }

  h = mixInt32(h, world.sites.size);
  for (const site of world.sites.values()) {
    h = mixInt32(h, site.id);
    h = mixInt32(h, site.def);
    h = mixInt32(h, site.pos.x);
    h = mixInt32(h, site.pos.y);
    h = mixInt32(h, site.workDone);
    for (const delivered of site.delivered) h = mixInt32(h, delivered);
  }

  // Named places. The name is hashed as well as the position, because the name is the
  // part that cannot be recomputed — a round trip that restored the right compound in
  // the right spot under a different name would otherwise pass.
  h = mixInt32(h, world.pois.size);
  h = mixInt32(h, world.pois.nextIdForSave);
  for (const poi of world.pois.values()) {
    h = mixInt32(h, poi.id);
    h = mixInt32(h, poi.def);
    h = mixString(h, poi.name);
    h = mixInt32(h, poi.pos.x);
    h = mixInt32(h, poi.pos.y);
    h = mixInt32(h, poi.pos.z);
    h = mixInt32(h, poi.radius);
  }

  // Structures change passability without changing terrain, so the terrain array alone
  // no longer describes the map.
  h = mixBytes(h, world.map.buildingBlocks);
  h = mixBytes(h, world.map.buildingSealsRoom);

  h = mixInt32(h, world.items.size);
  h = mixInt32(h, world.items.nextIdForSave);
  for (const item of world.items.values()) {
    h = mixInt32(h, item.id);
    h = mixInt32(h, item.def);
    h = mixInt32(h, item.count);
    h = mixInt32(h, item.pos?.x ?? -1);
    h = mixInt32(h, item.pos?.y ?? -1);
    h = mixInt32(h, item.carriedBy ?? -1);
  }

  for (const cell of world.designations.cells(Designation.Mine)) h = mixInt32(h, cell);
  for (const cell of world.designations.cells(Designation.Deconstruct)) h = mixInt32(h, cell);
  for (const cell of world.zones.stockpiles) h = mixInt32(h, cell);

  h = mixInt32(h, world.landingSite.x);
  h = mixInt32(h, world.landingSite.y);

  return h.toString(16).padStart(8, '0');
}
