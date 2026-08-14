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

/** Append-only: these ids are written into every save. */
export const Buildable = {
  Wall: 0,
  Door: 1,
  Floor: 2,
  Campfire: 3,
  Bed: 4,
  Hearth: 5,
  // ── M13 ───────────────────────────────────────────────────────────────────
  Stool: 6,
  Chair: 7,
  Table: 8,
  Desk: 9,
  Shelf: 10,
  Crate: 11,
  Safe: 12,
  Torch: 13,
  Lamp: 14,
  Floodlight: 15,
  Banner: 16,
  Carpet: 17,
} as const;

export type BuildableId = (typeof Buildable)[keyof typeof Buildable];

/**
 * How the architect menu is divided.
 *
 * **Not saved, and deliberately strings rather than an append-only numeric table.** Every
 * other id in this file is written into colonies on disk and may never be renumbered;
 * a category is a heading in a menu, so tying it to that discipline would be borrowing a
 * constraint for nothing. Regrouping the menu should cost one word.
 */
export type BuildCategory = 'structure' | 'floors' | 'furniture' | 'production' | 'light' | 'decor';

/** Display order of the category strip, and the label on each tab. */
export const BUILD_CATEGORIES: readonly { readonly id: BuildCategory; readonly label: string }[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'floors', label: 'Floors' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'production', label: 'Production' },
  { id: 'light', label: 'Light' },
  { id: 'decor', label: 'Decor' },
];

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
  /** Which tab of the architect menu this appears under. */
  readonly category: BuildCategory;
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
    category: 'structure',
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
    category: 'structure',
  },
  {
    id: Buildable.Floor,
    name: 'Floor',
    description: 'Smooth stone paving. Faster to walk on.',
    cost: [{ def: ItemDef.Stone, count: 2 }],
    work: 120,
    result: { kind: 'terrain', terrain: Terrain.StoneFloor },
    category: 'floors',
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
    category: 'production',
  },
  {
    id: Buildable.Bed,
    name: 'Bed',
    description: 'Two cells long. Sleeping here beats a bedroll.',
    // Scrap and stone: a frame salvaged from the wreckage, which is what this colony
    // makes anything decent out of.
    cost: [
      { def: ItemDef.Scrap, count: 8 },
      { def: ItemDef.Stone, count: 4 },
    ],
    work: 400,
    result: { kind: 'building', building: Building.Bed },
    category: 'furniture',
  },
  {
    id: Buildable.Hearth,
    name: 'Hearth',
    description: 'A walled fire, two by two. Cooks the same meals and lights further.',
    cost: [{ def: ItemDef.Stone, count: 24 }],
    work: 520,
    result: { kind: 'building', building: Building.Hearth },
    category: 'production',
  },

  /*
   * ── M13: contents ─────────────────────────────────────────────────────────
   *
   * Priced almost entirely in **scrap**, and that is the setting rather than a shortcut.
   * The colony has two materials — stone out of rock, scrap out of the fallen
   * civilization's bulkheads — and furniture is the first thing you make out of wreckage
   * because you want to rather than because you must. Stone appears where a piece needs a
   * base or a weight.
   *
   * There is no timber item, so nothing here costs wood even where the art draws salvaged
   * planks. Trees arrive in M15 with the flora pass; inventing a resource here to justify
   * a texture would be the tail wagging the dog.
   */
  {
    id: Buildable.Stool,
    name: 'Stool',
    description: 'Somewhere to sit. Walk onto it.',
    cost: [{ def: ItemDef.Scrap, count: 3 }],
    work: 140,
    result: { kind: 'building', building: Building.Stool },
    category: 'furniture',
  },
  {
    id: Buildable.Chair,
    name: 'Chair',
    description: 'A stool with a back. Faces the way you turn it.',
    cost: [{ def: ItemDef.Scrap, count: 6 }],
    work: 200,
    result: { kind: 'building', building: Building.Chair },
    category: 'furniture',
  },
  {
    id: Buildable.Table,
    name: 'Table',
    description: 'Two cells square. Stand around it.',
    cost: [
      { def: ItemDef.Scrap, count: 10 },
      { def: ItemDef.Stone, count: 4 },
    ],
    work: 340,
    result: { kind: 'building', building: Building.Table },
    category: 'furniture',
  },
  {
    id: Buildable.Desk,
    name: 'Desk',
    description: 'Salvaged plate, cut square. Two cells long.',
    cost: [
      { def: ItemDef.Scrap, count: 12 },
      { def: ItemDef.Stone, count: 6 },
    ],
    work: 380,
    result: { kind: 'building', building: Building.Desk },
    category: 'furniture',
  },
  {
    id: Buildable.Shelf,
    name: 'Shelf',
    description: 'Two cells of shelving, shoulder high.',
    cost: [{ def: ItemDef.Scrap, count: 8 }],
    work: 260,
    result: { kind: 'building', building: Building.Shelf },
    category: 'furniture',
  },
  {
    id: Buildable.Crate,
    name: 'Supply Crate',
    description: 'A lashed bundle of supplies.',
    cost: [{ def: ItemDef.Scrap, count: 5 }],
    work: 160,
    result: { kind: 'building', building: Building.Crate },
    category: 'furniture',
  },
  {
    id: Buildable.Safe,
    name: 'Safe',
    description: 'Refined plate with a relic lock. Heavy.',
    cost: [
      { def: ItemDef.Scrap, count: 16 },
      { def: ItemDef.Stone, count: 8 },
    ],
    work: 520,
    result: { kind: 'building', building: Building.Safe },
    category: 'furniture',
  },
  {
    id: Buildable.Torch,
    name: 'Torch',
    description: 'A burning brand on a post. Cheap light.',
    cost: [
      { def: ItemDef.Scrap, count: 3 },
      { def: ItemDef.Stone, count: 2 },
    ],
    work: 120,
    result: { kind: 'building', building: Building.Torch },
    category: 'light',
  },
  {
    id: Buildable.Lamp,
    name: 'Lamp',
    description: 'Salvaged relic tech, still running. Lights a room.',
    cost: [
      { def: ItemDef.Scrap, count: 10 },
      { def: ItemDef.Stone, count: 4 },
    ],
    work: 300,
    result: { kind: 'building', building: Building.Lamp },
    category: 'light',
  },
  {
    id: Buildable.Floodlight,
    name: 'Floodlight',
    description: 'Lights a yard, not a room. Expensive.',
    cost: [
      { def: ItemDef.Scrap, count: 20 },
      { def: ItemDef.Stone, count: 6 },
    ],
    work: 560,
    result: { kind: 'building', building: Building.Floodlight },
    category: 'light',
  },
  {
    id: Buildable.Banner,
    name: 'Banner',
    description: 'Cloth on a pole. Does nothing, and is the point.',
    cost: [{ def: ItemDef.Scrap, count: 4 }],
    work: 180,
    result: { kind: 'building', building: Building.Banner },
    category: 'decor',
  },
  {
    id: Buildable.Carpet,
    name: 'Carpet',
    description: 'Woven floor covering. Softer underfoot than stone.',
    cost: [{ def: ItemDef.Scrap, count: 3 }],
    work: 90,
    result: { kind: 'terrain', terrain: Terrain.Carpet },
    category: 'floors',
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
