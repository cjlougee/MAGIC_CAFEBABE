/**
 * Day/night wash, and the fires that push back against it.
 *
 * Two pieces drawn in order. A screen-sized multiply sprite tinted between white (noon,
 * no effect) and a cool blue (midnight) does most of the work of making the world feel
 * alive — a static map with a ticking clock reads as a screenshot. Then a container of
 * additive glows, drawn *over* the wash, gives that darkness back locally wherever
 * something is burning.
 *
 * **The light field lives here, in `render/`, and is derived rather than stored.** Nothing
 * in the simulation cares how dark a cell is yet, so a light grid would be state with no
 * reader — computed from emitter positions each frame, it cannot fall out of step with
 * the buildings it came from and it costs the save nothing. When darkness starts slowing
 * work (and hiding people), the field moves into `sim/` and is recomputed on load, because
 * it stays a pure function of where the emitters are. See docs/design/07-production.md.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { buildingDef } from '../../sim/defs/buildings';
import { BUILDING_LIGHT } from '../art/buildingArt';
import type { World } from '../../sim/world/world';
import { mixColors, Palette } from '../art/palette';
import { TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/** How far toward night tint we go at full dark. Below 1 so night stays playable. */
const MAX_NIGHT_STRENGTH = 0.72;

/** Radius of the glow texture in pixels. Scaled per-emitter to its own light radius. */
const GLOW_TEXTURE_RADIUS = 128;

/** Stops in the falloff. Enough that the curve is sampled, not stepped. */
const GLOW_STOPS = 32;

/**
 * Brightness at the very centre.
 *
 * Below 1 on purpose. Additive blending at full strength saturates the core to white,
 * which hides the thing that is emitting the light — a campfire disappearing inside its
 * own glow. Light should reveal its source, not erase it.
 */
const GLOW_PEAK = 0.72;

/**
 * A soft radial falloff, built once.
 *
 * A real canvas gradient rather than concentric rings. The first version stacked 24
 * translucent circles, and every ring boundary was visible as a contour line — stacked
 * alpha quantises, and the eye finds edges in it immediately. A gradient interpolates in
 * the canvas at 8-bit precision, which for a soft glow is smooth.
 *
 * The curve is `(1 - t)^3`, not linear. Linear falloff reads as a flat disc with a hard
 * rim; a cubic keeps a bright core and lets the edge disappear into the dark instead of
 * ending. Sampled across many stops so the shape survives interpolation between them.
 *
 * Generated white, and tinted per-emitter — one texture serves every colour of light.
 */
function buildGlowTexture(): Texture {
  const size = GLOW_TEXTURE_RADIUS * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const gradient = ctx.createRadialGradient(
    GLOW_TEXTURE_RADIUS,
    GLOW_TEXTURE_RADIUS,
    0,
    GLOW_TEXTURE_RADIUS,
    GLOW_TEXTURE_RADIUS,
    GLOW_TEXTURE_RADIUS,
  );

  for (let i = 0; i <= GLOW_STOPS; i++) {
    const t = i / GLOW_STOPS;
    const falloff = (1 - t) ** 3 * GLOW_PEAK;
    gradient.addColorStop(t, `rgba(255, 255, 255, ${falloff.toFixed(4)})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = Texture.from(canvas);
  // Linear, unlike every other texture in the game: this one *is* a smooth gradient, and
  // the nearest-neighbour sampling that keeps the pixel art crisp would band it again.
  texture.source.scaleMode = 'linear';
  return texture;
}

export class LightingLayer {
  readonly sprite: Sprite;
  /** Additive glows, drawn above the wash. Shares the world transform. */
  readonly glow = new Container();

  private glowTexture: Texture | null = null;
  private readonly pool: Sprite[] = [];

  constructor() {
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.blendMode = 'multiply';
    this.sprite.eventMode = 'none';
    this.glow.eventMode = 'none';
  }

  /** `daylight` is 0 at full night, 1 at midday. */
  update(daylight: number, viewW: number, viewH: number): void {
    this.sprite.width = viewW;
    this.sprite.height = viewH;
    this.sprite.tint = mixColors(0xffffff, Palette.nightTint, (1 - daylight) * MAX_NIGHT_STRENGTH);
  }

  /**
   * Places a glow on every emitter.
   *
   * Faded out with the daylight, so a campfire is invisible at noon and unmistakable at
   * midnight. Nothing is drawn at all in full daylight, which is also the cheap path.
   */
  updateEmitters(world: World, daylight: number): void {
    const darkness = 1 - daylight;
    this.glow.visible = darkness > 0.02;
    if (!this.glow.visible) {
      this.hideFrom(0);
      return;
    }

    this.glowTexture ??= buildGlowTexture();

    let used = 0;
    for (const building of world.buildings.values()) {
      const radius = buildingDef(building.def).lightRadius;
      if (radius <= 0) continue;

      const at = tileToWorld(building.pos.x, building.pos.y, building.pos.z);
      const sprite = this.spriteAt(used++);
      // Radius is in cells; a tile is TILE_W wide, so this is the lit span in pixels.
      // Halved vertically because a circle of ground is an ellipse in 2:1 projection —
      // light pools on the floor, and a round glow would read as a sphere in the air.
      const scale = (radius * TILE_W) / GLOW_TEXTURE_RADIUS;
      sprite.scale.set(scale, scale * 0.5);
      sprite.position.set(at.x, at.y);
      sprite.tint = BUILDING_LIGHT[building.def] ?? Palette.firelight;
      sprite.alpha = darkness;
      sprite.visible = true;
    }

    this.hideFrom(used);
  }

  private spriteAt(index: number): Sprite {
    let sprite = this.pool[index];
    if (!sprite) {
      sprite = new Sprite(this.glowTexture ?? Texture.WHITE);
      sprite.anchor.set(0.5);
      // Additive, so overlapping fires pool their light instead of one hiding the other.
      sprite.blendMode = 'add';
      sprite.eventMode = 'none';
      this.pool[index] = sprite;
      this.glow.addChild(sprite);
    }
    if (this.glowTexture) sprite.texture = this.glowTexture;
    return sprite;
  }

  private hideFrom(used: number): void {
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  destroy(): void {
    this.sprite.destroy();
    this.glow.destroy({ children: true });
    this.glowTexture?.destroy(true);
    this.pool.length = 0;
  }
}
