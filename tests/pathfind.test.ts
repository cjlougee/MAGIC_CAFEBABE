import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { Terrain } from '../src/sim/defs/terrain';
import { Pathfinder } from '../src/sim/pathfind/pathfinder';
import { ReachabilityMap } from '../src/sim/pathfind/reachability';
import { TileMap } from '../src/sim/world/tilemap';
import { generateMap } from '../src/sim/world/worldgen';

function openMap(width: number, height: number): TileMap {
  const map = new TileMap(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) map.setTerrain(x, y, Terrain.Dirt);
  }
  return map;
}

function fill(map: TileMap, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) map.setTerrain(x, y, id as never);
  }
}

describe('A*', () => {
  it('walks a straight line across open ground', () => {
    const map = openMap(20, 20);
    const result = new Pathfinder(map).find(pos(2, 10), pos(9, 10));

    expect(result).not.toBeNull();
    // Seven tiles east, and the start cell is excluded because the pawn is on it.
    expect(result!.steps).toHaveLength(7);
    expect(result!.steps.at(-1)).toEqual(pos(9, 10));
  });

  it('returns an empty route when already standing on the goal', () => {
    const map = openMap(10, 10);
    const result = new Pathfinder(map).find(pos(4, 4), pos(4, 4));
    expect(result?.steps).toEqual([]);
  });

  it('routes around a wall rather than through it', () => {
    const map = openMap(20, 20);
    fill(map, 10, 0, 10, 15, Terrain.Rock); // Wall with a gap along the bottom.

    const result = new Pathfinder(map).find(pos(5, 5), pos(15, 5));
    expect(result).not.toBeNull();

    for (const step of result!.steps) {
      expect(map.isPassable(step.x, step.y)).toBe(true);
    }
    // Detouring past the gap costs far more than the 10-tile direct line.
    expect(result!.steps.length).toBeGreaterThan(15);
  });

  it('gives up on a walled-off goal', () => {
    const map = openMap(20, 20);
    fill(map, 10, 0, 10, 19, Terrain.Rock); // Full-height wall, no gap.
    expect(new Pathfinder(map).find(pos(5, 5), pos(15, 5))).toBeNull();
  });

  it('refuses an impassable goal instead of walking as close as possible', () => {
    const map = openMap(10, 10);
    map.setTerrain(5, 5, Terrain.Rock);
    expect(new Pathfinder(map).find(pos(1, 1), pos(5, 5))).toBeNull();
  });

  it('never cuts the corner between two walls', () => {
    // Rock at (5,4) and (4,5) means stepping (4,4) -> (5,5) would clip through the
    // point where they meet. Pawns squeezing through walls is a classic grid bug.
    const map = openMap(10, 10);
    map.setTerrain(5, 4, Terrain.Rock);
    map.setTerrain(4, 5, Terrain.Rock);

    const result = new Pathfinder(map).find(pos(4, 4), pos(5, 5));
    expect(result).not.toBeNull();
    expect(result!.steps[0]).not.toEqual(pos(5, 5));
  });

  it('produces steps that are each adjacent, passable, and non-repeating', () => {
    // The invariant that matters: any route the pathfinder hands back must be one a
    // pawn can physically walk, one tile at a time.
    const map = generateMap(64, 64, 4242);
    const finder = new Pathfinder(map);
    const reach = new ReachabilityMap(map);

    let checked = 0;
    for (let i = 0; i < 400 && checked < 25; i++) {
      const from = pos((i * 7) % 64, (i * 13) % 64);
      const to = pos((i * 29) % 64, (i * 17) % 64);
      if (!map.isPassable(from.x, from.y) || !map.isPassable(to.x, to.y)) continue;
      if (!reach.canReach(from, to)) continue;

      const result = finder.find(from, to);
      expect(result, `${from.x},${from.y} -> ${to.x},${to.y}`).not.toBeNull();

      let previous = from;
      const seen = new Set<string>();
      for (const step of result!.steps) {
        expect(map.isPassable(step.x, step.y)).toBe(true);
        expect(Math.abs(step.x - previous.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(step.y - previous.y)).toBeLessThanOrEqual(1);
        const key = `${step.x},${step.y}`;
        expect(seen.has(key), 'route revisits a tile').toBe(false);
        seen.add(key);
        previous = step;
      }
      checked++;
    }

    expect(checked).toBeGreaterThan(10);
  });

  it('prefers cheaper ground over a shorter slog through water', () => {
    const map = openMap(20, 5);
    fill(map, 5, 2, 12, 2, Terrain.ShallowWater); // Wading costs 22 against dirt's 10.

    const result = new Pathfinder(map).find(pos(2, 2), pos(16, 2));
    expect(result).not.toBeNull();

    const waded = result!.steps.filter(
      (step) => map.getTerrain(step.x, step.y) === Terrain.ShallowWater,
    );
    expect(waded.length).toBeLessThan(4);
  });

  it('does not path between levels, since nothing links them yet', () => {
    const map = new TileMap(8, 8, 2);
    expect(new Pathfinder(map).find(pos(1, 1, 0), pos(2, 2, 1))).toBeNull();
  });
});

describe('reachability', () => {
  it('separates rooms a wall divides', () => {
    const map = openMap(20, 20);
    fill(map, 10, 0, 10, 19, Terrain.Rock);
    const reach = new ReachabilityMap(map);

    expect(reach.canReach(pos(5, 5), pos(6, 6))).toBe(true);
    expect(reach.canReach(pos(5, 5), pos(15, 5))).toBe(false);
    expect(reach.regions).toBe(2);
  });

  it('reports impassable cells as unreachable from anywhere', () => {
    const map = openMap(10, 10);
    map.setTerrain(5, 5, Terrain.Rock);
    expect(reachFrom(map, pos(1, 1), pos(5, 5))).toBe(false);
  });

  it('rebuilds after terrain changes', () => {
    const map = openMap(20, 20);
    const reach = new ReachabilityMap(map);
    expect(reach.canReach(pos(5, 5), pos(15, 5))).toBe(true);

    fill(map, 10, 0, 10, 19, Terrain.Rock);
    reach.markDirty();
    expect(reach.canReach(pos(5, 5), pos(15, 5))).toBe(false);
  });

  it('agrees with A* on every sampled pair', () => {
    /*
     * The most important test in this file.
     *
     * Reachability is a cheap pre-filter that decides whether A* is worth running. If
     * it is ever more optimistic than A*, a pawn is told a target is reachable, fails
     * to path to it, and re-plans — every think tick, forever. Both use canStep()
     * precisely so this holds.
     */
    const map = generateMap(56, 56, 90210);
    const reach = new ReachabilityMap(map);
    const finder = new Pathfinder(map);

    let compared = 0;
    for (let i = 0; i < 600; i++) {
      const from = pos((i * 11) % 56, (i * 23) % 56);
      const to = pos((i * 37) % 56, (i * 5) % 56);
      if (!map.isPassable(from.x, from.y) || !map.isPassable(to.x, to.y)) continue;

      const claimed = reach.canReach(from, to);
      const actual = finder.find(from, to) !== null;
      expect(claimed, `disagreement at ${from.x},${from.y} -> ${to.x},${to.y}`).toBe(actual);
      compared++;
    }

    expect(compared).toBeGreaterThan(100);
  });
});

function reachFrom(map: TileMap, from: ReturnType<typeof pos>, to: ReturnType<typeof pos>) {
  return new ReachabilityMap(map).canReach(from, to);
}
