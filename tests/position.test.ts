/**
 * Position and multi-level grid indexing.
 *
 * The map ships one level deep, so these tests exercise a capability nothing uses yet.
 * That is the point: the whole reason z exists now is that widening the position type
 * after pawns, jobs, reservations, and save files depend on it would be a rewrite. A
 * reserved seam that was never tested is not actually reserved — it is a guess.
 */

import { describe, expect, it } from 'vitest';
import { GROUND_LEVEL, pos, sameLevel, samePos, tileDistance } from '../src/sim/core/position';
import { Terrain } from '../src/sim/defs/terrain';
import { TileMap } from '../src/sim/world/tilemap';

describe('TilePos', () => {
  it('defaults to ground level', () => {
    expect(pos(3, 4)).toEqual({ x: 3, y: 4, z: GROUND_LEVEL });
  });

  it('compares all three axes', () => {
    expect(samePos(pos(1, 2, 0), pos(1, 2, 0))).toBe(true);
    expect(samePos(pos(1, 2, 0), pos(1, 2, 1))).toBe(false);
    expect(sameLevel(pos(9, 9, 2), pos(0, 0, 2))).toBe(true);
  });

  it('measures Chebyshev distance, because diagonal movement costs one step', () => {
    expect(tileDistance(pos(0, 0), pos(3, 1))).toBe(3);
    expect(tileDistance(pos(0, 0), pos(2, 5))).toBe(5);
  });

  it('reports no straight-line distance between levels', () => {
    // Travel between levels goes through a ramp, so a straight line is meaningless —
    // returning a number here would let pathfinding heuristics quietly cheat.
    expect(tileDistance(pos(0, 0, 0), pos(0, 0, 1))).toBe(Infinity);
  });
});

describe('TileMap indexing', () => {
  it('is one level deep by default', () => {
    const map = new TileMap(8, 8);
    expect(map.levels).toBe(1);
    expect(map.size).toBe(map.layerSize);
  });

  it('sizes its grids across every level', () => {
    const map = new TileMap(10, 6, 4);
    expect(map.layerSize).toBe(60);
    expect(map.size).toBe(240);
    expect(map.terrain.length).toBe(240);
    expect(map.walkCost.length).toBe(240);
  });

  it('round-trips every cell of a multi-level map', () => {
    // The test that matters. A wrong stride corrupts every grid simultaneously and
    // presents as inexplicable behaviour everywhere at once.
    const map = new TileMap(7, 5, 3);
    const seen = new Set<number>();

    for (let z = 0; z < map.levels; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const index = map.idx(x, y, z);
          expect(map.xOf(index)).toBe(x);
          expect(map.yOf(index)).toBe(y);
          expect(map.zOf(index)).toBe(z);
          seen.add(index);
        }
      }
    }

    // Every cell distinct and nothing outside the array: proves the layout has no gaps
    // and no aliasing between levels.
    expect(seen.size).toBe(map.size);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(map.size - 1);
  });

  it('keeps levels independent', () => {
    const map = new TileMap(6, 6, 2);
    map.setTerrain(2, 3, Terrain.Rock, 1);

    expect(map.getTerrain(2, 3, 1)).toBe(Terrain.Rock);
    expect(map.getTerrain(2, 3, 0)).toBe(Terrain.Dirt);
    expect(map.isPassable(2, 3, 1)).toBe(false);
    expect(map.isPassable(2, 3, 0)).toBe(true);
  });

  it('bounds-checks the level axis', () => {
    const map = new TileMap(6, 6, 2);
    expect(map.inBounds(0, 0, 0)).toBe(true);
    expect(map.inBounds(0, 0, 1)).toBe(true);
    expect(map.inBounds(0, 0, 2)).toBe(false);
    expect(map.inBounds(0, 0, -1)).toBe(false);
  });

  it('defaults every accessor to ground level', () => {
    // Existing callers pass no z at all, so the defaults have to agree with each other.
    const map = new TileMap(6, 6, 3);
    map.setTerrain(1, 1, Terrain.Grass);
    expect(map.idx(1, 1)).toBe(map.idx(1, 1, GROUND_LEVEL));
    expect(map.getTerrain(1, 1)).toBe(Terrain.Grass);
    expect(map.getTerrain(1, 1, GROUND_LEVEL)).toBe(Terrain.Grass);
  });
});
