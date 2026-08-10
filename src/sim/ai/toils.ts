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

import { samePos, type TilePos } from '../core/position';
import { Need } from '../defs/needs';
import type { Item } from '../entities/item';
import type { Pawn } from '../entities/pawn';
import { clearPath } from '../entities/pawn';
import { cellsAdjacentTo, isAdjacentToFootprint } from '../world/footprint';
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

/**
 * The reachable open cell beside `target` that is nearest to `from`.
 *
 * Used to stand next to something solid. Picks by straight-line distance and confirms
 * reachability in O(1) rather than running A* against all eight neighbours, which would
 * be eight searches to answer a question one search can settle.
 */
export function bestAdjacentCell(world: World, target: TilePos, from: TilePos): TilePos | null {
  return bestCellBeside(world, [target], from);
}

/**
 * The same, for something standing on more than one cell.
 *
 * Candidates come from `cellsAdjacentTo`, which excludes the footprint itself — so a
 * colonist told to work on a 2×2 hearth stands outside it rather than discovering that
 * one of its own cells is "adjacent" to another.
 */
export function bestCellBeside(
  world: World,
  cells: readonly TilePos[],
  from: TilePos,
): TilePos | null {
  let best: TilePos | null = null;
  let bestDistance = Infinity;

  for (const cell of cellsAdjacentTo(cells)) {
    if (!world.map.isPassable(cell.x, cell.y, cell.z)) continue;
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
      return world.reservations.reserveEntity(id, pawn.id) ? 'done' : 'failed';
    },
  };
}

/**
 * Claims any entity — a plant, a bed, a stack.
 *
 * `exists` is supplied by the caller because only the driver knows which store the id
 * lives in, and a claim on something that has since been destroyed is worse than no
 * claim at all.
 *
 * `pick` gets the world because some targets are named by *where* they are rather than
 * by id — deconstruction addresses a cell and asks what stands on it. Resolving that
 * each tick beats storing the id in the job, which could then disagree with the world.
 */
export function toilReserveEntity(
  pick: (job: Job, world: World) => number | null,
  exists: (ctx: ToilContext, id: number) => boolean,
): Toil {
  return {
    name: 'reserveEntity',
    tick: (ctx) => {
      const id = pick(ctx.job, ctx.world);
      // A null target is legitimate for optional claims — sleeping rough has no bed.
      if (id === null) return 'done';
      if (!exists(ctx, id)) return 'failed';
      return ctx.world.reservations.reserveEntity(id, ctx.pawn.id) ? 'done' : 'failed';
    },
  };
}

/**
 * Sleeps until rested, or until something more urgent wakes the colonist.
 *
 * Not a work toil: it ends on a *need* threshold rather than accumulated effort, and it
 * must survive tens of thousands of ticks, so it stores nothing beyond the pawn's own
 * `asleep` flag.
 */
export function toilSleep(options: {
  readonly wakeAt: number;
  readonly onWake: (ctx: ToilContext) => void;
}): Toil {
  return {
    name: 'sleep',
    tick: (ctx) => {
      const { pawn } = ctx;
      pawn.asleep = true;

      if (pawn.needs[Need.Rest] < options.wakeAt) return 'running';

      pawn.asleep = false;
      options.onWake(ctx);
      return 'done';
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
 * Walks to any open cell touching the target, recomputed each tick rather than fixed on
 * arrival — a colonist whose chosen approach gets blocked mid-walk picks another instead
 * of failing the job.
 *
 * The picker may return one cell or a whole footprint. Callers that own a building or a
 * site hand over its cells, so "beside it" means beside the *structure* rather than
 * beside whichever cell happened to be its anchor — otherwise a colonist told to work on
 * a 2×2 hearth would stand at the far corner of it, reach nothing, and never say why.
 */
export function toilWalkAdjacentTo(
  pick: (job: Job, world: World) => TilePos | readonly TilePos[] | null,
): Toil {
  return {
    name: 'walkAdjacentTo',
    tick: (ctx) => {
      const target = pick(ctx.job, ctx.world);
      if (!target) return 'failed';

      const cells = Array.isArray(target) ? (target as readonly TilePos[]) : [target as TilePos];
      if (cells.length === 0) return 'failed';

      if (isAdjacentToFootprint(ctx.pawn.pos, cells) && !ctx.pawn.moveTarget) {
        // See toilWalkTo: a stale route would walk the pawn away from its own work.
        clearPath(ctx.pawn);
        return 'done';
      }
      if (ctx.pawn.moveTarget || ctx.pawn.pathIndex < ctx.pawn.path.length) return 'running';

      const stand = bestCellBeside(ctx.world, cells, ctx.pawn.pos);
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
  /**
   * Cell — or footprint — the pawn must stay beside. Work stops if they end up
   * somewhere else, including *on* the structure.
   *
   * Takes the world for the same reason `toilReserveEntity`'s `pick` does: some targets
   * are named by id and have to be looked up. `null` means the target is gone, which is
   * a failure rather than a licence to work next to nothing.
   */
  readonly besides?: (job: Job, world: World) => TilePos | readonly TilePos[] | null;
  /**
   * Whether work may advance right now.
   *
   * Distinct from `stillValid`: returning false here **waits**, it does not fail. Used
   * for conditions that are temporary and will clear on their own — a colonist standing
   * where a wall is about to go up should delay the wall, not cancel it.
   */
  readonly canProgress?: (ctx: ToilContext) => boolean;
}): Toil {
  return {
    name: 'work',
    tick: (ctx) => {
      if (!options.stillValid(ctx)) return 'failed';
      if (options.canProgress && !options.canProgress(ctx)) return 'running';

      // Belt and braces against a pawn drifting off its target mid-job. Cheap, and the
      // alternative is mining a rock from across the map with no visible cause.
      if (options.besides) {
        const beside = options.besides(ctx.job, ctx.world);
        if (!beside) return 'failed';
        const cells = Array.isArray(beside) ? (beside as readonly TilePos[]) : [beside as TilePos];
        if (!isAdjacentToFootprint(ctx.pawn.pos, cells)) return 'failed';
      }

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

/**
 * Hands the carried stack over to something that wants it.
 *
 * `accept` returns how much was taken. Anything left over is put down where the pawn
 * stands rather than destroyed — a colonist who carried ten stone to a wall that only
 * needed five should be holding five, not have lost them.
 */
export function toilDeposit(accept: (ctx: ToilContext, item: Item) => number): Toil {
  return {
    name: 'deposit',
    tick: (ctx) => {
      const { world, pawn } = ctx;
      if (pawn.carryingItemId === null) return 'failed';

      const item = world.items.get(pawn.carryingItemId);
      if (!item) {
        pawn.carryingItemId = null;
        return 'failed';
      }

      const taken = accept(ctx, item);
      item.count -= taken;
      pawn.carryingItemId = null;

      if (item.count > 0) world.items.placeAt(item, world.map, pawn.pos);
      else world.items.remove(item.id, world.map);

      return 'done';
    },
  };
}

/** Clears any stale route when a toil sequence begins. */
export function resetMovement(pawn: Pawn): void {
  clearPath(pawn);
}
