/**
 * How each kind of job is carried out, as a sequence of toils.
 *
 * Drivers are pure data — a lookup from job kind to a toil list — which is what lets a
 * pawn's entire progress through a job be stored as an index. Adding a job kind means
 * adding an entry here and, ideally, no new toils at all.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { buildableDef, deconstructWork } from '../defs/buildables';
import { recipeDef } from '../defs/recipes';
import { plantDef } from '../defs/plants';
import { terrainDef } from '../defs/terrain';
import { Thought, type ThoughtId } from '../defs/thoughts';
import { buildingCells, hasIngredientsFor } from '../entities/building';
import { hasAllMaterials, outstanding, siteCells } from '../entities/constructionSite';
import { outstandingOf } from '../entities/materials';
import { isRipe } from '../entities/plant';
import type { Pawn } from '../entities/pawn';
import { builtHere, completeConstruction, deconstruct } from '../world/construction';
import { Designation } from '../world/designations';
import { buildingAt, countHeld, pawnOccupies } from '../world/lookup';
import type { World } from '../world/world';
import type { Job, JobKind } from './job';
import { addThought } from './mood';
import { consumeFood } from './needs';
import {
  toilDropCarried,
  toilPickUp,
  toilReserveCell,
  toilReserveEntity,
  toilDeposit,
  toilReserveItem,
  toilClaimBed,
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

function asDeliver(job: Job) {
  if (job.kind !== 'deliver') throw new Error(`Expected a deliver job, got ${job.kind}`);
  return job;
}

function asConstruct(job: Job) {
  if (job.kind !== 'construct') throw new Error(`Expected a construct job, got ${job.kind}`);
  return job;
}

function asDeconstruct(job: Job) {
  if (job.kind !== 'deconstruct') throw new Error(`Expected a deconstruct job, got ${job.kind}`);
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
      world.reachability.markDirtyAt(index);

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
      if (item) consumeFood(ctx.world, ctx.pawn, item);
    },
  }),
];

const SLEEP_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asSleep(job).bed,
    (ctx, id) => ctx.world.buildings.get(id) !== undefined,
  ),
  toilWalkTo((job) => asSleep(job).spot),
  // After the walk, so a colonist who never arrives never claims anything.
  toilClaimBed((job) => asSleep(job).bed),
  toilSleep({
    // Not a full bar: waking at 90% means colonists get up and do something rather
    // than lying in until the last percent trickles in.
    wakeAt: 0.9,
    onWake: (ctx) => {
      addThought(ctx.pawn, sleptWhere(ctx.world, ctx.pawn, asSleep(ctx.job).bed));
      // A roof is worth something on its own, so this stacks with the bed thought
      // rather than replacing it.
      if (ctx.world.rooms.isIndoors(ctx.pawn.pos)) addThought(ctx.pawn, Thought.SleptIndoors);
    },
  }),
];

/**
 * Which of the three sleeping memories this night earned.
 *
 * A ladder, not a stack: the ground, shared bedding, and a bed of your own. Read off the
 * bed's `owner` rather than off anything the job remembers, so a colonist who lost their
 * claim while asleep — the bed deconstructed under them, say — wakes up with the honest
 * thought rather than one recorded hours earlier.
 */
function sleptWhere(world: World, pawn: Pawn, bedId: EntityId | null): ThoughtId {
  if (bedId === null) return Thought.SleptOnGround;

  // Deconstructed out from under them while they slept, which the sleep job survives —
  // it is `toilSleep` waiting on a need, not on the building. They did finish the night on
  // the floor, so that is the memory they get.
  const bed = world.buildings.get(bedId);
  if (!bed) return Thought.SleptOnGround;

  return bed.owner === pawn.id ? Thought.SleptInOwnBed : Thought.SleptInBed;
}

const WANDER_TOILS: readonly Toil[] = [toilWalkTo((job) => asWander(job).to)];

/**
 * Carrying materials to a blueprint.
 *
 * The site is reserved for the duration, which serialises deliveries to one site at a
 * time. Without it two colonists both fetch the last five stone and one load is wasted;
 * with it they simply pick different sites.
 */
