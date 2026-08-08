/**
 * Biomes — what kind of country a region is.
 *
 * A biome does not decide a cell's terrain. It **parameterises** the decision that was
 * already there: which ground the local moisture field resolves to, how much relief the
 * elevation field produces, and where the waterline sits. Local variation is what makes
 * ground look natural at arm's length, and it is worth keeping — the problem at 512² was
 * never that terrain lacked detail, it was that every part of the map had the *same*
 * detail. One noise field decided sand-or-grass identically from corner to corner, so a
 * map sixteen times larger read as sixteen times more of the same static.
 *
 * So biomes are regional character laid over unchanged local texture. See ADR 0007.
 *
 * **A biome is worldgen-time only and is never stored.** It is a pure function of the
 * seed and the position, so saving it would be saving derived state — and a stored copy
 * could disagree with the terrain it produced with nothing able to say which was right.
 * Terrain is the durable record; the biome is how it got chosen.
 */

import { Terrain, type TerrainId } from './terrain';

export const Biome = {
  Saltflats: 0,
  Steppe: 1,
  Badlands: 2,
  Fen: 3,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export interface BiomeDef {
  readonly id: BiomeId;
  readonly name: string;

  /** Ground where the local moisture field reads dry, middling, and lush. */
  readonly dryGround: TerrainId;
  readonly midGround: TerrainId;
  readonly lushGround: TerrainId;

  /**
   * Added to the gravel and rock elevation thresholds.
   *
   * Negative means the bands start lower, so more of the region comes out as raised
   * stone. Relief is the strongest signal at a distance, because rock is the only
   * terrain that occupies vertical space — a rocky region has a *skyline*.
   */
  readonly reliefShift: number;

  /** Added to both waterline thresholds. Positive drowns more of the region. */
  readonly waterShift: number;
}

/** Indexed by BiomeId — array position must equal `id`. */
export const BIOME_DEFS: readonly BiomeDef[] = [
  // Pale and open. Sand almost everywhere, little standing water, and flat enough that
  // you can see a long way — which is what makes a ruin on the horizon read as a
  // destination rather than as scenery.
  {
    id: Biome.Saltflats,
    name: 'Saltflats',
    dryGround: Terrain.Sand,
    midGround: Terrain.Sand,
    lushGround: Terrain.Dirt,
    reliefShift: 0.05,
    waterShift: -0.05,
  },
  // The default country and the friendliest: dirt and grass, ordinary relief. Berry
  // bushes only grow on grass, so this is where a colony wants to be.
  {
    id: Biome.Steppe,
    name: 'Steppe',
    dryGround: Terrain.Sand,
    midGround: Terrain.Dirt,
    lushGround: Terrain.Grass,
    reliefShift: 0,
    waterShift: -0.01,
  },
  // Broken stone. The rockiest biome by a wide margin, which makes it the one worth
  // mining and the one most likely to wall a route off entirely.
  {
    id: Biome.Badlands,
    name: 'Badlands',
    dryGround: Terrain.Gravel,
    midGround: Terrain.Gravel,
    lushGround: Terrain.Dirt,
    reliefShift: -0.09,
    waterShift: -0.05,
  },
  // Wet and green and slow to cross. Shallow water is passable but not storable, so a
  // fen is generous with food and hostile to putting anything down.
  {
    id: Biome.Fen,
    name: 'Fen',
    dryGround: Terrain.Dirt,
    midGround: Terrain.Grass,
    lushGround: Terrain.Grass,
    reliefShift: 0.07,
    waterShift: 0.055,
  },
];

export function biomeDef(id: BiomeId): BiomeDef {
  return BIOME_DEFS[id];
}

/**
 * Which biome a warmth/damp pair lands in.
 *
 * Two independent fields rather than one quantised field, because banding a single
 * field produces stripes — biomes in bands across the map, which reads as a gradient
 * someone applied rather than as country. Crossing two fields gives patches that
 * interlock.
 */
export function pickBiome(warmth: number, damp: number): BiomeId {
  if (warmth < 0.5) return damp < 0.5 ? Biome.Badlands : Biome.Fen;
  return damp < 0.5 ? Biome.Saltflats : Biome.Steppe;
}
