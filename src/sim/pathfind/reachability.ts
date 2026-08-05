/**
 * Which cells can reach which other cells, in O(1).
 *
 * This is the cheap half of pathfinding and the more important one for a colony sim.
 * Without it, a pawn looking for work runs a full A* against every candidate target
 * and fails on each unreachable one — every think tick, forever. With it, the question
 * "is there any steel I can actually get to?" is an integer comparison.
 *
 * Flood fill uses `canStep`, the same rule A* uses. If the two ever disagree,
 * reachability promises routes A* cannot deliver and pawns re-plan in a loop.
 */

import { GROUND_LEVEL, type TilePos } from '../core/position';
import type { TileMap } from '../world/tilemap';
import { canStep, DIRECTIONS } from './neighbours';

/** Marks a cell no pawn can stand in. */
const IMPASSABLE_COMPONENT = -1;

export class ReachabilityMap {
  private readonly component: Int32Array;
  private readonly queue: Int32Array;
  private componentCount = 0;
  private dirty = true;

  constructor(private readonly map: TileMap) {
    this.component = new Int32Array(map.size);
    this.queue = new Int32Array(map.size);
  }

  /** Call whenever terrain passability changes — a wall built, a rock mined. */
  markDirty(): void {
    this.dirty = true;
  }

  get regions(): number {
    this.ensureFresh();
    return this.componentCount;
  }

  /** Component id for a cell, or IMPASSABLE_COMPONENT. */
  componentAt(position: TilePos): number {
    this.ensureFresh();
    const z = position.z ?? GROUND_LEVEL;
    if (!this.map.inBounds(position.x, position.y, z)) return IMPASSABLE_COMPONENT;
    return this.component[this.map.idx(position.x, position.y, z)];
  }

  /** True when a pawn standing at `from` could walk to `to`. */
  canReach(from: TilePos, to: TilePos): boolean {
    const a = this.componentAt(from);
    if (a === IMPASSABLE_COMPONENT) return false;
    return a === this.componentAt(to);
  }

  private ensureFresh(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    const map = this.map;
    this.component.fill(IMPASSABLE_COMPONENT);
    this.componentCount = 0;

    for (let z = 0; z < map.levels; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const index = map.idx(x, y, z);
          if (this.component[index] !== IMPASSABLE_COMPONENT) continue;
          if (!map.isPassable(x, y, z)) continue;
          this.floodFill(x, y, z, this.componentCount++);
        }
      }
    }
  }

  /** Iterative BFS over a preallocated queue — recursion would blow the stack. */
  private floodFill(startX: number, startY: number, z: number, id: number): void {
    const map = this.map;
    const queue = this.queue;
    let head = 0;
    let tail = 0;

    const startIndex = map.idx(startX, startY, z);
    this.component[startIndex] = id;
    queue[tail++] = startIndex;

    while (head < tail) {
      const current = queue[head++];
      const cx = map.xOf(current);
      const cy = map.yOf(current);

      for (const [dx, dy] of DIRECTIONS) {
        if (!canStep(map, cx, cy, dx, dy, z)) continue;
        const neighbour = map.idx(cx + dx, cy + dy, z);
        if (this.component[neighbour] !== IMPASSABLE_COMPONENT) continue;
        this.component[neighbour] = id;
        queue[tail++] = neighbour;
      }
    }
  }
}
