/**
 * The tile grid.
 *
 * Every per-cell field is a flat typed array indexed by `idx(x, y, z)`. This is where
 * simulation performance actually lives: a 250x250 map is 62,500 cells per level, and
 * anything allocated per-cell would dominate. Read and write through idx().
 *
 * **Layout is level-major**: all of level 0, then all of level 1, and so on. Within a
 * level it is row-major, `y * width + x`. Level-major is the right order because play
 * iterates within a single level constantly (pathfinding, rendering, work scanning) and
 * across levels rarely.
 *
 * `levels` is currently 1. The indexing is z-aware anyway so that adding levels is a
 * constructor change rather than an edit to every call site — see
 * docs/decisions/0003-verticality.md.
 */

import { IMPASSABLE } from '../core/constants';
import { GROUND_LEVEL } from '../core/position';
import { Terrain, TERRAIN_DEFS, type TerrainId } from '../defs/terrain';

export class TileMap {
  readonly width: number;
  readonly height: number;
  /** Number of stacked z-levels. 1 until verticality lands. */
  readonly levels: number;

  /** Cells in a single level. The stride between levels in every grid. */
  readonly layerSize: number;
  /** Total cells across all levels. */
  readonly size: number;

  /** TerrainId per cell. */
  readonly terrain: Uint8Array;
  /** Movement cost per cell; IMPASSABLE (0) means blocked. Derived from terrain. */
  readonly walkCost: Uint8Array;

  /**
   * Non-zero where a building blocks movement, and where one seals a room.
   *
   * Kept apart from `walkCost` because these are two different questions with two
   * different owners: terrain decides cost, structures decide obstruction. Folding a
   * wall into walkCost would mean deconstructing it had to *guess* what the cost
   * underneath used to be.
   *
   * Room-blocking is separate again, because a **door** blocks a room without blocking
   * movement.
   */
  readonly buildingBlocks: Uint8Array;
  readonly buildingSealsRoom: Uint8Array;

  /**
   * Bumped on every terrain change.
   *
   * Render layers cache their sprite assignments and only rebuild when something they
   * depend on changes. Without a signal, mining a rock leaves the cached ground layer
   * showing the world as it was — the mined cell is simply never redrawn and a hole
   * appears where the terrain used to be.
   */
  private revisionCount = 0;

  constructor(width: number, height: number, levels = 1) {
    this.width = width;
    this.height = height;
    this.levels = levels;
    this.layerSize = width * height;
    this.size = this.layerSize * levels;

    this.terrain = new Uint8Array(this.size);
    this.walkCost = new Uint8Array(this.size);
    this.buildingBlocks = new Uint8Array(this.size);
    this.buildingSealsRoom = new Uint8Array(this.size);
    this.terrain.fill(Terrain.Dirt);
    this.walkCost.fill(TERRAIN_DEFS[Terrain.Dirt].walkCost);
  }

  /** Records what a structure does to a cell. Bumps the revision so caches refresh. */
  setBuildingAt(index: number, blocksMovement: boolean, sealsRoom: boolean): void {
    const blocks = blocksMovement ? 1 : 0;
    const seals = sealsRoom ? 1 : 0;
    if (this.buildingBlocks[index] === blocks && this.buildingSealsRoom[index] === seals) return;

    this.buildingBlocks[index] = blocks;
    this.buildingSealsRoom[index] = seals;
    this.revisionCount++;
  }

  /** True where a wall or door forms the edge of a room. */
  sealsRoomAt(index: number): boolean {
    return this.buildingSealsRoom[index] !== 0;
  }

  /** Monotonic counter identifying the current terrain state. */
  get revision(): number {
    return this.revisionCount;
  }

  idx(x: number, y: number, z: number = GROUND_LEVEL): number {
    return z * this.layerSize + y * this.width + x;
  }

  xOf(index: number): number {
    return index % this.width;
  }

  yOf(index: number): number {
    return ((index % this.layerSize) / this.width) | 0;
  }

  zOf(index: number): number {
    return (index / this.layerSize) | 0;
  }

  inBounds(x: number, y: number, z: number = GROUND_LEVEL): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.width && y < this.height && z < this.levels;
  }

  getTerrain(x: number, y: number, z: number = GROUND_LEVEL): TerrainId {
    return this.terrain[this.idx(x, y, z)] as TerrainId;
  }

  /** Sets terrain and keeps the derived walk cost in sync. */
  setTerrain(x: number, y: number, id: TerrainId, z: number = GROUND_LEVEL): void {
    this.setTerrainAt(this.idx(x, y, z), id);
  }

  /**
   * Terrain by flat index. Exists so callers that already computed an index (render
   * layers walking a viewport, pathfinding walking neighbours) don't pay for idx()
   * twice, and so the `number` coming out of the typed array is narrowed in one place
   * rather than cast at every call site.
   */
  terrainAt(index: number): TerrainId {
    return this.terrain[index] as TerrainId;
  }

  setTerrainAt(index: number, id: TerrainId): void {
    if (this.terrain[index] === id) return;
    this.terrain[index] = id;
    this.walkCost[index] = TERRAIN_DEFS[id].walkCost;
    this.revisionCount++;
  }

  isPassable(x: number, y: number, z: number = GROUND_LEVEL): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const index = this.idx(x, y, z);
    return this.walkCost[index] !== IMPASSABLE && this.buildingBlocks[index] === 0;
  }

  /**
   * Whether goods may rest on this cell.
   *
   * A strictly narrower question than passability — a colonist can wade a ford but must
   * not leave a crate in it. Keep the two apart at every call site.
   */
  isStorable(x: number, y: number, z: number = GROUND_LEVEL): boolean {
    return this.inBounds(x, y, z) && this.isStorableAt(this.idx(x, y, z));
  }

  isStorableAt(index: number): boolean {
    return TERRAIN_DEFS[this.terrain[index]].storable && this.buildingBlocks[index] === 0;
  }
}
