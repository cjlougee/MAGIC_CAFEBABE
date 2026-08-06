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
];

export function buildableDef(id: BuildableId): BuildableDef {
  return BUILDABLE_DEFS[id];
}
