/**
 * A* over the walk-cost grid.
 *
 * Holds its scratch buffers for the lifetime of the map and reuses them across
 * searches. A colony runs many searches per second, so allocating a few 64KB arrays
 * per call would hand the GC a steady stream of garbage during exactly the frames that
 * are already busy.
 *
 * Buffers are not cleared between searches. Instead each search bumps a generation
 * counter and a per-cell stamp records which search last touched that cell — so a
 * stale value is recognisable in O(1) and clearing 62,500 cells per path is avoided.
 */

import { GROUND_LEVEL, type TilePos } from '../core/position';
import { TERRAIN_DEFS } from '../defs/terrain';
import type { TileMap } from '../world/tilemap';
import { BinaryHeap } from './binaryHeap';
import { canStep, DIRECTIONS, isDiagonal, stepCost } from './neighbours';

/**
 * Cheapest possible step, derived from the terrain table rather than hardcoded.
 *
 * The heuristic must never overestimate or A* stops finding optimal paths. Deriving
 * these means adding a faster terrain later can't silently break admissibility.
 */
const MIN_STRAIGHT = Math.min(
  ...TERRAIN_DEFS.filter((def) => def.walkCost > 0).map((def) => def.walkCost),
);
const MIN_DIAGONAL = ((MIN_STRAIGHT * 141) / 100) | 0;

/** Ceiling on cells examined, so a hopeless search can't stall a tick. */
const DEFAULT_NODE_BUDGET = 20000;

export interface PathResult {
  /** Tiles to walk, excluding the pawn's current cell. Empty when already at the goal. */
  readonly steps: TilePos[];
  readonly cellsExamined: number;
}

export class Pathfinder {
  private readonly gScore: Int32Array;
  private readonly fScore: Int32Array;
  private readonly cameFrom: Int32Array;
  private readonly openStamp: Int32Array;
  private readonly closedStamp: Int32Array;
  private readonly heap: BinaryHeap;
  private generation = 0;

  constructor(private readonly map: TileMap) {
    const size = map.size;
    this.gScore = new Int32Array(size);
    this.fScore = new Int32Array(size);
    this.cameFrom = new Int32Array(size);
    this.openStamp = new Int32Array(size);
    this.closedStamp = new Int32Array(size);
    this.heap = new BinaryHeap(this.fScore, 512);
  }

  /**
   * Octile distance — the exact cost of an unobstructed 8-directional walk over the
   * cheapest terrain, which makes it both admissible and tight.
   */
  private heuristic(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return MIN_STRAIGHT * (dx + dy) + (MIN_DIAGONAL - 2 * MIN_STRAIGHT) * Math.min(dx, dy);
  }

  find(start: TilePos, goal: TilePos, nodeBudget = DEFAULT_NODE_BUDGET): PathResult | null {
    const map = this.map;

    // Levels are not linked yet; a cross-level request is a caller bug, not a long walk.
    if (start.z !== goal.z) return null;
    const z = start.z ?? GROUND_LEVEL;

    if (!map.inBounds(goal.x, goal.y, z) || !map.isPassable(goal.x, goal.y, z)) return null;
    if (!map.inBounds(start.x, start.y, z)) return null;

    const startIndex = map.idx(start.x, start.y, z);
    const goalIndex = map.idx(goal.x, goal.y, z);
    if (startIndex === goalIndex) return { steps: [], cellsExamined: 0 };

    const generation = ++this.generation;
    this.heap.reset(this.fScore);

    this.gScore[startIndex] = 0;
    this.fScore[startIndex] = this.heuristic(start.x, start.y, goal.x, goal.y);
    this.cameFrom[startIndex] = -1;
    this.openStamp[startIndex] = generation;
    this.heap.push(startIndex);

    let examined = 0;

    while (this.heap.size > 0) {
      const current = this.heap.pop();
      if (this.closedStamp[current] === generation) continue;
      this.closedStamp[current] = generation;
      examined++;

      if (current === goalIndex) {
        return { steps: this.reconstruct(current, z), cellsExamined: examined };
      }
      if (examined >= nodeBudget) return null;

      const cx = map.xOf(current);
      const cy = map.yOf(current);
      const currentG = this.gScore[current];

      for (const [dx, dy] of DIRECTIONS) {
        if (!canStep(map, cx, cy, dx, dy, z)) continue;

        const nx = cx + dx;
        const ny = cy + dy;
        const neighbour = map.idx(nx, ny, z);
        if (this.closedStamp[neighbour] === generation) continue;

        const tentative = currentG + stepCost(map, nx, ny, isDiagonal(dx, dy), z);
        const known = this.openStamp[neighbour] === generation;
        if (known && tentative >= this.gScore[neighbour]) continue;

        this.gScore[neighbour] = tentative;
        this.fScore[neighbour] = tentative + this.heuristic(nx, ny, goal.x, goal.y);
        this.cameFrom[neighbour] = current;
        this.openStamp[neighbour] = generation;
        // Pushed again rather than decrease-key'd; the stale entry is skipped on pop
        // by the closed check above. Simpler, and cheaper than maintaining positions.
        this.heap.push(neighbour);
      }
    }

    return null;
  }

  private reconstruct(goalIndex: number, z: number): TilePos[] {
    const map = this.map;
    const reversed: TilePos[] = [];

    let cursor = goalIndex;
    while (cursor !== -1) {
      reversed.push({ x: map.xOf(cursor), y: map.yOf(cursor), z });
      cursor = this.cameFrom[cursor];
    }

    // Drop the start cell: the pawn is standing on it.
    reversed.pop();
    reversed.reverse();
    return reversed;
  }
}
