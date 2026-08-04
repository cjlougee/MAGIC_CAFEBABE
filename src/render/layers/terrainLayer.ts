/**
 * Draws the isometric tile grid.
 *
 * Uses a recycled sprite pool sized to the viewport rather than one sprite per map
 * cell or a pre-baked render texture per chunk. A 128x128 map fully baked is tens of
 * megabytes of VRAM and grows quadratically with map size; a viewport pool is bounded
 * by screen area instead, so it costs the same at 128x128 as at 500x500.
 *
 * **Draw order is load-bearing.** Tiles with height overlap their neighbours, so this
 * is a painter's algorithm: row-major iteration (y outer, x inner) is a valid
 * back-to-front order, because the only tiles whose sprites can cover tile (x, y) are
 * (x+1, y) and (x, y+1) — both later in that walk. Pixi draws children in index order
 * and the pool is always filled from index 0 in iteration order, so the ordering holds
 * for free. If you ever iterate this loop differently, tall terrain will render through
 * whatever stands in front of it.
 */

import { Container, Sprite } from 'pixi.js';
import { TERRAIN_DEFS } from '../../sim/defs/terrain';
import { makeNoise2D } from '../../sim/world/noise';
import type { TileMap } from '../../sim/world/tilemap';
import type { ArtProvider } from '../art/artProvider';
import { terrainHeight, variantForCell } from '../art/terrainArt';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/**
 * Darkest the tint field may push a tile, as a fraction of full brightness. Tint can
 * only multiply, so it darkens and never brightens — the field runs from this value
 * up to 1.0.
 */
const TINT_FLOOR = 0.86;

/** Tiles per unit of tint noise. Large, so patches read as terrain rather than static. */
const TINT_SCALE = 1 / 15;

export class TerrainLayer {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];
  private lastKey = '';

  /** Per-cell brightness byte. Rebuilt when the world changes. */
  private tintField: Uint8Array | null = null;
  private tintSeed = Number.NaN;

  constructor(private readonly art: ArtProvider) {
    // Nothing in this layer responds to input, and skipping the hit-test walk over
    // several thousand sprites is a measurable win.
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
  }

  update(map: TileMap, seed: number, view: TileRect, visible: WorldRect): void {
    this.ensureTintField(map, seed);

    // Seed is part of the key so regenerating the world invalidates the cache. World
    // pixel positions don't depend on zoom (the container scales), but the visible
    // rect does, so zooming changes the key too.
    const key = `${seed}:${view.x0},${view.y0},${view.x1},${view.y1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const tint = this.tintField!;
    let used = 0;

    for (let y = view.y0; y <= view.y1; y++) {
      for (let x = view.x0; x <= view.x1; x++) {
        const index = map.idx(x, y);
        const terrain = map.terrainAt(index);
        const height = terrainHeight(terrain);
        const pos = tileToWorld(x, y);

        // Reject the bounding box's corners, which the diamond viewport never covers.
        if (pos.x + HALF_TILE_W < visible.x0 || pos.x - HALF_TILE_W > visible.x1) continue;
        if (pos.y + HALF_TILE_H < visible.y0 || pos.y - HALF_TILE_H - height > visible.y1) continue;

        const sprite = this.spriteAt(used++);
        sprite.texture = this.art.terrain(terrain, variantForCell(x, y, seed, TERRAIN_DEFS[terrain].variants));
        // The texture's base diamond sits `height` pixels down from its top edge, so
        // offsetting by height puts the tile's footprint on the ground plane.
        sprite.position.set(pos.x - HALF_TILE_W, pos.y - HALF_TILE_H - height);

        const level = tint[index];
        sprite.tint = (level << 16) | (level << 8) | level;
        sprite.visible = true;
      }
    }

    for (let i = used; i < this.pool.length; i++) {
      this.pool[i].visible = false;
    }
  }

  /** Invalidates the cached view so the next update redraws unconditionally. */
  invalidate(): void {
    this.lastKey = '';
  }

  /**
   * Builds the low-frequency brightness field that keeps large areas from reading as
   * flat colour. Independent of terrain type, so a patch of shade crossing a
   * grass/dirt boundary carries across it — which is what makes it look like light
   * rather than like tinted tiles.
   */
  private ensureTintField(map: TileMap, seed: number): void {
    if (this.tintSeed === seed && this.tintField?.length === map.size) return;

    const noise = makeNoise2D(seed ^ 0x1a2b3c4d);
    const field = new Uint8Array(map.size);
    const floor = Math.round(TINT_FLOOR * 255);
    const span = 255 - floor;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        field[map.idx(x, y)] = floor + Math.round(noise(x * TINT_SCALE, y * TINT_SCALE, 3) * span);
      }
    }

    this.tintField = field;
    this.tintSeed = seed;
    this.lastKey = '';
  }

  private spriteAt(index: number): Sprite {
    let sprite = this.pool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.eventMode = 'none';
      this.pool[index] = sprite;
      this.container.addChild(sprite);
    }
    return sprite;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool.length = 0;
    this.tintField = null;
  }
}
