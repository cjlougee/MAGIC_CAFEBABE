/**
 * Terrain definitions.
 *
 * Content lives in TypeScript rather than XML/JSON so we get autocomplete,
 * refactorability, and compile errors on typos. Colours are deliberately absent —
 * they belong to render/art/palette.ts, because sim/ knows nothing about looks.
 */

import { IMPASSABLE } from '../core/constants';

export const Terrain = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Dirt: 3,
  Grass: 4,
  Gravel: 5,
  Rock: 6,
  RuinFloor: 7,
  RuinWall: 8,
} as const;

export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

export interface TerrainDef {
  readonly id: TerrainId;
  readonly name: string;
  /** Ticks-cost multiplier basis; IMPASSABLE (0) means the tile cannot be entered. */
  readonly walkCost: number;
  /** How many procedurally-generated art variants exist for this terrain. */
  readonly variants: number;
  /** True for terrain that must be mined or deconstructed rather than walked around. */
  readonly solid: boolean;
}

/**
 * Indexed by TerrainId — array position must equal `id` (asserted in tests/world.test.ts).
 *
 * Walk costs are written as integer literals rather than `BASE_MOVE_COST * 1.1`, because
 * that multiplication does not land on an integer in floating point and TileMap.walkCost
 * is a Uint8Array. Relative to BASE_MOVE_COST (10): open ground is 10, rough ground is
 * slightly worse, wading is punishing, relic plating is the fastest surface in the game.
 */
export const TERRAIN_DEFS: readonly TerrainDef[] = [
  { id: Terrain.DeepWater, name: 'Deep Water', walkCost: IMPASSABLE, variants: 4, solid: false },
  { id: Terrain.ShallowWater, name: 'Shallow Water', walkCost: 22, variants: 4, solid: false },
  // Ground terrains carry more variants because they cover the most area, and that is
  // where tile repetition becomes visible as a grid.
  { id: Terrain.Sand, name: 'Sand', walkCost: 12, variants: 6, solid: false },
  { id: Terrain.Dirt, name: 'Dirt', walkCost: 10, variants: 6, solid: false },
  { id: Terrain.Grass, name: 'Grass', walkCost: 10, variants: 6, solid: false },
  { id: Terrain.Gravel, name: 'Gravel', walkCost: 11, variants: 6, solid: false },
  { id: Terrain.Rock, name: 'Rock', walkCost: IMPASSABLE, variants: 6, solid: true },
  { id: Terrain.RuinFloor, name: 'Relic Plating', walkCost: 9, variants: 5, solid: false },
  { id: Terrain.RuinWall, name: 'Relic Bulkhead', walkCost: IMPASSABLE, variants: 5, solid: true },
];

export function terrainDef(id: TerrainId): TerrainDef {
  return TERRAIN_DEFS[id];
}
