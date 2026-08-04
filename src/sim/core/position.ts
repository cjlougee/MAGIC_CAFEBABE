/**
 * A position in the world.
 *
 * **`z` exists from day one deliberately, even though the map is currently one level
 * deep.** Adding a trailing argument to an indexing function later is mechanical;
 * widening the position type after pawns, jobs, reservations, pathfinding nodes, and
 * save files have all been built on `{x, y}` is not. This type is defined before the
 * first pawn exists precisely so that never has to happen.
 *
 * The model is **discrete z-levels**, not a continuous height field — see
 * docs/decisions/0003-verticality.md. High ground is "standing on level 1", a trench is
 * "floor at level -1", a cave is a level with solid rock above it. One concept covers
 * elevation combat bonuses, cover, multi-storey building, and underground.
 *
 * Until levels land, every z is GROUND_LEVEL and all of this costs one unused field.
 */

/** The surface. Levels above are positive, underground is negative. */
export const GROUND_LEVEL = 0;

export interface TilePos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function pos(x: number, y: number, z: number = GROUND_LEVEL): TilePos {
  return { x, y, z };
}

export function samePos(a: TilePos, b: TilePos): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** True when two positions share a level — i.e. one can reach the other without a ramp. */
export function sameLevel(a: TilePos, b: TilePos): boolean {
  return a.z === b.z;
}

/**
 * Chebyshev distance within a level, which is the right metric for a grid that allows
 * diagonal movement. Returns Infinity across levels: travel between levels goes through
 * a ramp or stair, so straight-line distance is meaningless there.
 */
export function tileDistance(a: TilePos, b: TilePos): number {
  if (a.z !== b.z) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
