/**
 * The bloom on relic tech.
 *
 * Bulkheads carry a lit strip across both vertical faces — the most saturated thing in
 * the terrain set — and plating carries the occasional panel light. Both currently read
 * as *painted teal* rather than as anything switched on. A soft additive halo is the
 * difference between a colour and a light source, and it is what makes the fallen
 * civilisation feel like it still has power in it rather than being decorated rubble.
 *
 * Deliberately not point lights: this does not go through `lightRadius` and lights
 * nothing. It is a bloom on the emitter itself, which is why it survives daylight at
 * reduced strength — a lit panel is still lit at noon, it just stops mattering.
 *
 * Cached the way `GroundLayer` is, on view and map revision, because it walks the
 * viewport rather than a handful of entities. Only the alpha changes per frame.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { Terrain, type TerrainId } from '../../sim/defs/terrain';
import type { TileMap } from '../../sim/world/tilemap';
import { buildGlowTexture } from '../art/glow';
import { Palette } from '../art/palette';
import { terrainHeight } from '../art/terrainArt';
import type { TileRect, WorldRect } from '../camera/camera';
import { HALF_TILE_H, HALF_TILE_W, TILE_W } from '../constants';
import { tileToWorld } from '../iso';

const GLOW_RADIUS = 64;

/** How wide each emitter's halo is, in tiles. Tight — this is bloom, not illumination. */
const SPAN_TILES = 1.5;

/**
 * How much of the bloom survives full daylight.
 *
 * Not zero, unlike the campfire. A fire at noon genuinely is invisible; a lit panel is
 * still lit, and having relic tech switch off every morning would read as a bug.
 */
const DAYLIGHT_FLOOR = 0.28;

/** Per-terrain emissive strength. Anything absent does not glow. */
const EMISSIVE: Partial<Record<TerrainId, number>> = {
  // The lit strip wraps the whole bulkhead, so it earns the strong one.
  [Terrain.RuinWall]: 1,
  // Only some plating tiles carry a panel light, so the field as a whole stays faint
  // rather than turning a ruin floor into a lightbox.
  [Terrain.RuinFloor]: 0.32,
};

export class EmissiveLayer {
  readonly container = new Container();

  private texture: Texture | null = null;
  private readonly pool: Sprite[] = [];
  private lastKey = '';

  constructor() {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
  }

  /** `daylight` is 0 at full night, 1 at midday. Cheap — one property per frame. */
  setDaylight(daylight: number): void {
    this.container.alpha = DAYLIGHT_FLOOR + (1 - DAYLIGHT_FLOOR) * (1 - daylight);
  }

  update(map: TileMap, view: TileRect, visible: WorldRect): void {
    const key = `${map.revision}:${view.x0},${view.y0},${view.x1},${view.y1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.texture ??= buildGlowTexture({ radius: GLOW_RADIUS, peak: 0.5, falloff: 2.2 });

    let used = 0;

    for (let y = view.y0; y <= view.y1; y++) {
      for (let x = view.x0; x <= view.x1; x++) {
        const terrain = map.terrainAt(map.idx(x, y));
        const strength = EMISSIVE[terrain];
        if (strength === undefined) continue;

        const pos = tileToWorld(x, y);
        if (pos.x + HALF_TILE_W < visible.x0 || pos.x - HALF_TILE_W > visible.x1) continue;
        if (pos.y + HALF_TILE_H < visible.y0 || pos.y - HALF_TILE_H > visible.y1) continue;

        const sprite = this.spriteAt(used++);
        const scale = (SPAN_TILES * TILE_W) / (GLOW_RADIUS * 2);
        // Foreshortened like the light pools, because this sits on a surface in the
        // world rather than floating in front of the camera.
        sprite.scale.set(scale, scale * 0.6);
        // Raised terrain wears its strip partway up the face, so the halo rides with it
        // instead of pooling on the ground the bulkhead is standing on.
        sprite.position.set(pos.x, pos.y - terrainHeight(terrain) * 0.5);
        sprite.alpha = strength;
        sprite.visible = true;
      }
    }

    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  /** Forces a rebuild — used when the world is replaced under us. */
  invalidate(): void {
    this.lastKey = '';
  }

  private spriteAt(index: number): Sprite {
    let sprite = this.pool[index];
    if (!sprite) {
      sprite = new Sprite(this.texture ?? Texture.WHITE);
      sprite.anchor.set(0.5);
      // Additive, so a dense ruin reads as brighter rather than as one flat wash.
      sprite.blendMode = 'add';
      sprite.eventMode = 'none';
      sprite.tint = Palette.relic;
      this.pool[index] = sprite;
      this.container.addChild(sprite);
    }
    if (this.texture) sprite.texture = this.texture;
    return sprite;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.texture?.destroy(true);
    this.pool.length = 0;
  }
}
