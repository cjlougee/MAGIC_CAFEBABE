/**
 * The movement rule, defined once.
 *
 * Pathfinding and reachability **must** agree on what counts as a legal step. If they
 * disagree, reachability says "yes you can get there" and A* then fails to find a
 * route, and the pawn re-plans forever — one of the classic ways a colony sim burns a
 * frame budget doing nothing.
 *
 * Movement is 8-directional with no corner cutting: a diagonal step is only legal when
 * both adjacent orthogonal cells are open, so pawns cannot squeeze through the gap
 * where two walls meet at a point.
 */

import { GROUND_LEVEL } from '../core/position';
import type { TileMap } from '../world/tilemap';

/** dx, dy pairs. Orthogonals first — they are the common case and the cheaper test. */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function isDiagonal(dx: number, dy: number): boolean {
  return dx !== 0 && dy !== 0;
}

/**
 * Whether a pawn standing at (x, y) may step by (dx, dy).
 *
 * Levels are not yet linked: every step stays on one z. Vertical connectivity arrives
 * with ramps — see docs/decisions/0003-verticality.md.
 */
export function canStep(
  map: TileMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  z: number = GROUND_LEVEL,
): boolean {
  const nx = x + dx;
  const ny = y + dy;
  if (!map.isPassable(nx, ny, z)) return false;

  if (isDiagonal(dx, dy)) {
    // Both shoulders must be open, or the pawn would clip the corner of a wall.
    if (!map.isPassable(x + dx, y, z)) return false;
    if (!map.isPassable(x, y + dy, z)) return false;
  }

  return true;
}

/** Cost of entering (x, y). Diagonals cost √2 more, kept in integers as 141/100. */
export function stepCost(
  map: TileMap,
  x: number,
  y: number,
  diagonal: boolean,
  z: number = GROUND_LEVEL,
): number {
  const cost = map.walkCost[map.idx(x, y, z)];
  return diagonal ? ((cost * 141) / 100) | 0 : cost;
}
