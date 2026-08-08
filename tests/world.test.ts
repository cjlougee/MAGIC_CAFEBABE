import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_SIZE,
  HOURS_PER_DAY,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from '../src/sim/core/constants';
import { pos } from '../src/sim/core/position';
import { Terrain, TERRAIN_DEFS, terrainDef } from '../src/sim/defs/terrain';
import { ReachabilityMap } from '../src/sim/pathfind/reachability';
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

  /*
   * This used to sample one 96x96 map and assert half of it was walkable. That was a
   * reasonable proxy while every window of the map had the same statistics — but M7's
   * wavelengths are longer than 96 tiles on purpose, so a 96-tile sample is now a look
   * at *one region*, and a region legitimately can be badlands. It failed on a rocky
   * seed while the world it came from was 78% walkable.
   *
   * So both halves are asserted at the size the game actually generates, over several
   * seeds — and the second one asserts the property the first was only standing in for.
   */
  it('generates a world that is mostly walkable, at the size the game uses', () => {
    for (const seed of [2024, 7, 31337]) {
      const map = generateMap(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE, seed);
      let passable = 0;
      for (let i = 0; i < map.size; i++) {
        if (map.walkCost[i] !== 0) passable++;
      }
      const ratio = passable / map.size;
      expect(ratio, `seed ${seed}`).toBeGreaterThan(0.5);
      expect(ratio, `seed ${seed}`).toBeLessThan(0.99);
    }
  });

  it('joins nearly all of that walkable ground into one landmass', () => {
    /*
     * The thing "mostly walkable" was really asking about. A world can be 80% open and
     * still useless if it is 80% open in forty separate pockets — you would land in one
     * and never leave it, which on a map built for travelling somewhere is fatal and
     * completely invisible to a walkable-cell count.
     */
    for (const seed of [2024, 7, 31337]) {
      const map = generateMap(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE, seed);
      const reach = new ReachabilityMap(map);

      const sizes = new Map<number, number>();
      let walkable = 0;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const district = reach.componentAt(pos(x, y));
          if (district === -1) continue;
          walkable++;
          sizes.set(district, (sizes.get(district) ?? 0) + 1);
        }
      }

      const largest = Math.max(...sizes.values());
      expect(largest / walkable, `seed ${seed} is fragmented`).toBeGreaterThan(0.9);
    }
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
