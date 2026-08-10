/**
 * Finding work.
 *
 * A WorkGiver scans the world for something worth doing and returns a Job, or null. It
 * is the only place that decides *which* rock or *which* item — the driver then just
 * executes.
 *
 * Every giver must reject targets that are reserved, unreachable, or no longer valid
 * **before** returning a job. A giver that hands back impossible work produces a pawn
 * that starts a job, fails it, and immediately picks the same one again.
 */

import type { TilePos } from '../core/position';
import type { WorkTypeId } from '../defs/workTypes';
import { WorkType } from '../defs/workTypes';
import {
  hasAllMaterials,
  missingMaterials,
  type ConstructionSite,
} from '../entities/constructionSite';
import { isEdible } from '../defs/items';
import { recipeDef } from '../defs/recipes';
import { hasIngredientsFor, missingIngredientsFor } from '../entities/building';
import { isOnGround, type Item } from '../entities/item';
import type { Pawn } from '../entities/pawn';
import { isRipe, type Plant } from '../entities/plant';
import { builtHere } from '../world/construction';
import { Designation } from '../world/designations';
import { buildingCells } from '../entities/building';
import { siteCells } from '../entities/constructionSite';
import { buildingAt, countHeld } from '../world/lookup';
import type { World } from '../world/world';
import type { Job } from './job';
import { bestAdjacentCell, bestCellBeside } from './toils';

export interface WorkGiver {
  readonly id: string;
  readonly workType: WorkTypeId;
  readonly tryGiveJob: (world: World, pawn: Pawn) => Job | null;
}

function cellOf(world: World, index: number): TilePos {
  return { x: world.map.xOf(index), y: world.map.yOf(index), z: world.map.zOf(index) };
}