const DELIVER_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asDeliver(job).site,
    (ctx, id) => ctx.world.sites.get(id) !== undefined,
  ),
  toilReserveItem((job) => asDeliver(job).item),
  toilWalkTo((job, world) => world.items.get(asDeliver(job).item)?.pos ?? null),
  toilPickUp((job) => asDeliver(job).item),
  // Delivered from *beside* the site, not standing on it. A colonist who parks on a
  // planned wall to drop stone can be sealed inside it the moment someone else finishes
  // the job — and an entombed pawn can reach nothing, ever again.
  toilWalkAdjacentTo((job, world) => {
    const site = world.sites.get(asDeliver(job).site);
    return site ? siteCells(site) : null;
  }),
  toilDeposit((ctx, item) => {
    const site = ctx.world.sites.get(asDeliver(ctx.job).site);
    if (!site) return 0;

    const wanted = outstanding(site, item.def);
    const taken = Math.min(wanted, item.count);
    site.delivered[item.def] += taken;
    return taken;
  }),
];

const CONSTRUCT_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asConstruct(job).site,
    (ctx, id) => ctx.world.sites.get(id) !== undefined,
  ),
  // Built from beside it, not on top of it: a colonist standing where a wall completes
  // would end up sealed inside their own masonry.
  toilWalkAdjacentTo((job, world) => {
    const site = world.sites.get(asConstruct(job).site);
    return site ? siteCells(site) : null;
  }),
  toilWork({
    workNeeded: (ctx) => {
      const site = ctx.world.sites.get(asConstruct(ctx.job).site);
      return site ? buildableDef(site.def).work : 0;
    },
    stillValid: (ctx) => {
      const site = ctx.world.sites.get(asConstruct(ctx.job).site);
      // Cancelled, finished by someone else, or the materials were taken back.
      return site !== undefined && hasAllMaterials(site);
    },

    /*
     * Wait rather than wall someone in. Anyone standing on the footprint will move on;
     * sealing them inside would leave a colonist who can reach nothing, ever again.
     *
     * **Every cell of it**, which this asked of the anchor alone until M13 — see
     * `finishSite`, which had the same hole. A 2×2 table finished over a colonist standing
     * on any of its other three cells is the case that makes it ordinary.
     */
    canProgress: (ctx) => {
      const site = ctx.world.sites.get(asConstruct(ctx.job).site);
      if (!site) return true;
      return !siteCells(site).some((cell) =>
        pawnOccupies(ctx.world, ctx.world.map.idx(cell.x, cell.y, cell.z)),
      );
    },
    complete: (ctx) => {
      const site = ctx.world.sites.get(asConstruct(ctx.job).site);
      if (site) completeConstruction(ctx.world, site);
    },
  }),
];

function deconstructTargetIndex(ctx: ToilContext): number {
  const cell = asDeconstruct(ctx.job).cell;
  return ctx.world.map.idx(cell.x, cell.y, cell.z);
}

/**
 * The cells the demolition job is really about.
 *
 * A deconstruct job names one cell, because that is what the player marked. When a
 * building stands there the job is about the *whole* building — falling back to the bare
 * cell covers a floor, which has no building and is genuinely one cell.
 */
function deconstructCells(job: Job, world: World): TilePos[] {
  const cell = asDeconstruct(job).cell;
  const building = buildingAt(world, world.map.idx(cell.x, cell.y, cell.z));
  return building ? buildingCells(building) : [cell];
}

/**
 * Taking a finished structure back down.
 *
 * Needs no `canProgress` guard, unlike its opposite number: deconstruction only ever
 * *adds* passability. A wall's cell opens up, and a floor reverts to the ground beneath
 * it — which was walkable, or the floor could never have been placed there. So nobody
 * can be sealed in by this, which is the one failure severe enough that CONSTRUCT_TOILS
 * has to wait for it.
 */
const DECONSTRUCT_TOILS: readonly Toil[] = [
  toilReserveCell((job) => asDeconstruct(job).cell),
  // Claims the structure itself as well as its cell. Those are different keys, and a
  // colonist asleep in a bed holds the *entity* — without this, someone could dismantle
  // the bed out from under them.
  toilReserveEntity(
    (job, world) => {
      const cell = asDeconstruct(job).cell;
      return buildingAt(world, world.map.idx(cell.x, cell.y, cell.z))?.id ?? null;
    },
    (ctx, id) => ctx.world.buildings.get(id) !== undefined,
  ),
  // The marked cell names the *structure*, so the pawn stands beside all of it. Beside
  // the marked cell alone would be satisfied by another cell of the same 2x2 hearth.
  toilWalkAdjacentTo((job, world) => deconstructCells(job, world)),
  toilWork({
    besides: (job, world) => deconstructCells(job, world),
    workNeeded: (ctx) => {
      const buildable = builtHere(ctx.world, deconstructTargetIndex(ctx));
      return buildable === undefined ? 0 : deconstructWork(buildable);
    },

    // Re-checked every tick: another colonist may have finished the demolition, or the
    // player may have cleared the mark while this one was walking over.
    stillValid: (ctx) => {
      const index = deconstructTargetIndex(ctx);
      if (!ctx.world.designations.has(Designation.Deconstruct, index)) return false;
      return builtHere(ctx.world, index) !== undefined;
    },

    complete: (ctx) => {
      deconstruct(ctx.world, deconstructTargetIndex(ctx));
    },
  }),
];

