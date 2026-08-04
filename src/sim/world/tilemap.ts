/**
 * The tile grid.
 *
 * Every per-cell field is a flat typed array indexed `y * width + x`. This is where
 * simulation performance actually lives: a 250x250 map is 62,500 cells, and anything
 * allocated per-cell would dominate. Read and write through idx().
 */

import { IMPASSABLE } from '../core/constants';
import { Terrain, TERRAIN_DEFS, type TerrainId } from '../defs/terrain';

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** TerrainId per cell. */
  readonly terrain: Uint8Array;
  /** Movement cost per cell; IMPASSABLE (0) means blocked. Derived from terrain. */
  readonly walkCost: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.terrain = new Uint8Array(this.size);
    this.walkCost = new Uint8Array(this.size);
    this.terrain.fill(Terrain.Dirt);
    this.walkCost.fill(TERRAIN_DEFS[Terrain.Dirt].walkCost);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  xOf(index: number): number {
    return index % this.width;
  }

  yOf(index: number): number {
    return (index / this.width) | 0;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getTerrain(x: number, y: number): TerrainId {
    return this.terrain[this.idx(x, y)] as TerrainId;
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

  /** Sets terrain and keeps the derived walk cost in sync. */
  setTerrain(x: number, y: number, id: TerrainId): void {
    const i = this.idx(x, y);
    this.terrain[i] = id;
    this.walkCost[i] = TERRAIN_DEFS[id].walkCost;
  }

  setTerrainAt(index: number, id: TerrainId): void {
    this.terrain[index] = id;
    this.walkCost[index] = TERRAIN_DEFS[id].walkCost;
  }

  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.walkCost[this.idx(x, y)] !== IMPASSABLE;
  }
}
