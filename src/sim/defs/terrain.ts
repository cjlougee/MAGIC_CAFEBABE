/**
 * Terrain definitions.
 *
 * Content lives in TypeScript rather than XML/JSON so we get autocomplete,
 * refactorability, and compile errors on typos. Colours are deliberately absent —
 * they belong to render/art/palette.ts, because sim/ knows nothing about looks.
 */

import { IMPASSABLE } from '../core/constants';
import { ItemDef, type ItemDefId } from './items';

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
  StoneFloor: 9,
  Carpet: 10,
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
  /**
   * Whether goods may rest here.
   *
   * Deliberately *not* the same as passable. Water is the one terrain a colonist can
   * enter but must not use — you can wade a ford, you cannot leave a crate in it. Every
   * other terrain answers both questions the same way, which is exactly why conflating
   * them went unnoticed until a stockpile appeared in a river.
   */
  readonly storable: boolean;
  /** Ticks of work to clear this cell. Zero means it cannot be mined. */
  readonly mineWork: number;
  /** What clearing it drops, and what it leaves behind. */
  readonly mineYield: { readonly def: ItemDefId; readonly count: number } | null;
  /** Terrain left in place once mined out. */
  readonly minedInto: TerrainId | null;
}

/**
 * Indexed by TerrainId — array position must equal `id` (asserted in tests/world.test.ts).
 *
 * Walk costs are written as integer literals rather than `BASE_MOVE_COST * 1.1`, because
 * that multiplication does not land on an integer in floating point and TileMap.walkCost
 * is a Uint8Array. Relative to BASE_MOVE_COST (10): open ground is 10, rough ground is
 * slightly worse, wading is punishing, relic plating is the fastest surface in the game.
 */
const NOT_MINEABLE = { mineWork: 0, mineYield: null, minedInto: null } as const;

export const TERRAIN_DEFS: readonly TerrainDef[] = [
  // Water: deep is a hard barrier, shallow is a slow ford. Neither holds goods.
  // See docs/decisions/0004-water.md.
  { id: Terrain.DeepWater, name: 'Deep Water', walkCost: IMPASSABLE, variants: 4, solid: false, storable: false, ...NOT_MINEABLE },
  { id: Terrain.ShallowWater, name: 'Shallow Water', walkCost: 22, variants: 4, solid: false, storable: false, ...NOT_MINEABLE },
  // Ground terrains carry more variants because they cover the most area, and that is
  // where tile repetition becomes visible as a grid.
  { id: Terrain.Sand, name: 'Sand', walkCost: 12, variants: 6, solid: false, storable: true, ...NOT_MINEABLE },
  { id: Terrain.Dirt, name: 'Dirt', walkCost: 10, variants: 6, solid: false, storable: true, ...NOT_MINEABLE },
  { id: Terrain.Grass, name: 'Grass', walkCost: 10, variants: 6, solid: false, storable: true, ...NOT_MINEABLE },
  { id: Terrain.Gravel, name: 'Gravel', walkCost: 11, variants: 6, solid: false, storable: true, ...NOT_MINEABLE },
  {
    id: Terrain.Rock,
    name: 'Rock',
    walkCost: IMPASSABLE,
    variants: 6,
    solid: true,
    storable: false,
    mineWork: 480,
    mineYield: { def: ItemDef.Stone, count: 20 },
    minedInto: Terrain.Gravel,
  },
  { id: Terrain.RuinFloor, name: 'Relic Plating', walkCost: 9, variants: 5, solid: false, storable: true, ...NOT_MINEABLE },
  {
    id: Terrain.RuinWall,
    name: 'Relic Bulkhead',
    walkCost: IMPASSABLE,
    variants: 5,
    solid: true,
    storable: false,
    // Slower than rock and worth less bulk, but scrap is the first rung of the ladder
    // that leads somewhere rock never does.
    mineWork: 700,
    mineYield: { def: ItemDef.Scrap, count: 12 },
    minedInto: Terrain.RuinFloor,
  },
  // Player-laid paving. Slightly faster than open ground — the first thing built for
  // convenience rather than survival.
  { id: Terrain.StoneFloor, name: 'Stone Floor', walkCost: 9, variants: 4, solid: false, storable: true, ...NOT_MINEABLE },
  // A woven covering, and the first terrain laid for how it looks rather than what it
  // does. No faster than paving — a rug is not a road — and storable, because a room with
  // a carpet in it is exactly where a colonist will want to put things down.
  { id: Terrain.Carpet, name: 'Carpet', walkCost: 10, variants: 4, solid: false, storable: true, ...NOT_MINEABLE },
];

export function isMineable(id: TerrainId): boolean {
  return TERRAIN_DEFS[id].mineWork > 0;
}

export function isStorable(id: TerrainId): boolean {
  return TERRAIN_DEFS[id].storable;
}

export function terrainDef(id: TerrainId): TerrainDef {
  return TERRAIN_DEFS[id];
}
