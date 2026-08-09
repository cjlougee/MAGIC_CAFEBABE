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

import { activeThoughts, moodOf } from './ai/mood';
import { isWorkbench, missingIngredientsFor } from './entities/building';
import { recipeDef, recipesFor, type RecipeId } from './defs/recipes';
import { countHeld } from './world/lookup';
import { buildAlerts, type Alert } from './alerts';
import { buildingDef } from './defs/buildings';
import { NEED_DEFS } from './defs/needs';
import { thoughtDef } from './defs/thoughts';
import { isOnGround } from './entities/item';
import { pawnActivity } from './entities/pawn';
import { isRipe } from './entities/plant';
import { ITEM_DEFS, type ItemDefId } from './defs/items';
import { poiDef } from './defs/pois';
import { Designation } from './world/designations';
import { daylight, formatTime, timeOfDay } from './world/time';
import type { World } from './world/world';

export interface NeedSummary {
  readonly label: string;
  /** 0–1. */
  readonly value: number;
  readonly low: boolean;
}

export interface ThoughtSummary {
  readonly label: string;
  readonly mood: number;
}

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
  readonly needs: readonly NeedSummary[];
  readonly mood: number;
  /** Every reason for the mood, so the UI can explain it rather than just show it. */
  readonly thoughts: readonly ThoughtSummary[];
  readonly health: number;
  readonly dead: boolean;
}

export interface ResourceSummary {
  readonly def: ItemDefId;
  readonly name: string;
  /** Total on the ground, colony-wide. Carried stacks are counted too. */
  readonly count: number;
}

export interface BillSummary {
  readonly recipe: RecipeId;
  readonly name: string;
  /** What the colony should end up with. The player's number. */
  readonly untilCount: number;
  /** How many exist right now, so the panel can say *why* the bench is idle. */
  readonly held: number;
  /** Ingredients still to be fetched, already worded for display. */
  readonly waitingFor: readonly string[];
}

export interface BenchSummary {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly bills: readonly BillSummary[];
  /** Recipes this bench could make that have no bill yet. */
  readonly available: readonly { readonly recipe: RecipeId; readonly name: string }[];
}

export interface PoiSummary {
  readonly id: number;
  /** The generated name — "Kessler Relay", not "listening post". */
  readonly name: string;
  /** What kind of place it is, already worded. */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Tiles from the landing site, so the UI can say how far a trip would be. */
  readonly distance: number;
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
  readonly alerts: readonly Alert[];
  readonly ripePlants: number;
  /** Genuinely enclosed rooms — the ones the player built. */
  readonly rooms: number;
  readonly constructionSites: number;
  /** Every workbench, with its standing orders. Small — there are never many. */
  readonly benches: readonly BenchSummary[];
  /** Named places, for the minimap and the places list. Never more than a handful. */
  readonly pois: readonly PoiSummary[];
  readonly landingSite: { readonly x: number; readonly y: number };
}

/**
 * Workbenches and their bills, already worded.
 *
 * `held` and `waitingFor` are computed here rather than in the component, so the panel
 * can explain an idle bench — "10 of 10" reads very differently from "waiting for Raw
 * Food", and a UI that can only show the bill leaves the player guessing which it is.
 */
function benchSummaries(world: World): BenchSummary[] {
  const benches: BenchSummary[] = [];

  for (const building of world.buildings.values()) {
    if (!isWorkbench(building)) continue;

    benches.push({
      id: building.id,
      name: buildingDef(building.def).name,
      x: building.pos.x,
      y: building.pos.y,
      bills: building.bills.map((bill) => {
        const recipe = recipeDef(bill.recipe);
        return {
          recipe: bill.recipe,
          name: recipe.name,
          untilCount: bill.untilCount,
          held: countHeld(world, recipe.product.def),
          waitingFor: missingIngredientsFor(building, bill).map((def) => ITEM_DEFS[def].name),
        };
      }),
      available: recipesFor(building.def)
        .filter((recipe) => !building.bills.some((bill) => bill.recipe === recipe.id))
        .map((recipe) => ({ recipe: recipe.id, name: recipe.name })),
    });
  }

  return benches;
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
      needs: NEED_DEFS.map((def) => ({
        label: def.label,
        value: pawn.needs[def.id],
        low: pawn.needs[def.id] < def.seekBelow,
      })),
      mood: moodOf(pawn),
      thoughts: activeThoughts(pawn).map((id) => ({
        label: thoughtDef(id).label,
        mood: thoughtDef(id).mood,
      })),
      health: pawn.health,
      dead: pawn.dead,
    });
  }

  let ripePlants = 0;
  for (const plant of world.plants.values()) {
    if (isRipe(plant)) ripePlants++;
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
    alerts: buildAlerts(world),
    ripePlants,
    rooms: world.rooms.enclosedCount,
    constructionSites: world.sites.size,
    benches: benchSummaries(world),
    pois: [...world.pois.values()].map((poi) => ({
      id: poi.id,
      name: poi.name,
      kind: poiDef(poi.def).kind,
      x: poi.pos.x,
      y: poi.pos.y,
      radius: poi.radius,
      distance: Math.round(
        Math.hypot(poi.pos.x - world.landingSite.x, poi.pos.y - world.landingSite.y),
      ),
    })),
    landingSite: { x: world.landingSite.x, y: world.landingSite.y },
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
