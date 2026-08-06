/**
 * Walking.
 *
 * Advances one pawn by one tick along its route. This is the lowest layer of pawn
 * behaviour — it knows nothing about *why* the pawn is going anywhere. M2's job system
 * sits above it and supplies routes; this stays the only code that moves a pawn.
 */

import { GROUND_LEVEL } from '../core/position';
import { clearPath, isMoving, ticksToEnter, type Pawn } from '../entities/pawn';
import { isDiagonal, stepCost } from '../pathfind/neighbours';
import type { TileMap } from '../world/tilemap';

/** How far to look for open ground when a colonist ends up somewhere impossible. */
const ESCAPE_RADIUS = 8;

/**
 * Gets a colonist off a cell they cannot legally stand on.
 *
 * A pawn on an impassable cell is in the worst state the simulation has: reachability
 * reports their own position as unreachable, so `canReach` fails for *every* target and
 * they idle forever with no visible cause. The construction system now refuses to seal
 * anyone in, but this is the backstop — the failure is severe enough to be worth
 * guarding in more than one place.
 */
function escapeIfTrapped(map: TileMap, pawn: Pawn): void {
  const z = pawn.pos.z ?? GROUND_LEVEL;
  if (map.isPassable(pawn.pos.x, pawn.pos.y, z)) return;

  for (let radius = 1; radius <= ESCAPE_RADIUS; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = pawn.pos.x + dx;
        const y = pawn.pos.y + dy;
        if (!map.isPassable(x, y, z)) continue;

        pawn.pos = { x, y, z };
        pawn.moveTarget = null;
        pawn.moveTicksElapsed = 0;
        pawn.moveTicksTotal = 0;
        clearPath(pawn);
        return;
      }
    }
  }
}

export function tickMovement(map: TileMap, pawn: Pawn): void {
  escapeIfTrapped(map, pawn);

  if (pawn.moveTarget) {
    pawn.moveTicksElapsed++;
    if (pawn.moveTicksElapsed < pawn.moveTicksTotal) return;

    pawn.pos = pawn.moveTarget;
    pawn.moveTarget = null;
    pawn.moveTicksElapsed = 0;
    pawn.moveTicksTotal = 0;
  }

  if (!isMoving(pawn)) return;
  beginNextStep(map, pawn);
}

function beginNextStep(map: TileMap, pawn: Pawn): void {
  if (pawn.pathIndex >= pawn.path.length) {
    clearPath(pawn);
    return;
  }

  const next = pawn.path[pawn.pathIndex];
  const z = next.z ?? GROUND_LEVEL;

  // The world can change under a route that was valid when planned — a wall built
  // across it, a bridge deconstructed. Give up rather than walk through it; whoever
  // issued the route is responsible for noticing and re-planning.
  if (!map.isPassable(next.x, next.y, z)) {
    clearPath(pawn);
    return;
  }

  const diagonal = isDiagonal(next.x - pawn.pos.x, next.y - pawn.pos.y);
  pawn.pathIndex++;
  pawn.moveTarget = next;
  pawn.moveTicksTotal = ticksToEnter(stepCost(map, next.x, next.y, diagonal, z));
  pawn.moveTicksElapsed = 0;
}
