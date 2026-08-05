/**
 * How each kind of job is carried out, as a sequence of toils.
 *
 * Drivers are pure data — a lookup from job kind to a toil list — which is what lets a
 * pawn's entire progress through a job be stored as an index. Adding a job kind means
 * adding an entry here and, ideally, no new toils at all.
 */

import type { TilePos } from '../core/position';
import { terrainDef } from '../defs/terrain';
import { Designation } from '../world/designations';
import type { Job, JobKind } from './job';
import {
  toilDropCarried,
  toilPickUp,
  toilReserveCell,
  toilReserveItem,
  toilWalkAdjacentTo,
  toilWalkTo,
  toilWork,
  type Toil,
  type ToilContext,
} from './toils';

// Narrowing helpers. A driver is only ever invoked for its own job kind, so a mismatch
// is a wiring bug and should be loud rather than silently reading undefined.
function asMine(job: Job) {
  if (job.kind !== 'mine') throw new Error(`Expected a mine job, got ${job.kind}`);
  return job;
}

function asHaul(job: Job) {
  if (job.kind !== 'haul') throw new Error(`Expected a haul job, got ${job.kind}`);
  return job;
}

function mineTargetIndex(ctx: ToilContext): number {
  const cell = asMine(ctx.job).cell;
  return ctx.world.map.idx(cell.x, cell.y, cell.z);
}

const MINE_TOILS: readonly Toil[] = [
  toilReserveCell((job) => asMine(job).cell),
  toilWalkAdjacentTo((job) => asMine(job).cell),
  toilWork({
    besides: (job) => asMine(job).cell,
    workNeeded: (ctx) => terrainDef(ctx.world.map.terrainAt(mineTargetIndex(ctx))).mineWork,

    // Re-checked every tick: another colonist may have finished this cell, or the
    // player may have cancelled the designation while the pawn was walking over.
    stillValid: (ctx) => {
      const index = mineTargetIndex(ctx);
      if (!ctx.world.designations.has(Designation.Mine, index)) return false;
      return terrainDef(ctx.world.map.terrainAt(index)).mineWork > 0;
    },

    complete: (ctx) => {
      const { world } = ctx;
      const cell = asMine(ctx.job).cell;
      const index = mineTargetIndex(ctx);
      const def = terrainDef(world.map.terrainAt(index));

      if (def.minedInto !== null) world.map.setTerrainAt(index, def.minedInto);
      world.designations.remove(Designation.Mine, index);

      // The cell just became walkable, so every cached answer about what connects to
      // what is now wrong. Forgetting this is how pawns end up unable to reach ground
      // they are standing next to.
      world.reachability.markDirty();

      if (def.mineYield) {
        world.items.spawn(world.map, def.mineYield.def, def.mineYield.count, cell);
      }
    },
  }),
];

/** Where the item currently is — null once it has been picked up or destroyed. */
function haulItemPosition(job: Job, world: ToilContext['world']): TilePos | null {
  const item = world.items.get(asHaul(job).item);
  return item?.pos ?? null;
}

const HAUL_TOILS: readonly Toil[] = [
  toilReserveItem((job) => asHaul(job).item),
  toilReserveCell((job) => asHaul(job).to),
  toilWalkTo((job, world) => haulItemPosition(job, world)),
  toilPickUp((job) => asHaul(job).item),
  toilWalkTo((job) => asHaul(job).to),
  toilDropCarried(),
];

const DRIVERS: Record<JobKind, readonly Toil[]> = {
  mine: MINE_TOILS,
  haul: HAUL_TOILS,
};

export function driverFor(kind: JobKind): readonly Toil[] {
  return DRIVERS[kind];
}
