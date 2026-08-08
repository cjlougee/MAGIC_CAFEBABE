import { describe, expect, it } from 'vitest';
import { pos } from '../src/sim/core/position';
import { Rng } from '../src/sim/core/rng';
import { Terrain } from '../src/sim/defs/terrain';
import { canStep, DIRECTIONS } from '../src/sim/pathfind/neighbours';
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

  it('matches a whole-map flood fill after every incremental edit', () => {
    /*
     * The guard on chunking (ADR 0007).
     *
     * ReachabilityMap no longer re-floods the map when terrain changes — it re-floods
     * one 16x16 chunk and re-links its neighbourhood. That is a large amount of
     * bookkeeping standing where a correct-by-construction algorithm used to be, and
     * every way of getting it wrong produces the same symptom: a pawn that believes in
     * a route nobody can walk, or refuses one that exists.
     *
     * So the incremental result is compared against the naive whole-map answer after
     * *every single edit* — including edits that straddle chunk borders and corners,
     * which is where linking goes wrong if it goes wrong at all.
     */
    const map = generateMap(80, 80, 4242);
    const reach = new ReachabilityMap(map);
    const rng = new Rng(20260808);

    for (let edit = 0; edit < 220; edit++) {
      const x = rng.range(0, map.width);
      const y = rng.range(0, map.height);
      const index = map.idx(x, y);

      // Alternate between the two independent sources of passability, because they are
      // separate grids and a chunk keyed off only one of them would still pass.
      if (edit % 3 === 2) {
        map.setBuildingAt(index, rng.range(0, 2) === 0, false);
      } else {
        map.setTerrain(x, y, rng.range(0, 2) === 0 ? Terrain.Rock : Terrain.Dirt);
      }
      reach.markDirtyAt(index);

      expectSamePartition(map, reach, `after edit ${edit} at ${x},${y}`);
    }
  });

  it('is unaffected by which chunk an edit lands in', () => {
    // A 16-cell chunk means x=15 and x=16 are different chunks, and a cell at 15,15 is
    // a corner shared by four of them. Diagonal links there depend on shoulders lying in
    // two *other* chunks, which is the case a naive neighbourhood misses.
    const map = openMap(48, 48);
    const reach = new ReachabilityMap(map);

    for (const [x, y] of [
      [15, 15],
      [16, 16],
      [15, 16],
      [16, 15],
      [31, 15],
      [0, 0],
      [47, 47],
    ]) {
      map.setTerrain(x, y, Terrain.Rock);
      reach.markDirtyAt(map.idx(x, y));
      expectSamePartition(map, reach, `blocking the corner cell ${x},${y}`);
    }
  });
});

/** The naive answer: one flood fill over the whole map, sharing canStep with the real one. */
function bruteForceComponents(map: TileMap): Int32Array {
  const component = new Int32Array(map.size).fill(-1);
  let next = 0;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const start = map.idx(x, y);
      if (component[start] !== -1 || !map.isPassable(x, y)) continue;

      const queue = [start];
      component[start] = next;
      for (let head = 0; head < queue.length; head++) {
        const cx = map.xOf(queue[head]);
        const cy = map.yOf(queue[head]);
        for (const [dx, dy] of DIRECTIONS) {
          if (!canStep(map, cx, cy, dx, dy)) continue;
          const neighbour = map.idx(cx + dx, cy + dy);
          if (component[neighbour] !== -1) continue;
          component[neighbour] = next;
          queue.push(neighbour);
        }
      }
      next++;
    }
  }

  return component;
}

/**
 * Asserts the two partitions are identical.
 *
 * Comparing ids directly would be wrong — the chunked map numbers districts by slot and
 * has no reason to agree. What must match is which cells are grouped *together*, so the
 * mapping between the two labellings has to be one-to-one in both directions.
 */
function expectSamePartition(map: TileMap, reach: ReachabilityMap, context: string): void {
  const oracle = bruteForceComponents(map);
  const oracleToDistrict = new Map<number, number>();
  const districtToOracle = new Map<number, number>();

  // One assertion at the end rather than one per cell. Vitest's expect() is expensive
  // enough that asserting 6,400 cells across 220 edits costs more than everything else
  // in this file put together, and a single explained failure reads better anyway.
  let failure: string | null = null;

  for (let y = 0; y < map.height && failure === null; y++) {
    for (let x = 0; x < map.width && failure === null; x++) {
      const expected = oracle[map.idx(x, y)];
      const district = reach.componentAt(pos(x, y));

      if (expected === -1) {
        if (district !== -1) failure = `impassable ${x},${y} reported reachable`;
        continue;
      }
      if (district === -1) {
        failure = `passable ${x},${y} reported impassable`;
        continue;
      }

      const seenDistrict = oracleToDistrict.get(expected);
      if (seenDistrict === undefined) oracleToDistrict.set(expected, district);
      else if (seenDistrict !== district) failure = `${x},${y} split from its component`;

      const seenOracle = districtToOracle.get(district);
      if (seenOracle === undefined) districtToOracle.set(district, expected);
      else if (seenOracle !== expected) failure = `${x},${y} merged with another component`;
    }
  }

  expect(failure, context).toBeNull();
}

function reachFrom(map: TileMap, from: ReturnType<typeof pos>, to: ReturnType<typeof pos>) {
  return new ReachabilityMap(map).canReach(from, to);
}
