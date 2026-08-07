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
import { Edge } from '../art/contactShadow';
import { terrainHeight, variantForCell } from '../art/terrainArt';
import type { TerrainTintField } from '../art/terrainTint';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/** Whether a cell holds something with vertical extent — rock, a bulkhead, a wall. */
function isRaised(map: TileMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const index = map.idx(x, y);
  return terrainHeight(map.terrainAt(index)) > 0 || map.buildingBlocks[index] !== 0;
}

/**
 * Which of this tile's edges abut something raised — and should therefore be shaded.
 *
 * **Only the two edges that rise *behind* the tile on screen.** Shading all four made a
 * wall look sunk into a pit: the ground was darkened on its near sides too, and a ring of
 * shadow around a standing object reads as a hole around it rather than a shadow beside
 * it. The near neighbours are drawn in front of this tile anyway, so shading against them
 * was decorating ground the block already covers.
 *
 * Buildings count as well as terrain, so a stone wall beds into the floor exactly the way
 * a cliff does — otherwise the thing the player *built* is the one thing in the scene
 * still floating.
 */
function contactMask(map: TileMap, x: number, y: number): number {
  let mask = 0;
  if (isRaised(map, x - 1, y)) mask |= Edge.NW;
  if (isRaised(map, x, y - 1)) mask |= Edge.NE;
  return mask;
}

export class GroundLayer {
  readonly container = new Container();
  /** Tiles, then the shading that seats them — two children, so the order is fixed. */
  private readonly tiles = new Container();
  private readonly shading = new Container();
  private readonly pool: Sprite[] = [];
  private readonly shadowPool: Sprite[] = [];
  private lastKey = '';

  constructor(
    private readonly art: ArtProvider,
    private readonly tint: TerrainTintField,
  ) {
    // Nothing here responds to input, and skipping the hit-test walk over several
    // thousand sprites is a measurable win.
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
    this.tiles.eventMode = 'none';
    this.shading.eventMode = 'none';
    // Separate containers rather than one pool: the shading must draw over every tile,
    // and sharing a pool would interleave them in whatever order the pools happened to
    // grow.
    this.container.addChild(this.tiles);
    this.container.addChild(this.shading);
  }

  update(map: TileMap, seed: number, view: TileRect, visible: WorldRect): void {
    // Seed invalidates on world regeneration; revision invalidates when terrain changes
    // under us — mining a rock turns it into gravel, and without that term the cached
    // layer keeps showing the world as it was and a hole appears where the rock stood.
    // World positions don't depend on zoom (the container scales), but the visible rect
    // does, so zooming changes the key too.
    const key = `${seed}:${map.revision}:${view.x0},${view.y0},${view.x1},${view.y1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    let used = 0;
    let shaded = 0;

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

        // Only tiles that actually touch something raised pay for a second sprite, which
        // in open country is almost none of them.
        const mask = contactMask(map, x, y);
        if (mask === 0) continue;

        const shadow = this.shadowAt(shaded++);
        shadow.texture = this.art.contactShadow(mask);
        shadow.position.set(pos.x - HALF_TILE_W, pos.y - HALF_TILE_H);
        shadow.visible = true;
      }
    }

    for (let i = used; i < this.pool.length; i++) {
      this.pool[i].visible = false;
    }
    for (let i = shaded; i < this.shadowPool.length; i++) {
      this.shadowPool[i].visible = false;
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
      this.tiles.addChild(sprite);
    }
    return sprite;
  }

  private shadowAt(index: number): Sprite {
    let sprite = this.shadowPool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.eventMode = 'none';
      this.shadowPool[index] = sprite;
      this.shading.addChild(sprite);
    }
    return sprite;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.pool.length = 0;
    this.shadowPool.length = 0;
  }
}
