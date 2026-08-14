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
import { bedOwner } from './ai/needs';
import { isWorkbench, missingIngredientsFor } from './entities/building';
import { recipeDef, recipesFor, type RecipeId } from './defs/recipes';
import { countHeld } from './world/lookup';
import { buildAlerts, type Alert } from './alerts';
import { sizeOf } from './world/footprint';
import { canDesignateDeconstruct } from './world/placement';
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
  /** Under direct command, and therefore doing no work at all. */
  readonly drafted: boolean;
  /** True for the one colonist the player is. */
  readonly playerCharacter: boolean;
  /** Ordered somewhere they cannot get to — the loud half of a silent failure. */
  readonly orderUnreachable: boolean;
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

/**
 * A placed structure, as the panel needs to describe it.
 *
 * One per building, published every snapshot. That is a few hundred small objects at
 * 10Hz on a built-up colony — cheaper than the render layer, which walks the same list
 * every *frame* — and it keeps selection on the UI side of the wall where it belongs.
 * The panel finds its structure by id rather than the simulation being told what is
 * selected.
 */
export interface StructureSummary {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Cells it stands on, so the panel can say "2x1" without knowing the projection. */
  readonly width: number;
  readonly height: number;
  /** False for anything the colony did not put up — a bedroll came with the party. */
  readonly canDeconstruct: boolean;
  readonly markedForDeconstruct: boolean;
  /** Null when this is not something that can be barred. */
  readonly locked: boolean | null;
  /** True when a bill panel should appear beneath this one. */
  readonly isBench: boolean;
  /**
   * Who this belongs to, or null for unclaimed — and **absent entirely** for anything that
   * cannot be owned.
   *
   * Three states rather than two, because "nobody has claimed this bed yet" and "a wall
   * cannot be claimed" are different facts and the panel has to say different things about
   * them. Already-resolved to a name here: `sim/` knows who owns what, and a UI that had to
   * look a colonist up by id would be a second index over the pawn store.
   */
  readonly owner?: { readonly name: string | null };
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
  /** Every placed structure, for the panel that describes the selected one. */
  readonly structures: readonly StructureSummary[];
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

/**
 * Every building, worded.
 *
 * `canDeconstruct` asks the same question the deconstruct *tool* asks, through the same
 * predicate, so the panel's ✕ can never offer something a drag over the same cell would
 * refuse.
 */
function structureSummaries(world: World): StructureSummary[] {
  const structures: StructureSummary[] = [];

  for (const building of world.buildings.values()) {
    const def = buildingDef(building.def);
    const index = world.map.idx(building.pos.x, building.pos.y, building.pos.z);
    const { w, h } = sizeOf(def.footprint, building.rotation);

    structures.push({
      id: building.id,
      name: def.name,
      x: building.pos.x,
      y: building.pos.y,
      width: w,
      height: h,
      canDeconstruct: canDesignateDeconstruct(world, index),
      markedForDeconstruct: world.designations.has(Designation.Deconstruct, index),
      locked: def.lockable ? building.locked : null,
      isBench: isWorkbench(building),
      // Through `bedOwner`, so a claim held by a colonist who has died reads as unclaimed
      // here exactly as it does to the colonist looking for somewhere to sleep.
      ...(def.ownable
        ? { owner: { name: world.pawns.get(bedOwner(world, building) ?? -1)?.name ?? null } }
        : {}),
    });
  }

  return structures;
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
      drafted: pawn.drafted,
      playerCharacter: pawn.playerCharacter,
      orderUnreachable:
        pawn.draftTarget !== null && !world.reachability.canReach(pawn.pos, pawn.draftTarget),
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
    structures: structureSummaries(world),
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
