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
 *
 * ## Why this is chunked
 *
 * The obvious implementation floods the whole map and relabels everything whenever
 * terrain changes. That is what this was, and it does not survive a big world: at 512²
 * a full rebuild measured **63.7 ms**, and five colonists mining dirty it about **13
 * times per in-game hour** — a stall every three seconds at 1x. See ADR 0007.
 *
 * So the map is cut into fixed 16×16 chunks. Each chunk floods *itself* into local
 * components; a cached list of cross-chunk links joins them into districts. A terrain
 * change re-floods **one chunk** (256 cells) and re-links its neighbourhood, then
 * unions a few thousand graph edges. The answer is identical — `tests/pathfind.test.ts`
 * checks it against a brute-force whole-map flood fill over random maps and random
 * edits, because "identical" is the only acceptable standard here.
 */

import { GROUND_LEVEL, type TilePos } from '../core/position';
import type { TileMap } from '../world/tilemap';
import { canStep, DIRECTIONS } from './neighbours';

/** Marks a cell no pawn can stand in. */
const IMPASSABLE_COMPONENT = -1;

/** Chunk side, as a power of two so cell → chunk is a shift. */
const CHUNK_SHIFT = 4;
const CHUNK = 1 << CHUNK_SHIFT;

/**
 * Slots reserved per chunk, and the worst case rather than a guess.
 *
 * A checkerboard of walls gives every passable cell its own component — diagonals are
 * illegal there, since both shoulders are blocked — so a chunk really can hold one
 * component per cell. Budgeting less would corrupt the map on a pathological build.
 */
const MAX_LOCAL = CHUNK * CHUNK;

export class ReachabilityMap {
  /** Cell → global slot id (chunk * MAX_LOCAL + local), or IMPASSABLE_COMPONENT. */
  private readonly slot: Int32Array;
  /** Local components currently allocated in each chunk. */
  private readonly localCount: Int32Array;
  /** Union-find over slots. Districts are its roots. */
  private readonly parent: Int32Array;
  /** Per chunk, the cross-chunk links its own border cells produce, as slot pairs. */
  private readonly links: number[][];

  private readonly chunksX: number;
  private readonly chunksY: number;
  private readonly chunksPerLevel: number;

  private readonly queue: Int32Array;

  private readonly chunkDirty: Uint8Array;
  private dirtyChunks: number[] = [];
  private allDirty = true;

  constructor(private readonly map: TileMap) {
    this.chunksX = Math.ceil(map.width / CHUNK);
    this.chunksY = Math.ceil(map.height / CHUNK);
    this.chunksPerLevel = this.chunksX * this.chunksY;

    const chunkCount = this.chunksPerLevel * map.levels;

    this.slot = new Int32Array(map.size);
    this.localCount = new Int32Array(chunkCount);
    this.parent = new Int32Array(chunkCount * MAX_LOCAL);
    this.links = Array.from({ length: chunkCount }, () => []);
    this.chunkDirty = new Uint8Array(chunkCount);

    // One chunk's worth is all a local flood ever needs.
    this.queue = new Int32Array(MAX_LOCAL);
  }

  /**
   * Everything may have changed — worldgen, a load, or a bulk terrain edit.
   *
   * Costs a full rebuild, so prefer `markDirtyAt` when you know which cell moved.
   */
  markDirty(): void {
    this.allDirty = true;
  }

  /**
   * One cell's passability changed — a rock mined, a wall raised, a floor lifted.
   *
   * This is the call that makes a large map affordable, and it is the one every
   * single-cell change should use.
   */
  markDirtyAt(index: number): void {
    if (this.allDirty) return;
    this.markChunkDirty(this.chunkOfCell(index));
  }

  /** Number of distinct districts. Two cells are mutually reachable iff they share one. */
  get regions(): number {
    this.ensureFresh();

    let count = 0;
    for (let chunk = 0; chunk < this.localCount.length; chunk++) {
      const base = chunk * MAX_LOCAL;
      const used = this.localCount[chunk];
      for (let local = 0; local < used; local++) {
        const slot = base + local;
        if (this.find(slot) === slot) count++;
      }
    }
    return count;
  }