function asStockBench(job: Job) {
  if (job.kind !== 'stockBench') throw new Error(`Expected a stockBench job, got ${job.kind}`);
  return job;
}

function asCraft(job: Job) {
  if (job.kind !== 'craft') throw new Error(`Expected a craft job, got ${job.kind}`);
  return job;
}

/**
 * Carrying one ingredient stack to a bench.
 *
 * Deliberately does **not** reserve the bench. Several cooks stocking the same fire at
 * once is the behaviour we want — a kitchen cooperating — and claiming the bench to load
 * it would serialise them for no reason. Only the crafting is exclusive.
 */
const STOCK_BENCH_TOILS: readonly Toil[] = [
  toilReserveItem((job) => asStockBench(job).item),
  toilWalkTo((job, world) => world.items.get(asStockBench(job).item)?.pos ?? null),
  toilPickUp((job) => asStockBench(job).item),
  // Loaded from beside the bench: a campfire's own cell is impassable, so there is
  // nowhere to stand on it in the first place.
  toilWalkAdjacentTo((job, world) => {
    const bench = world.buildings.get(asStockBench(job).bench);
    return bench ? buildingCells(bench) : null;
  }),
  toilDeposit((ctx, item) => {
    const bench = ctx.world.buildings.get(asStockBench(ctx.job).bench);
    if (!bench) return 0;

    // Whatever any of its bills still wants. Asking per-bill would let a second bill's
    // shortfall go unfilled while the colonist stood there holding exactly it.
    let wanted = 0;
    for (const bill of bench.bills) {
      wanted = Math.max(wanted, outstandingOf(bench.loaded, recipeDef(bill.recipe).ingredients, item.def));
    }

    const taken = Math.min(wanted, item.count);
    bench.loaded[item.def] += taken;
    return taken;
  }),
];

/** Working a bench whose bill already has everything it needs. */
const CRAFT_TOILS: readonly Toil[] = [
  toilReserveEntity(
    (job) => asCraft(job).bench,
    (ctx, id) => ctx.world.buildings.get(id) !== undefined,
  ),
  toilWalkAdjacentTo((job, world) => {
    const bench = world.buildings.get(asCraft(job).bench);
    return bench ? buildingCells(bench) : null;
  }),
  toilWork({
    besides: (job, world) => {
      const bench = world.buildings.get(asCraft(job).bench);
      return bench ? buildingCells(bench) : null;
    },
    workNeeded: (ctx) => recipeDef(asCraft(ctx.job).recipe).work,

    // Re-checked every tick: the player may have deleted the bill, another cook may have
    // met the quota, or the ingredients may have gone into a different bill entirely.
    stillValid: (ctx) => {
      const job = asCraft(ctx.job);
      const bench = ctx.world.buildings.get(job.bench);
      if (!bench) return false;
      const bill = bench.bills.find((b) => b.recipe === job.recipe);
      if (!bill) return false;
      if (!hasIngredientsFor(bench, bill)) return false;
      return countHeld(ctx.world, recipeDef(job.recipe).product.def) < bill.untilCount;
    },

    complete: (ctx) => {
      const job = asCraft(ctx.job);
      const bench = ctx.world.buildings.get(job.bench);
      if (!bench) return;

      const recipe = recipeDef(job.recipe);
      for (const ingredient of recipe.ingredients) {
        bench.loaded[ingredient.def] -= ingredient.count;
      }

      // Spawned at the bench, which spills to a storable neighbour because the bench's
      // own cell is blocked. Nothing is ever placed *on* the fire.
      ctx.world.items.spawn(ctx.world.map, recipe.product.def, recipe.product.count, bench.pos);
    },
  }),
];

const DRIVERS: Record<JobKind, readonly Toil[]> = {
  mine: MINE_TOILS,
  haul: HAUL_TOILS,
  harvest: HARVEST_TOILS,
  eat: EAT_TOILS,
  sleep: SLEEP_TOILS,
  wander: WANDER_TOILS,
  deliver: DELIVER_TOILS,
  construct: CONSTRUCT_TOILS,
  deconstruct: DECONSTRUCT_TOILS,
  stockBench: STOCK_BENCH_TOILS,
  craft: CRAFT_TOILS,
};

export function driverFor(kind: JobKind): readonly Toil[] {
  return DRIVERS[kind];
}