/** Manhattan distance is enough to rank candidates; exact cost comes from A* later. */
function roughDistance(a: TilePos, b: TilePos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const MineGiver: WorkGiver = {
  id: 'mine',
  workType: WorkType.Mine,

  tryGiveJob(world, pawn) {
    let best: TilePos | null = null;
    let bestDistance = Infinity;

    for (const index of world.designations.cells(Designation.Mine)) {
      if (!world.reservations.canReserveCell(index, pawn.id)) continue;

      // The designation may outlive the rock — someone else may already have cleared it.
      const cell = cellOf(world, index);
      if (world.map.walkCost[index] !== 0) continue;

      const distance = roughDistance(pawn.pos, cell);
      if (distance >= bestDistance) continue;

      // Reachability last: it is the most expensive check, so only pay it for a
      // candidate that would actually win.
      if (!bestAdjacentCell(world, cell, pawn.pos)) continue;

      bestDistance = distance;
      best = cell;
    }

    return best ? { kind: 'mine', cell: best } : null;
  },
};

/** Nearest stockpile cell with room for `item` that nobody else has claimed. */
function findStockpileCell(world: World, pawn: Pawn, item: Item): TilePos | null {
  if (!item.pos) return null;

  let best: TilePos | null = null;
  let bestDistance = Infinity;

  for (const index of world.zones.stockpiles) {
    if (!world.reservations.canReserveCell(index, pawn.id)) continue;
    if (world.items.capacityAt(index, item.def) <= 0) continue;

    const cell = cellOf(world, index);
    const distance = roughDistance(item.pos, cell);
    if (distance >= bestDistance) continue;
    if (!world.reachability.canReach(item.pos, cell)) continue;

    bestDistance = distance;
    best = cell;
  }

  return best;
}

const HaulGiver: WorkGiver = {
  id: 'haul',
  workType: WorkType.Haul,

  tryGiveJob(world, pawn) {
    let bestItem: Item | null = null;
    let bestDistance = Infinity;

    for (const item of world.items.values()) {
      if (!isOnGround(item) || !item.pos) continue;
      if (!world.reservations.canReserveEntity(item.id, pawn.id)) continue;

      // Already where it belongs.
      const index = world.map.idx(item.pos.x, item.pos.y, item.pos.z);
      if (world.zones.isStockpile(index)) continue;

      const distance = roughDistance(pawn.pos, item.pos);
      if (distance >= bestDistance) continue;
      if (!world.reachability.canReach(pawn.pos, item.pos)) continue;

      bestDistance = distance;
      bestItem = item;
    }

    if (!bestItem) return null;

    // No room anywhere means this is not a job, however close the item is.
    const destination = findStockpileCell(world, pawn, bestItem);
    if (!destination) return null;

    return { kind: 'haul', item: bestItem.id, to: destination };
  },
};

/**
 * Days of food the colony aims to keep on hand.
 *
 * Berry bushes regrow forever, so without a stopping rule colonists harvest for eternity
 * and never mine or build a thing — the whole rest of the game silently never happens.
 * A larder target is also just better behaviour: nobody strips every bush on the map
 * when the stores are full.
 */
const FOOD_BUFFER_DAYS = 3;

/** Roughly what one colonist eats in a day, in units of raw food. */
const FOOD_PER_COLONIST_DAY = 8;

function colonyHasEnoughFood(world: World): boolean {
  let living = 0;
  for (const pawn of world.pawns.values()) {
    if (!pawn.dead) living++;
  }
  if (living === 0) return true;

  let stored = 0;
  for (const item of world.items.values()) {
    if (isOnGround(item) && isEdible(item.def)) stored += item.count;
  }

  return stored >= living * FOOD_PER_COLONIST_DAY * FOOD_BUFFER_DAYS;
}

const HarvestGiver: WorkGiver = {
  id: 'harvest',
  workType: WorkType.Harvest,

  tryGiveJob(world, pawn) {
    // Stores are full; leave the bushes and go do something else.
    if (colonyHasEnoughFood(world)) return null;

    let best: Plant | null = null;
    let bestDistance = Infinity;

    for (const plant of world.plants.values()) {
      if (!isRipe(plant)) continue;
      if (!world.reservations.canReserveEntity(plant.id, pawn.id)) continue;

      const distance = roughDistance(pawn.pos, plant.pos);
      if (distance >= bestDistance) continue;

      // Reachability last: the most expensive check, so only pay it for a candidate
      // that would actually win.
      if (!bestAdjacentCell(world, plant.pos, pawn.pos)) continue;

      bestDistance = distance;
      best = plant;
    }

    return best ? { kind: 'harvest', plant: best.id } : null;
  },
};

const ConstructGiver: WorkGiver = {
  id: 'construct',
  workType: WorkType.Construct,

  tryGiveJob(world, pawn) {
    let best: ConstructionSite | null = null;
    let bestDistance = Infinity;

    for (const site of world.sites.values()) {
      // Nothing to build until the materials are all here — that half is Haul's job.
      if (!hasAllMaterials(site)) continue;
      if (!world.reservations.canReserveEntity(site.id, pawn.id)) continue;

      const distance = roughDistance(pawn.pos, site.pos);
      if (distance >= bestDistance) continue;
      if (!bestCellBeside(world, siteCells(site), pawn.pos)) continue;

      bestDistance = distance;
      best = site;
    }

    return best ? { kind: 'construct', site: best.id } : null;
  },
};

/**
 * Taking down what the colony put up.
 *
 * A second giver under **Construct**: the player schedules "who builds things", and
 * unbuilding is that same skill. Listed after ConstructGiver so a colony with both
 * queued finishes what it started before tearing anything down — a half-built wall left
 * standing while colonists demolish elsewhere looks like the orders were ignored.
 */
const DeconstructGiver: WorkGiver = {
  id: 'deconstruct',
  workType: WorkType.Construct,

  tryGiveJob(world, pawn) {
    let best: TilePos | null = null;
    let bestDistance = Infinity;

    for (const index of world.designations.cells(Designation.Deconstruct)) {
      if (!world.reservations.canReserveCell(index, pawn.id)) continue;

      // The designation may outlive the structure — someone else may have taken it down
      // already, or an unfinished site may have been erased out from under the mark.
      if (builtHere(world, index) === undefined) continue;

      const building = buildingAt(world, index);
      if (building && !world.reservations.canReserveEntity(building.id, pawn.id)) continue;

      const cell = cellOf(world, index);
      const distance = roughDistance(pawn.pos, cell);
      if (distance >= bestDistance) continue;

      // Reachability last: the most expensive check, so only pay it for a candidate
      // that would actually win. Beside the whole structure, matching the driver — a
      // giver that judged by the marked cell alone would hand out jobs the driver then
      // failed, or skip ones it could have done.
      if (!bestCellBeside(world, building ? buildingCells(building) : [cell], pawn.pos)) continue;

      bestDistance = distance;
      best = cell;
    }

    return best ? { kind: 'deconstruct', cell: best } : null;
  },
};

/**
 * Materials to blueprints.
 *
 * A second giver under **Haul**, not a work type of its own: the player schedules "who
 * carries things", and this is carrying things. Listed before the stockpile giver so
 * building sites are supplied before loose stone gets tidied away.
 */
const DeliverGiver: WorkGiver = {
  id: 'deliver',
  workType: WorkType.Haul,

  tryGiveJob(world, pawn) {
    for (const site of world.sites.values()) {
      if (hasAllMaterials(site)) continue;
      if (!world.reservations.canReserveEntity(site.id, pawn.id)) continue;

      const wanted = missingMaterials(site);
      let best: Item | null = null;
      let bestDistance = Infinity;

      for (const item of world.items.values()) {
        if (!isOnGround(item) || !item.pos) continue;
        if (!wanted.includes(item.def)) continue;
        if (!world.reservations.canReserveEntity(item.id, pawn.id)) continue;

        const distance = roughDistance(pawn.pos, item.pos);
        if (distance >= bestDistance) continue;
        if (!world.reachability.canReach(pawn.pos, item.pos)) continue;

        bestDistance = distance;
        best = item;
      }

      // A site the colonist can't reach or supply isn't work; try the next one.
      if (!best) continue;
      if (!world.reachability.canReach(pawn.pos, site.pos)) continue;

      return { kind: 'deliver', site: site.id, item: best.id };
    }

    return null;
  },
};

/** Consulted in this order within a priority band, so order here is a tiebreak. */
/**
 * Working the benches: fetching what a bill needs, then making it.
 *
 * One giver returning two kinds of job, because "what should a cook do next" has one
 * answer and splitting it across two givers would mean two places that could disagree
 * about whether a bench is ready.
 *
 * **Stocking does not reserve the bench; crafting does.** That asymmetry is the point:
 * several cooks should be able to carry ingredients to the same fire at once — a kitchen
 * cooperating — while only one may consume them and produce the result. Reserving the
 * bench to stock it would serialise the fetching and make a second cook useless.
 */
const CookGiver: WorkGiver = {
  id: 'cook',
  workType: WorkType.Cook,

  tryGiveJob(world, pawn) {
    for (const bench of world.buildings.values()) {
      if (bench.bills.length === 0) continue;

      for (const bill of bench.bills) {
        const recipe = recipeDef(bill.recipe);
        // Suspended by arithmetic: no flag to keep in step with how much exists.
        if (countHeld(world, recipe.product.def) >= bill.untilCount) continue;

        if (hasIngredientsFor(bench, bill)) {
          // Only the crafting is exclusive.
          if (!world.reservations.canReserveEntity(bench.id, pawn.id)) continue;
          if (!bestCellBeside(world, buildingCells(bench), pawn.pos)) continue;
          return { kind: 'craft', bench: bench.id, recipe: bill.recipe };
        }

        const wanted = missingIngredientsFor(bench, bill);
        let best: Item | null = null;
        let bestDistance = Infinity;

        for (const item of world.items.values()) {
          if (!isOnGround(item) || !item.pos) continue;
          if (!wanted.includes(item.def)) continue;
          if (!world.reservations.canReserveEntity(item.id, pawn.id)) continue;

          const distance = roughDistance(pawn.pos, item.pos);
          if (distance >= bestDistance) continue;
          if (!world.reachability.canReach(pawn.pos, item.pos)) continue;

          bestDistance = distance;
          best = item;
        }

        if (!best) continue;
        if (!bestCellBeside(world, buildingCells(bench), pawn.pos)) continue;

        return { kind: 'stockBench', bench: bench.id, item: best.id };
      }
    }

    return null;
  },
};

export const WORK_GIVERS: readonly WorkGiver[] = [
  HarvestGiver,
  CookGiver,
  ConstructGiver,
  DeconstructGiver,
  DeliverGiver,
  MineGiver,
  HaulGiver,
];