  /** District id for a cell, or IMPASSABLE_COMPONENT. */
  componentAt(position: TilePos): number {
    this.ensureFresh();
    const z = position.z ?? GROUND_LEVEL;
    if (!this.map.inBounds(position.x, position.y, z)) return IMPASSABLE_COMPONENT;

    const slot = this.slot[this.map.idx(position.x, position.y, z)];
    return slot === IMPASSABLE_COMPONENT ? IMPASSABLE_COMPONENT : this.find(slot);
  }

  /** True when a pawn standing at `from` could walk to `to`. */
  canReach(from: TilePos, to: TilePos): boolean {
    const a = this.componentAt(from);
    if (a === IMPASSABLE_COMPONENT) return false;
    return a === this.componentAt(to);
  }

  // ── Invalidation bookkeeping ────────────────────────────────────────────────

  private chunkOfCell(index: number): number {
    const x = this.map.xOf(index);
    const y = this.map.yOf(index);
    const z = this.map.zOf(index);
    return (z * this.chunksY + (y >> CHUNK_SHIFT)) * this.chunksX + (x >> CHUNK_SHIFT);
  }

  private markChunkDirty(chunk: number): void {
    if (this.chunkDirty[chunk]) return;
    this.chunkDirty[chunk] = 1;
    this.dirtyChunks.push(chunk);
  }

  private ensureFresh(): void {
    if (this.allDirty) {
      this.rebuildAll();
      return;
    }
    if (this.dirtyChunks.length === 0) return;

    // Re-flood every dirty chunk *before* touching any links, so no link is computed
    // against slot ids that are about to be replaced.
    for (const chunk of this.dirtyChunks) this.refloodChunk(chunk);

    // A chunk's links live on its own border cells, so a change in chunk C can only
    // invalidate links stored by C and by chunks adjacent to it. The awkward case is a
    // diagonal step between two chunks whose *shoulders* lie in a third: that third
    // chunk is always a diagonal neighbour of both, so the 8-neighbourhood covers it.
    const touched = new Set<number>();
    for (const chunk of this.dirtyChunks) {
      touched.add(chunk);
      for (const neighbour of this.neighbourChunks(chunk)) touched.add(neighbour);
    }
    for (const chunk of touched) this.recomputeLinks(chunk);

    for (const chunk of this.dirtyChunks) this.chunkDirty[chunk] = 0;
    this.dirtyChunks = [];

    this.rebuildDistricts();
  }

