/**
 * The toil library — small, reusable steps that job drivers compose.
 *
 * Every toil is **re-entrant and self-correcting**: it is called every tick and decides
 * afresh whether it is done, still working, or has failed. None of them cache state
 * beyond what lives in `ActiveJob`, which is why a job can be saved mid-step and
 * resumed, and why the world changing underneath a pawn degrades into a clean failure
 * rather than a wedged colonist.
 *
 * Adding a job kind should mean composing these, not writing new ones. When it doesn't,
 * that is the signal a toil is missing.
 */

import { GROUND_LEVEL, samePos, type TilePos } from '../core/position';
import type { Pawn } from '../entities/pawn';
import { clearPath } from '../entities/pawn';
import { DIRECTIONS } from '../pathfind/neighbours';
import type { World } from '../world/world';
import type { ActiveJob, Job } from './job';

export type ToilResult = 'running' | 'done' | 'failed';

export interface ToilContext {
  readonly world: World;
  readonly pawn: Pawn;
  readonly job: Job;
  readonly active: ActiveJob;
}

export interface Toil {
  readonly name: string;
  readonly tick: (ctx: ToilContext) => ToilResult;
}

/** Give up after this many failed route attempts within one toil. */
const MAX_PATH_ATTEMPTS = 3;

function isAdjacent(a: TilePos, b: TilePos): boolean {
  return (
    a.z === b.z && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && !samePos(a, b)
  );
}

/**
 * The reachable open cell beside `target` that is nearest to `from`.
 *
 * Used to stand next to something solid. Picks by straight-line distance and confirms
 * reachability in O(1) rather than running A* against all eight neighbours, which would
 * be eight searches to answer a question one search can settle.
 */
export function bestAdjacentCell(world: World, target: TilePos, from: TilePos): TilePos | null {
  const z = target.z ?? GROUND_LEVEL;
  let best: TilePos | null = null;
  let bestDistance = Infinity;

  for (const [dx, dy] of DIRECTIONS) {
    const cell = { x: target.x + dx, y: target.y + dy, z };
    if (!world.map.isPassable(cell.x, cell.y, z)) continue;
    if (!world.reachability.canReach(from, cell)) continue;

    const distance = Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }

  return best;
}

function routeTo(ctx: ToilContext, destination: TilePos): ToilResult {
  const { world, pawn, active } = ctx;
  const origin = pawn.moveTarget ?? pawn.pos;

  if (!world.reachability.canReach(origin, destination)) return 'failed';

  const result = world.pathfinder.find(origin, destination);
  if (!result) {
    active.attempts++;
    return active.attempts >= MAX_PATH_ATTEMPTS ? 'failed' : 'running';
  }

  pawn.path = result.steps;
  pawn.pathIndex = 0;
  return 'running';
}

/** Claims a cell so no other colonist targets it. Fails immediately if taken. */
export function toilReserveCell(pick: (job: Job) => TilePos): Toil {
  return {
    name: 'reserveCell',
    tick: ({ world, pawn, job }) => {
      const cell = pick(job);
      const index = world.map.idx(cell.x, cell.y, cell.z);
      return world.reservations.reserveCell(index, pawn.id) ? 'done' : 'failed';
    },
  };
}

/** Claims an item. Fails if it is gone or already spoken for. */
export function toilReserveItem(pick: (job: Job) => number): Toil {
  return {
    name: 'reserveItem',
    tick: ({ world, pawn, job }) => {
      const id = pick(job);
      if (!world.items.get(id)) return 'failed';
      return world.reservations.reserveItem(id, pawn.id) ? 'done' : 'failed';
    },
  };
}

/**
 * Walks onto a specific cell.
 *
 * Clears any remaining route on arrival. Movement ticks *after* jobs, so a leftover
 * path would carry the pawn straight back off the cell it just reached — and the next
 * toil would run while the pawn quietly walked away from its own target.
 */
