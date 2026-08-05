/**
 * The fade-what's-in-the-way rule.
 *
 * Tested directly rather than by eye because the failure modes are subtle and
 * symmetrical: fading tiles *behind* a pawn looks like flickering for no reason, and
 * failing to fade tiles in front means colonists vanish behind cliffs. Both are easy to
 * miss in a screenshot and trivial to assert here.
 */

import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/sim/defs/terrain';
import { TileMap } from '../src/sim/world/tilemap';
import { collectOccluders, overlaps, pawnBox, tileBox } from '../src/render/occlusion';

function openMap(size = 24): TileMap {
  const map = new TileMap(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) map.setTerrain(x, y, Terrain.Dirt);
  }
  return map;
}

const AT = { x: 12, y: 12, z: 0 };

function occludersFor(map: TileMap) {
  const out = new Set<number>();
  collectOccluders(map, [AT], out);
  return out;
}

describe('screen boxes', () => {
  it('detects overlap and separation', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(overlaps(a, { x0: 5, y0: 5, x1: 15, y1: 15 })).toBe(true);
    expect(overlaps(a, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false);
    expect(overlaps(a, { x0: 0, y0: 20, x1: 10, y1: 30 })).toBe(false);
  });

  it('grows a tile box upward by its height, never downward', () => {
    // A raised tile only ever covers things *behind* it. If it grew downward it would
    // cover the tile in front, and the painter's order would be wrong, not just the fade.
    const flat = tileBox(0, 0, 0);
    const tall = tileBox(0, 0, 20);
    expect(tall.y0).toBe(flat.y0 - 20);
    expect(tall.y1).toBe(flat.y1);
  });

  it('anchors a pawn box at the feet', () => {
    const box = pawnBox(0, 0);
    expect(box.y1).toBeGreaterThan(0); // A little below the feet, for the shadow.
    expect(box.y0).toBeLessThan(-20); // Head well above.
  });
});

describe('collectOccluders', () => {
  it('reports a raised tile standing in front of a pawn', () => {
    const map = openMap();
    map.setTerrain(AT.x + 1, AT.y, Terrain.Rock);
    expect(occludersFor(map).has(map.idx(AT.x + 1, AT.y))).toBe(true);
  });

  it('reports the other in-front neighbour too', () => {
    const map = openMap();
    map.setTerrain(AT.x, AT.y + 1, Terrain.Rock);
    expect(occludersFor(map).has(map.idx(AT.x, AT.y + 1))).toBe(true);
  });

  it('ignores raised tiles behind the pawn', () => {
    /*
     * The property that matters most. Tiles with lower depth are drawn *before* the
     * pawn and cannot hide it — fading them would dim the cliff a colonist is standing
     * in front of, which reads as a rendering glitch rather than a feature.
     */
    const map = openMap();
    map.setTerrain(AT.x - 1, AT.y, Terrain.Rock);
    map.setTerrain(AT.x, AT.y - 1, Terrain.Rock);
    map.setTerrain(AT.x - 1, AT.y - 1, Terrain.Rock);
    expect(occludersFor(map).size).toBe(0);
  });

  it('ignores flat terrain, however close', () => {
    const map = openMap();
    map.setTerrain(AT.x + 1, AT.y, Terrain.Grass);
    map.setTerrain(AT.x, AT.y + 1, Terrain.ShallowWater);
    expect(occludersFor(map).size).toBe(0);
  });

  it('ignores raised tiles too far in front to reach the pawn', () => {
    const map = openMap();
    map.setTerrain(AT.x + 3, AT.y + 3, Terrain.Rock);
    expect(occludersFor(map).size).toBe(0);
  });

  it('ignores raised tiles offset too far sideways', () => {
    // Same depth band, but the diamond has carried it clear of the pawn horizontally.
    const map = openMap();
    map.setTerrain(AT.x + 3, AT.y, Terrain.Rock);
    expect(occludersFor(map).has(map.idx(AT.x + 3, AT.y))).toBe(false);
  });

  it('reaches further for taller terrain', () => {
    // Bulkheads (22px) cover a rank that rock (14px) does not.
    const map = openMap();
    map.setTerrain(AT.x + 1, AT.y + 1, Terrain.RuinWall);
    expect(occludersFor(map).has(map.idx(AT.x + 1, AT.y + 1))).toBe(true);
  });

  it('clears previous results rather than accumulating', () => {
    const map = openMap();
    map.setTerrain(AT.x + 1, AT.y, Terrain.Rock);
    const out = new Set<number>();

    collectOccluders(map, [AT], out);
    expect(out.size).toBe(1);

    // Same set reused every frame; a stale entry would leave a tile faded forever.
    collectOccluders(map, [{ x: 2, y: 2, z: 0 }], out);
    expect(out.size).toBe(0);
  });

  it('handles a pawn at the map edge without reading out of bounds', () => {
    const map = openMap();
    const out = new Set<number>();
    expect(() => collectOccluders(map, [{ x: 23, y: 23, z: 0 }], out)).not.toThrow();
    expect(() => collectOccluders(map, [{ x: 0, y: 0, z: 0 }], out)).not.toThrow();
  });
});
