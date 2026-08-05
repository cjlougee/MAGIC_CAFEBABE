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
import { isOnGround, type Item } from '../entities/item';
import type { Pawn } from '../entities/pawn';
import { Designation } from '../world/designations';
import type { World } from '../world/world';
import type { Job } from './job';
import { bestAdjacentCell } from './toils';

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
      if (!world.reservations.canReserveItem(item.id, pawn.id)) continue;

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

/** Consulted in this order within a priority band, so order here is a tiebreak. */
export const WORK_GIVERS: readonly WorkGiver[] = [MineGiver, HaulGiver];