export function toilWalkTo(pick: (job: Job, world: World) => TilePos | null): Toil {
  return {
    name: 'walkTo',
    tick: (ctx) => {
      const destination = pick(ctx.job, ctx.world);
      if (!destination) return 'failed';

      if (samePos(ctx.pawn.pos, destination) && !ctx.pawn.moveTarget) {
        clearPath(ctx.pawn);
        return 'done';
      }
      if (ctx.pawn.moveTarget || ctx.pawn.pathIndex < ctx.pawn.path.length) return 'running';
      return routeTo(ctx, destination);
    },
  };
}

/**
 * Walks to any open cell touching the target.
 *
 * Recomputed each tick rather than fixed on arrival, so a colonist whose chosen
 * approach gets blocked mid-walk simply picks another instead of failing the job.
 */
export function toilWalkAdjacentTo(pick: (job: Job) => TilePos): Toil {
  return {
    name: 'walkAdjacentTo',
    tick: (ctx) => {
      const target = pick(ctx.job);
      if (isAdjacent(ctx.pawn.pos, target) && !ctx.pawn.moveTarget) {
        // See toilWalkTo: a stale route would walk the pawn away from its own work.
        clearPath(ctx.pawn);
        return 'done';
      }
      if (ctx.pawn.moveTarget || ctx.pawn.pathIndex < ctx.pawn.path.length) return 'running';

      const stand = bestAdjacentCell(ctx.world, target, ctx.pawn.pos);
      if (!stand) return 'failed';
      return routeTo(ctx, stand);
    },
  };
}

/**
 * Accumulates work until a threshold, then fires `complete`.
 *
 * `stillValid` is checked every tick because the reason for the work can disappear
 * while it is being done — someone else finished the rock, or the player cancelled the
 * designation. Noticing takes one comparison; not noticing means mining a hole that
 * isn't there.
 */
export function toilWork(options: {
  readonly workNeeded: (ctx: ToilContext) => number;
  readonly stillValid: (ctx: ToilContext) => boolean;
  readonly complete: (ctx: ToilContext) => void;
  readonly rate?: number;
  /** Cell the pawn must stay beside. Work stops if they end up somewhere else. */
  readonly besides?: (job: Job) => TilePos;
}): Toil {
  return {
    name: 'work',
    tick: (ctx) => {
      if (!options.stillValid(ctx)) return 'failed';

      // Belt and braces against a pawn drifting off its target mid-job. Cheap, and the
      // alternative is mining a rock from across the map with no visible cause.
      if (options.besides && !isAdjacent(ctx.pawn.pos, options.besides(ctx.job))) return 'failed';

      ctx.active.workDone += options.rate ?? 1;
      if (ctx.active.workDone < options.workNeeded(ctx)) return 'running';

      options.complete(ctx);
      return 'done';
    },
  };
}

/** Lifts a reserved item off the ground. The pawn must be standing on it. */
export function toilPickUp(pick: (job: Job) => number): Toil {
  return {
    name: 'pickUp',
    tick: ({ world, pawn, job }) => {
      const item = world.items.get(pick(job));
      if (!item || !item.pos) return 'failed';
      if (!samePos(pawn.pos, item.pos)) return 'failed';

      world.items.beginCarry(item, pawn.id, world.map);
      pawn.carryingItemId = item.id;
      return 'done';
    },
  };
}

/** Puts down whatever the pawn is carrying, merging into any matching stack. */
export function toilDropCarried(): Toil {
  return {
    name: 'dropCarried',
    tick: ({ world, pawn }) => {
      if (pawn.carryingItemId === null) return 'failed';
      const item = world.items.get(pawn.carryingItemId);
      if (!item) {
        pawn.carryingItemId = null;
        return 'failed';
      }

      world.items.placeAt(item, world.map, pawn.pos);
      pawn.carryingItemId = null;
      return 'done';
    },
  };
}

/** Clears any stale route when a toil sequence begins. */
export function resetMovement(pawn: Pawn): void {
  clearPath(pawn);
}