  private *neighbourChunks(chunk: number): Generator<number> {
    const z = (chunk / this.chunksPerLevel) | 0;
    const within = chunk % this.chunksPerLevel;
    const cy = (within / this.chunksX) | 0;
    const cx = within % this.chunksX;

    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= this.chunksX || ny >= this.chunksY) continue;
      yield (z * this.chunksY + ny) * this.chunksX + nx;
    }
  }

  // ── Rebuilding ──────────────────────────────────────────────────────────────

  private rebuildAll(): void {
    this.allDirty = false;
    this.chunkDirty.fill(0);
    this.dirtyChunks = [];

    for (let chunk = 0; chunk < this.localCount.length; chunk++) this.refloodChunk(chunk);
    for (let chunk = 0; chunk < this.localCount.length; chunk++) this.recomputeLinks(chunk);
    this.rebuildDistricts();
  }

  /** Bounds of a chunk, clamped — the last row and column are usually partial. */
  private chunkBounds(chunk: number): { x0: number; y0: number; x1: number; y1: number; z: number } {
    const z = (chunk / this.chunksPerLevel) | 0;
    const within = chunk % this.chunksPerLevel;
    const cy = (within / this.chunksX) | 0;
    const cx = within % this.chunksX;

    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    return {
      x0,
      y0,
      x1: Math.min(x0 + CHUNK, this.map.width),
      y1: Math.min(y0 + CHUNK, this.map.height),
      z,
    };
  }

  /** Recomputes one chunk's local components, ignoring everything outside it. */
  private refloodChunk(chunk: number): void {
    const map = this.map;
    const { x0, y0, x1, y1, z } = this.chunkBounds(chunk);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) this.slot[map.idx(x, y, z)] = IMPASSABLE_COMPONENT;
    }

    const base = chunk * MAX_LOCAL;
    let local = 0;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = map.idx(x, y, z);
        if (this.slot[index] !== IMPASSABLE_COMPONENT) continue;
        if (!map.isPassable(x, y, z)) continue;
        this.floodWithinChunk(x, y, z, base + local, x0, y0, x1, y1);
        local++;
      }
    }

    this.localCount[chunk] = local;
  }

  /**
   * Iterative BFS over a preallocated queue, bounded to one chunk.
   *
   * `canStep` is still asked about the whole map — a diagonal's shoulders are always
   * inside the bounding box of its two endpoints, so a step legal here is legal
   * globally. Only *enqueueing* is restricted, which is what keeps the component local.
   */
  private floodWithinChunk(
    startX: number,
    startY: number,
    z: number,
    slotId: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const map = this.map;
    const queue = this.queue;
    let head = 0;
    let tail = 0;

    this.slot[map.idx(startX, startY, z)] = slotId;
    queue[tail++] = map.idx(startX, startY, z);

    while (head < tail) {
      const current = queue[head++];
      const cx = map.xOf(current);
      const cy = map.yOf(current);

      for (const [dx, dy] of DIRECTIONS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
        if (!canStep(map, cx, cy, dx, dy, z)) continue;

        const neighbour = map.idx(nx, ny, z);
        if (this.slot[neighbour] !== IMPASSABLE_COMPONENT) continue;
        this.slot[neighbour] = slotId;
        queue[tail++] = neighbour;
      }
    }
  }

  /**
   * Every cross-chunk link produced by this chunk's own border cells.
   *
   * Interior cells cannot reach another chunk in one step, so only the ring is walked.
   * Both sides of a border record the same link; union is idempotent, and paying twice
   * beats keeping a shared edge list consistent.
   */
  private recomputeLinks(chunk: number): void {
    const map = this.map;
    const { x0, y0, x1, y1, z } = this.chunkBounds(chunk);
    const found: number[] = [];

    for (let y = y0; y < y1; y++) {
      const onHorizontalEdge = y === y0 || y === y1 - 1;
      for (let x = x0; x < x1; x++) {
        if (!onHorizontalEdge && x !== x0 && x !== x1 - 1) continue;

        const here = this.slot[map.idx(x, y, z)];
        if (here === IMPASSABLE_COMPONENT) continue;

        for (const [dx, dy] of DIRECTIONS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= x0 && ny >= y0 && nx < x1 && ny < y1) continue; // same chunk
          if (!map.inBounds(nx, ny, z)) continue;
          if (!canStep(map, x, y, dx, dy, z)) continue;

          const there = this.slot[map.idx(nx, ny, z)];
          if (there === IMPASSABLE_COMPONENT) continue;
          found.push(here, there);
        }
      }
    }

    this.links[chunk] = found;
  }

  /**
   * Rebuilds districts from the cached links.
   *
   * Cheap because it walks the *graph*, not the map: a few thousand slots and a few
   * thousand edges, against a quarter of a million cells.
   */
  private rebuildDistricts(): void {
    for (let chunk = 0; chunk < this.localCount.length; chunk++) {
      const base = chunk * MAX_LOCAL;
      const used = this.localCount[chunk];
      for (let local = 0; local < used; local++) this.parent[base + local] = base + local;
    }

    for (const list of this.links) {
      for (let i = 0; i < list.length; i += 2) this.union(list[i], list[i + 1]);
    }
  }

  private find(slot: number): number {
    let current = slot;
    while (this.parent[current] !== current) {
      // Path halving — keeps the trees flat without a second pass.
      this.parent[current] = this.parent[this.parent[current]];
      current = this.parent[current];
    }
    return current;
  }

  private union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Lower slot wins, so district ids are stable given the same map rather than
    // depending on the order edits happened to arrive in.
    if (rootA < rootB) this.parent[rootB] = rootA;
    else this.parent[rootA] = rootB;
  }
}
