/**
 * Seeded terrain generation.
 *
 * Six noise fields decide every cell, in two tiers.
 *
 * **Regional**, sampled at a very long wavelength: warmth and damp cross to pick a
 * biome, and a wreckage field decides how thickly the fallen civilization built here.
 * These are what make one part of the map feel unlike another.
 *
 * **Local**, unchanged from the small-map version: elevation carves water and stone,
 * moisture picks between the biome's dry/mid/lush grounds, and a ruins field scatters
 * plating and bulkheads. These are what make ground look natural close up.
 *
 * The split exists because scale exposed the difference. At 128² one set of thresholds
 * for the whole map reads as texture; at 512² it reads as static, because sixteen times
 * more map with the same statistics is just more of the same. See ADR 0007 and
 * `defs/biomes.ts`.
 *
 * The ruins field is still the setting made visible — relic plating and bulkheads are
 * there from tick zero, so the world reads as *inherited* rather than empty.
 */

import { biomeDef, pickBiome, type BiomeId } from '../defs/biomes';
import { Terrain, type TerrainId } from '../defs/terrain';
import { makeNoise2D } from './noise';
import { TileMap } from './tilemap';

/** Tuning knobs, gathered so terrain feel is adjustable in one place. */
const GEN = {
  /**
   * Wavelengths, longest first. These are **absolute**, not relative to map size,
   * because the things they describe have physical sizes: a mountain range is a range
   * whatever the map is, and a bulkhead is about ten tiles across either way.
   *
   * Elevation and moisture were 1/26 and 1/19, tuned when the map was 128 tiles and a
   * 26-tile feature spanned a fifth of it. At 512 that same number is a twentieth, and
   * the result was a map that was *mottled* rather than regional — rock speckled
   * uniformly everywhere instead of gathering into ranges you route around. Biomes alone
   * did not fix it, because biomes only shift where the bands fall; the bands themselves
   * were still switching every twenty tiles.
   *
   * Ordering matters and is the whole design: biome patches are larger than mountain
   * ranges, which are larger than damp patches, which are larger than ruins. So a range
   * sits *inside* a region and a ruin sits *on* a hillside, rather than each carving up
   * the other.
   */
  warmthScale: 1 / 150,
  dampScale: 1 / 120,
  wreckageScale: 1 / 100,
  elevationScale: 1 / 70,
  moistureScale: 1 / 40,
  ruinScale: 1 / 11,

  deepWaterBelow: 0.32,
  shallowWaterBelow: 0.375,
  gravelAbove: 0.6,
  rockAbove: 0.66,

  sandBelow: 0.4,
  grassAbove: 0.56,

  ruinFloorAbove: 0.7,
  ruinWallAbove: 0.79,

  /**
   * How far the wreckage field moves the ruin thresholds.
   *
   * At full swing a dense region drops them to 0.55/0.64 and a clean one raises them to
   * 0.85/0.94 — the difference between walking through a dead city and crossing empty
   * country that happens to have a bulkhead in it. Uniform scatter made every part of
   * the map equally interesting, which is the same as none of it being interesting.
   */
  wreckageSwing: 0.3,
} as const;

function pickBaseTerrain(biome: BiomeId, elevation: number, moisture: number): TerrainId {
  const def = biomeDef(biome);

  // Both waterline thresholds move together, so a wetter region grows its ponds rather
  // than turning its shallows into deeps.
  if (elevation < GEN.deepWaterBelow + def.waterShift) return Terrain.DeepWater;
  if (elevation < GEN.shallowWaterBelow + def.waterShift) return Terrain.ShallowWater;

  if (elevation > GEN.rockAbove + def.reliefShift) return Terrain.Rock;
  if (elevation > GEN.gravelAbove + def.reliefShift) return Terrain.Gravel;

  if (moisture < GEN.sandBelow) return def.dryGround;
  if (moisture > GEN.grassAbove) return def.lushGround;
  return def.midGround;
}

export function generateMap(width: number, height: number, seed: number): TileMap {
  const map = new TileMap(width, height);

  // Offsetting the seed per field keeps the fields uncorrelated. Without it every field
  // would peak in the same places and the map would have one big feature in it.
  const elevationNoise = makeNoise2D(seed);
  const moistureNoise = makeNoise2D(seed ^ 0x5bf03635);
  const ruinNoise = makeNoise2D(seed ^ 0x27d4eb2f);
  const warmthNoise = makeNoise2D(seed ^ 0x165667b1);
  const dampNoise = makeNoise2D(seed ^ 0x7feb352d);
  const wreckageNoise = makeNoise2D(seed ^ 0x846ca68b);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const warmth = warmthNoise(x * GEN.warmthScale, y * GEN.warmthScale, 2);
      const damp = dampNoise(x * GEN.dampScale, y * GEN.dampScale, 2);
      const biome = pickBiome(warmth, damp);

      const elevation = elevationNoise(x * GEN.elevationScale, y * GEN.elevationScale, 5);
      const moisture = moistureNoise(x * GEN.moistureScale, y * GEN.moistureScale, 3);

      let terrain = pickBaseTerrain(biome, elevation, moisture);

      // Ruins overlay dry land only — wreckage sitting in open water would read as
      // an accident rather than a structure.
      if (terrain !== Terrain.DeepWater && terrain !== Terrain.ShallowWater) {
        const wreckage = wreckageNoise(x * GEN.wreckageScale, y * GEN.wreckageScale, 2);
        // Above the midpoint the thresholds come down and wreckage thickens; below, it
        // thins out to nothing.
        const bias = (0.5 - wreckage) * GEN.wreckageSwing;

        const ruin = ruinNoise(x * GEN.ruinScale, y * GEN.ruinScale, 3);
        if (ruin > GEN.ruinWallAbove + bias) terrain = Terrain.RuinWall;
        else if (ruin > GEN.ruinFloorAbove + bias) terrain = Terrain.RuinFloor;
      }

      map.setTerrainAt(map.idx(x, y), terrain);
    }
  }

  return map;
}
