import { describe, expect, it } from 'vitest';
import { HOURS_PER_DAY, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/core/constants';
import { Terrain, TERRAIN_DEFS, terrainDef } from '../src/sim/defs/terrain';
import { daylight, formatTime, timeOfDay } from '../src/sim/world/time';
import { TileMap } from '../src/sim/world/tilemap';
import { generateMap } from '../src/sim/world/worldgen';

describe('terrain defs', () => {
  it('keeps array position aligned with id', () => {
    // TERRAIN_DEFS is indexed by TerrainId. A misordered entry would silently give
    // every cell of one terrain the properties of another.
    TERRAIN_DEFS.forEach((def, index) => {
      expect(def.id, `${def.name} sits at index ${index}`).toBe(index);
    });
  });

  it('covers every declared terrain', () => {
    expect(TERRAIN_DEFS.length).toBe(Object.keys(Terrain).length);
  });

  it('marks solid terrain impassable', () => {
    for (const def of TERRAIN_DEFS) {
      if (def.solid) expect(def.walkCost, def.name).toBe(0);
    }
  });

  it('keeps walk costs inside a Uint8', () => {
    // TileMap.walkCost is a Uint8Array; a cost above 255 would wrap silently.
    for (const def of TERRAIN_DEFS) {
      expect(def.walkCost, def.name).toBeLessThanOrEqual(255);
      expect(Number.isInteger(def.walkCost), `${def.name} cost must be an integer`).toBe(true);
    }
  });
});

describe('TileMap', () => {
  it('round-trips coordinates through the flat index', () => {
    const map = new TileMap(17, 11);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = map.idx(x, y);
        expect(map.xOf(i)).toBe(x);
        expect(map.yOf(i)).toBe(y);
      }
    }
  });

  it('rejects out-of-bounds coordinates', () => {
    const map = new TileMap(10, 10);
    expect(map.inBounds(0, 0)).toBe(true);
    expect(map.inBounds(9, 9)).toBe(true);
    expect(map.inBounds(-1, 0)).toBe(false);
    expect(map.inBounds(10, 0)).toBe(false);
    expect(map.inBounds(0, 10)).toBe(false);
  });

  it('keeps walk cost in sync with terrain', () => {
    const map = new TileMap(8, 8);
    map.setTerrain(3, 4, Terrain.Rock);
    expect(map.walkCost[map.idx(3, 4)]).toBe(terrainDef(Terrain.Rock).walkCost);
    expect(map.isPassable(3, 4)).toBe(false);

    map.setTerrain(3, 4, Terrain.Grass);
    expect(map.isPassable(3, 4)).toBe(true);
  });

  it('treats out-of-bounds as impassable so pathfinding needs no edge cases', () => {
    const map = new TileMap(8, 8);
    expect(map.isPassable(-1, 4)).toBe(false);
    expect(map.isPassable(8, 4)).toBe(false);
  });
});

describe('worldgen', () => {
  it('fills every cell with a defined terrain', () => {
    const map = generateMap(64, 64, 2024);
    for (let i = 0; i < map.size; i++) {
      expect(map.terrain[i]).toBeLessThan(TERRAIN_DEFS.length);
    }
  });

  it('produces a mostly walkable map rather than a wall of rock', () => {
    const map = generateMap(96, 96, 2024);
    let passable = 0;
    for (let i = 0; i < map.size; i++) {
      if (map.walkCost[i] !== 0) passable++;
    }
    const ratio = passable / map.size;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.99);
  });

  it('scatters ruins, because the setting depends on them being visible', () => {
    const map = generateMap(96, 96, 2024);
    let ruins = 0;
    for (let i = 0; i < map.size; i++) {
      if (map.terrain[i] === Terrain.RuinFloor || map.terrain[i] === Terrain.RuinWall) ruins++;
    }
    expect(ruins).toBeGreaterThan(0);
  });

  it('never puts ruins in water', () => {
    const map = generateMap(96, 96, 7);
    for (let i = 0; i < map.size; i++) {
      const t = map.terrain[i];
      const isRuin = t === Terrain.RuinFloor || t === Terrain.RuinWall;
      const isWater = t === Terrain.DeepWater || t === Terrain.ShallowWater;
      expect(isRuin && isWater).toBe(false);
    }
  });
});

describe('time', () => {
  it('starts at day 0, midnight', () => {
    expect(timeOfDay(0)).toEqual({ day: 0, hour: 0, minute: 0 });
  });

  it('advances an hour every TICKS_PER_HOUR', () => {
    expect(timeOfDay(TICKS_PER_HOUR).hour).toBe(1);
    expect(timeOfDay(TICKS_PER_HOUR * 13).hour).toBe(13);
  });

  it('rolls over into the next day', () => {
    const time = timeOfDay(TICKS_PER_DAY + TICKS_PER_HOUR * 6);
    expect(time.day).toBe(1);
    expect(time.hour).toBe(6);
  });

  it('keeps the hour inside the day', () => {
    for (let tick = 0; tick < TICKS_PER_DAY * 3; tick += 977) {
      expect(timeOfDay(tick).hour).toBeLessThan(HOURS_PER_DAY);
    }
  });

  it('is dark at night and bright at midday', () => {
    expect(daylight(TICKS_PER_HOUR * 2)).toBe(0);
    expect(daylight(TICKS_PER_HOUR * 12)).toBe(1);
    expect(daylight(TICKS_PER_HOUR * 23)).toBe(0);
  });

  it('ramps smoothly through dawn and dusk', () => {
    const dawn = daylight(TICKS_PER_HOUR * 6.5);
    const dusk = daylight(TICKS_PER_HOUR * 19.5);
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it('stays within [0, 1] all day', () => {
    for (let tick = 0; tick < TICKS_PER_DAY; tick += 137) {
      const value = daylight(tick);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('formats a padded clock', () => {
    expect(formatTime({ day: 0, hour: 7, minute: 5 })).toBe('07:05');
    expect(formatTime({ day: 3, hour: 22, minute: 41 })).toBe('22:41');
  });
});
