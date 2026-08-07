/**
 * What the player can order built.
 *
 * One list covering two different outcomes: some blueprints become **buildings**
 * (walls, doors — things that sit on a cell), others become **terrain** (floors — the
 * cell itself changes). The architect menu iterates this list and the construction
 * pipeline switches on `result` exactly once, so adding either kind is a single entry
 * rather than a parallel system.
 */

import { Building, type BuildingId } from './buildings';
import { ItemDef, type ItemDefId } from './items';
import { Terrain, type TerrainId } from './terrain';

export const Buildable = {
  Wall: 0,
  Door: 1,
  Floor: 2,
  Campfire: 3,
} as const;

export type BuildableId = (typeof Buildable)[keyof typeof Buildable];

export interface MaterialCost {
  readonly def: ItemDefId;
  readonly count: number;
}

export type BuildResult =
  | { readonly kind: 'building'; readonly building: BuildingId }
  | { readonly kind: 'terrain'; readonly terrain: TerrainId };

export interface BuildableDef {
  readonly id: BuildableId;
  readonly name: string;
  readonly description: string;
  readonly cost: readonly MaterialCost[];
  /** Ticks of construction work once every material has arrived. */
  readonly work: number;
  readonly result: BuildResult;
}

/** Indexed by BuildableId — array position must equal `id`. */
export const BUILDABLE_DEFS: readonly BuildableDef[] = [
  {
    id: Buildable.Wall,
    name: 'Wall',
    description: 'Encloses a room. Blocks movement.',
    cost: [{ def: ItemDef.Stone, count: 5 }],
    work: 260,
    result: { kind: 'building', building: Building.Wall },
  },
  {
    id: Buildable.Door,
    name: 'Door',
    description: 'A way in that still seals the room.',
    // Scrap rather than stone: the first thing the player builds out of the fallen
    // civilization's remains, and a small nudge toward mining ruins.
    cost: [{ def: ItemDef.Scrap, count: 6 }],
    work: 320,
    result: { kind: 'building', building: Building.Door },
  },
  {
    id: Buildable.Floor,
    name: 'Floor',
    description: 'Smooth stone paving. Faster to walk on.',
    cost: [{ def: ItemDef.Stone, count: 2 }],
    work: 120,
    result: { kind: 'terrain', terrain: Terrain.StoneFloor },
  },
  {
    id: Buildable.Campfire,
    name: 'Campfire',
    description: 'Cook meals here. Gives light.',
    // Cheap and stone-only on purpose: the first bench should be affordable on day one,
    // from the resource the player already has, or cooking arrives too late to matter.
    cost: [{ def: ItemDef.Stone, count: 8 }],
    work: 180,
    result: { kind: 'building', building: Building.Campfire },
  },
];

export function buildableDef(id: BuildableId): BuildableDef {
  return BUILDABLE_DEFS[id];
}

// ── Taking it back down ─────────────────────────────────────────────────────────
//
// Deconstruction reads the *same* cost list construction paid, rather than declaring a
// separate yield on the building. One number, one place: a wall's price and its salvage
// cannot drift apart when the price changes.

/** Fraction of the original materials salvaged. Half — demolition is not free. */
export const DECONSTRUCT_REFUND = 0.5;

/** Fraction of the build effort it takes to undo. Pulling down beats putting up. */
const DECONSTRUCT_WORK_FRACTION = 0.5;

/**
 * What a finished structure gives back, rounded down.
 *
 * A one-stone building refunds nothing, and that is correct: rounding *up* would let a
 * player build and deconstruct in a loop to manufacture materials out of labour.
 */
export function refundFor(id: BuildableId): readonly MaterialCost[] {
  return buildableDef(id)
    .cost.map((cost) => ({ def: cost.def, count: Math.floor(cost.count * DECONSTRUCT_REFUND) }))
    .filter((cost) => cost.count > 0);
}

/** Ticks of work to take one down. Never zero, or it would finish the tick it started. */
export function deconstructWork(id: BuildableId): number {
  return Math.max(1, Math.round(buildableDef(id).work * DECONSTRUCT_WORK_FRACTION));
}

// Reverse indices, built once. A structure knows what it is; it does not know which
// blueprint produced it, and asking every buildable on every scan would be a linear
// search inside a loop that already walks the map.
const BY_BUILDING = new Map<BuildingId, BuildableId>();
const BY_TERRAIN = new Map<TerrainId, BuildableId>();

for (const def of BUILDABLE_DEFS) {
  if (def.result.kind === 'building') BY_BUILDING.set(def.result.building, def.id);
  else BY_TERRAIN.set(def.result.terrain, def.id);
}

/**
 * The blueprint that produces this building, if any.
 *
 * `undefined` means nobody built it — bedrolls arrive with the landing party — and that
 * is what makes "you may only take down what the colony put up" a one-line rule.
 */
export function buildableProducing(building: BuildingId): BuildableId | undefined {
  return BY_BUILDING.get(building);
}

/** The blueprint that produces this terrain, if any. Floors; bridges later. */
export function buildableProducingTerrain(terrain: TerrainId): BuildableId | undefined {
  return BY_TERRAIN.get(terrain);
}
