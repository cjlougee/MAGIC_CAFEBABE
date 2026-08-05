/**
 * The read-only view of the simulation that UI renders from.
 *
 * React must never read World directly, and must never re-render at 60fps. The app
 * loop publishes a snapshot roughly ten times a second; components subscribe to that.
 * Anything the UI needs goes here as plain, already-computed data — a snapshot should
 * be cheap to build and impossible to mutate the sim through.
 *
 * The *renderer* is different: it reads World directly every frame, because
 * interpolating a pawn's walk at 10Hz would look like a slideshow. Both are read-only;
 * only the cadence differs.
 */

import { isOnGround } from './entities/item';
import { pawnActivity } from './entities/pawn';
import { ITEM_DEFS, type ItemDefId } from './defs/items';
import { Designation } from './world/designations';
import { daylight, formatTime, timeOfDay } from './world/time';
import type { World } from './world/world';

export interface PawnSummary {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Display label only — nothing should branch on this string. */
  readonly activity: string;
  /** Indexed by WorkTypeId. */
  readonly priorities: readonly number[];
  readonly carrying: string | null;
}

export interface ResourceSummary {
  readonly def: ItemDefId;
  readonly name: string;
  /** Total on the ground, colony-wide. Carried stacks are counted too. */
  readonly count: number;
}

export interface SimSnapshot {
  readonly tick: number;
  readonly seed: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly clock: string;
  readonly daylight: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly pawns: readonly PawnSummary[];
  readonly resources: readonly ResourceSummary[];
  readonly mineDesignations: number;
  readonly stockpileCells: number;
}

export function buildSnapshot(world: World): SimSnapshot {
  const time = timeOfDay(world.tick);

  const totals = new Array<number>(ITEM_DEFS.length).fill(0);
  for (const item of world.items.values()) {
    totals[item.def] += item.count;
  }

  const pawns: PawnSummary[] = [];
  for (const pawn of world.pawns.values()) {
    const carried = pawn.carryingItemId === null ? null : world.items.get(pawn.carryingItemId);
    pawns.push({
      id: pawn.id,
      name: pawn.name,
      x: pawn.pos.x,
      y: pawn.pos.y,
      z: pawn.pos.z,
      activity: pawnActivity(pawn),
      priorities: [...pawn.priorities],
      carrying: carried ? `${ITEM_DEFS[carried.def].name} x${carried.count}` : null,
    });
  }

  return {
    tick: world.tick,
    seed: world.seed,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    clock: formatTime(time),
    daylight: daylight(world.tick),
    mapWidth: world.map.width,
    mapHeight: world.map.height,
    pawns,
    resources: ITEM_DEFS.map((def) => ({
      def: def.id,
      name: def.name,
      count: totals[def.id],
    })),
    mineDesignations: world.designations.count(Designation.Mine),
    stockpileCells: world.zones.stockpileCount,
  };
}

/** Total of a resource lying loose outside any stockpile. Used by tests. */
export function looseItemCount(world: World): number {
  let loose = 0;
  for (const item of world.items.values()) {
    if (!isOnGround(item) || !item.pos) continue;
    const index = world.map.idx(item.pos.x, item.pos.y, item.pos.z);
    if (!world.zones.isStockpile(index)) loose += item.count;
  }
  return loose;
}
