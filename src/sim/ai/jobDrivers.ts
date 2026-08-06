/**
 * How each kind of job is carried out, as a sequence of toils.
 *
 * Drivers are pure data — a lookup from job kind to a toil list — which is what lets a
 * pawn's entire progress through a job be stored as an index. Adding a job kind means
 * adding an entry here and, ideally, no new toils at all.
 */

import type { TilePos } from '../core/position';
import { NUTRITION_PER_RAW_FOOD } from '../defs/needs';
import { plantDef } from '../defs/plants';
import { terrainDef } from '../defs/terrain';
import { Thought } from '../defs/thoughts';
import { isRipe } from '../entities/plant';
import { Designation } from '../world/designations';
import type { Job, JobKind } from './job';
import { addThought } from './mood';
import { consumeFood } from './needs';
import {
  toilDropCarried,
  toilPickUp,
  toilReserveCell,
  toilReserveEntity,
  toilReserveItem,
  toilSleep,
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

function asHarvest(job: Job) {
  if (job.kind !== 'harvest') throw new Error(`Expected a harvest job, got ${job.kind}`);
  return job;
}

function asEat(job: Job) {
  if (job.kind !== 'eat') throw new Error(`Expected an eat job, got ${job.kind}`);
  return job;
}

function asSleep(job: Job) {
  if (job.kind !== 'sleep') throw new Error(`Expected a sleep job, got ${job.kind}`);
  return job;
}

function asWander(job: Job) {
  if (job.kind !== 'wander') throw new Error(`Expected a wander job, got ${job.kind}`);
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

/** Composed entirely from existing toils — the pipeline paying off. */
const HARVEST_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asHarvest(job).plant,
    (ctx, id) => ctx.world.plants.get(id) !== undefined,
  ),
  toilWalkAdjacentTo((job, world) => {
    const plant = world.plants.get(asHarvest(job).plant);
    return plant ? plant.pos : null;
  }),
  toilWork({
    workNeeded: (ctx) => {
      const plant = ctx.world.plants.get(asHarvest(ctx.job).plant);
      return plant ? plantDef(plant.def).harvestWork : 0;
    },
    // Another colonist may have stripped it, or it may have been picked before it ripened.
    stillValid: (ctx) => {
      const plant = ctx.world.plants.get(asHarvest(ctx.job).plant);
      return plant !== undefined && isRipe(plant);
    },
    complete: (ctx) => {
      const plant = ctx.world.plants.get(asHarvest(ctx.job).plant);
      if (!plant) return;
      const def = plantDef(plant.def);
      ctx.world.items.spawn(ctx.world.map, def.yield.def, def.yield.count, plant.pos);
      // Stripped, not destroyed — the bush regrows, which is what makes food a loop.
      plant.growth = 0;
    },
  }),
];

const EAT_TOILS: readonly Toil[] = [
  toilReserveItem((job) => asEat(job).item),
  toilWalkTo((job, world) => world.items.get(asEat(job).item)?.pos ?? null),
  toilWork({
    workNeeded: () => 90,
    stillValid: (ctx) => ctx.world.items.get(asEat(ctx.job).item) !== undefined,
    complete: (ctx) => {
      const item = ctx.world.items.get(asEat(ctx.job).item);
      if (item) consumeFood(ctx.world, ctx.pawn, item, NUTRITION_PER_RAW_FOOD);
    },
  }),
];

const SLEEP_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asSleep(job).bed,
    (ctx, id) => ctx.world.buildings.get(id) !== undefined,
  ),
  toilWalkTo((job) => asSleep(job).spot),
  toilSleep({
    // Not a full bar: waking at 90% means colonists get up and do something rather
    // than lying in until the last percent trickles in.
    wakeAt: 0.9,
    onWake: (ctx) => {
      addThought(ctx.pawn, asSleep(ctx.job).bed === null ? Thought.SleptOnGround : Thought.SleptInBed);
    },
  }),
];

const WANDER_TOILS: readonly Toil[] = [toilWalkTo((job) => asWander(job).to)];

const DRIVERS: Record<JobKind, readonly Toil[]> = {
  mine: MINE_TOILS,
  haul: HAUL_TOILS,
  harvest: HARVEST_TOILS,
  eat: EAT_TOILS,
  sleep: SLEEP_TOILS,
  wander: WANDER_TOILS,
};

export function driverFor(kind: JobKind): readonly Toil[] {
  return DRIVERS[kind];
}
