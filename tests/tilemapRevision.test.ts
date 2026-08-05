/**
 * The terrain revision counter.
 *
 * Regression cover for a bug that only showed up in the running game: mining a rock
 * turned it into gravel, but GroundLayer caches its sprite assignment by view rect and
 * had no way to learn the terrain had changed. It kept drawing the world as it was, so
 * a black hole appeared where the rock had been.
 *
 * The counter is the signal render layers key their caches on. Tested here rather than
 * in the renderer because the invariant belongs to the map.
 */

import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/sim/defs/terrain';
import { TileMap } from '../src/sim/world/tilemap';

describe('TileMap revision', () => {
  it('advances when terrain changes', () => {
    const map = new TileMap(8, 8);
    const before = map.revision;

    map.setTerrain(3, 3, Terrain.Rock);
    expect(map.revision).toBeGreaterThan(before);
  });

  it('does not advance when the terrain is already what you set', () => {
    // Otherwise every no-op write busts every render cache, and a layer that rebuilds
    // constantly is the same as no cache at all.
    const map = new TileMap(8, 8);
    map.setTerrain(3, 3, Terrain.Rock);

    const settled = map.revision;
    map.setTerrain(3, 3, Terrain.Rock);
    expect(map.revision).toBe(settled);
  });

  it('advances once per genuine change', () => {
    const map = new TileMap(8, 8);
    const before = map.revision;

    map.setTerrain(1, 1, Terrain.Rock);
    map.setTerrain(2, 1, Terrain.Rock);
    map.setTerrain(1, 1, Terrain.Gravel);

    expect(map.revision).toBe(before + 3);
  });

  it('keeps walk cost in step with the change it reports', () => {
    const map = new TileMap(8, 8);
    map.setTerrain(4, 4, Terrain.Rock);
    expect(map.isPassable(4, 4)).toBe(false);

    const mined = map.revision;
    map.setTerrain(4, 4, Terrain.Gravel);
    expect(map.revision).toBeGreaterThan(mined);
    expect(map.isPassable(4, 4)).toBe(true);
  });
});
