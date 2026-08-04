/**
 * Seeded terrain generation.
 *
 * Three independent noise fields decide every cell: elevation carves mountains and
 * water, moisture picks between sand/dirt/grass, and a ruins field scatters the
 * wreckage of the fallen civilization across the surface. The ruins field is the
 * setting made visible — relic plating and bulkheads are visible from tick zero, so
 * the world reads as *inherited* rather than empty.
 */

import { Terrain, type TerrainId } from '../defs/terrain';
import { makeNoise2D } from './noise';
import { TileMap } from './tilemap';

/** Tuning knobs, gathered so terrain feel is adjustable in one place. */
const GEN = {
  elevationScale: 1 / 26,
  moistureScale: 1 / 19,
  ruinScale: 1 / 11,

  deepWaterBelow: 0.32,
  shallowWaterBelow: 0.375,
  gravelAbove: 0.6,
  rockAbove: 0.66,

  sandBelow: 0.4,
  grassAbove: 0.56,

  ruinFloorAbove: 0.7,
  ruinWallAbove: 0.79,
} as const;

function pickBaseTerrain(elevation: number, moisture: number): TerrainId {
  if (elevation < GEN.deepWaterBelow) return Terrain.DeepWater;
  if (elevation < GEN.shallowWaterBelow) return Terrain.ShallowWater;
  if (elevation > GEN.rockAbove) return Terrain.Rock;
  if (elevation > GEN.gravelAbove) return Terrain.Gravel;

  if (moisture < GEN.sandBelow) return Terrain.Sand;
  if (moisture > GEN.grassAbove) return Terrain.Grass;
  return Terrain.Dirt;
}

export function generateMap(width: number, height: number, seed: number): TileMap {
  const map = new TileMap(width, height);

  // Offsetting the seed per field keeps elevation, moisture, and ruins uncorrelated.
  const elevationNoise = makeNoise2D(seed);
  const moistureNoise = makeNoise2D(seed ^ 0x5bf03635);
  const ruinNoise = makeNoise2D(seed ^ 0x27d4eb2f);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = elevationNoise(x * GEN.elevationScale, y * GEN.elevationScale, 5);
      const moisture = moistureNoise(x * GEN.moistureScale, y * GEN.moistureScale, 3);

      let terrain = pickBaseTerrain(elevation, moisture);

      // Ruins overlay dry land only — wreckage sitting in open water would read as
      // an accident rather than a structure.
      if (terrain !== Terrain.DeepWater && terrain !== Terrain.ShallowWater) {
        const ruin = ruinNoise(x * GEN.ruinScale, y * GEN.ruinScale, 3);
        if (ruin > GEN.ruinWallAbove) terrain = Terrain.RuinWall;
        else if (ruin > GEN.ruinFloorAbove) terrain = Terrain.RuinFloor;
      }

      map.setTerrainAt(map.idx(x, y), terrain);
    }
  }

  return map;
}
