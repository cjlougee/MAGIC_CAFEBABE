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
  }

  h = mixInt32(h, world.landingSite.x);
  h = mixInt32(h, world.landingSite.y);

  return h.toString(16).padStart(8, '0');
}
