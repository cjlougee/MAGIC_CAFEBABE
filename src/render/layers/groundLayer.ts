/**
 * Draws flat terrain — everything with no vertical extent.
 *
 * Flat diamonds tessellate exactly and never overlap, so **this layer needs no depth
 * sorting at all**. That is the whole reason ground is split from raised objects: it is
 * the layer with thousands of sprites, and it is the one that can skip the sort.
 * Anything with height goes to ObjectLayer, which sorts a few hundred sprites instead.
 *
 * Uses a recycled sprite pool sized to the viewport rather than one sprite per map cell
 * or a pre-baked render texture per chunk. A fully baked map is tens of megabytes of
 * VRAM and grows quadratically with map size; a viewport pool is bounded by screen
 * area, so it costs the same at 128x128 as at 500x500.
 *
 * Reassignment only happens when the visible rect actually changes, so holding still
 * costs nothing.
 */

import { Container, Sprite } from 'pixi.js';
import { TERRAIN_DEFS } from '../../sim/defs/terrain';
import type { TileMap } from '../../sim/world/tilemap';
import type { ArtProvider } from '../art/artProvider';
import { terrainHeight, variantForCell } from '../art/terrainArt';
import type { TerrainTintField } from '../art/terrainTint';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';

export class GroundLayer {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];
  private lastKey = '';

  constructor(
    private readonly art: ArtProvider,
    private readonly tint: TerrainTintField,
  ) {
    // Nothing here responds to input, and skipping the hit-test walk over several
    // thousand sprites is a measurable win.
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
  }

  update(map: TileMap, seed: number, view: TileRect, visible: WorldRect): void {
    // Seed is part of the key so regenerating the world invalidates the cache. World
    // positions don't depend on zoom (the container scales), but the visible rect
    // does, so zooming changes the key too.
    const key = `${seed}:${view.x0},${view.y0},${view.x1},${view.y1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    let used = 0;

    for (let y = view.y0; y <= view.y1; y++) {
      for (let x = view.x0; x <= view.x1; x++) {
        const index = map.idx(x, y);
        const terrain = map.terrainAt(index);
        if (terrainHeight(terrain) > 0) continue; // ObjectLayer's business.

        const pos = tileToWorld(x, y);
        // Reject the bounding box's corners, which the diamond viewport never covers.
        if (pos.x + HALF_TILE_W < visible.x0 || pos.x - HALF_TILE_W > visible.x1) continue;
        if (pos.y + HALF_TILE_H < visible.y0 || pos.y - HALF_TILE_H > visible.y1) continue;

        const sprite = this.spriteAt(used++);
        sprite.texture = this.art.terrain(
          terrain,
          variantForCell(x, y, seed, TERRAIN_DEFS[terrain].variants),
        );
        sprite.position.set(pos.x - HALF_TILE_W, pos.y - HALF_TILE_H);
        sprite.tint = this.tint.at(index);
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
  }
}
