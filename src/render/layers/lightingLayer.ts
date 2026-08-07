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

import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import { buildingDef } from '../../sim/defs/buildings';
import type { World } from '../../sim/world/world';
import { mixColors, Palette } from '../art/palette';
import { TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/** How far toward night tint we go at full dark. Below 1 so night stays playable. */
const MAX_NIGHT_STRENGTH = 0.72;

/** Rings in the generated glow texture. More is smoother and costs nothing at runtime. */
const GLOW_STEPS = 24;

/** Radius of the glow texture in pixels. Scaled per-emitter to its own light radius. */
const GLOW_TEXTURE_RADIUS = 128;

/**
 * A soft radial falloff, built once.
 *
 * Concentric rings rather than a real gradient fill: it is generated a single time into a
 * texture, so the crude method is invisible and the dependency-free version is simpler to
 * reason about. Squared falloff, because linear reads as a flat disc with an edge.
 */
function buildGlowTexture(renderer: Renderer): Texture {
  const g = new Graphics();

  for (let i = GLOW_STEPS; i > 0; i--) {
    const t = i / GLOW_STEPS;
    g.circle(GLOW_TEXTURE_RADIUS, GLOW_TEXTURE_RADIUS, GLOW_TEXTURE_RADIUS * t).fill({
      color: 0xffffff,
      alpha: (1 - t) * (1 - t) * 0.14,
    });
  }

  const texture = renderer.generateTexture(g);
  g.destroy();
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
  updateEmitters(world: World, daylight: number, renderer: Renderer): void {
    const darkness = 1 - daylight;
    this.glow.visible = darkness > 0.02;
    if (!this.glow.visible) {
      this.hideFrom(0);
      return;
    }

    this.glowTexture ??= buildGlowTexture(renderer);

    let used = 0;
    for (const building of world.buildings.values()) {
      const radius = buildingDef(building.def).lightRadius;
      if (radius <= 0) continue;

      const at = tileToWorld(building.pos.x, building.pos.y, building.pos.z);
      const sprite = this.spriteAt(used++);
      // Radius is in cells; a tile is TILE_W wide, so this is the lit span in pixels.
      const scale = (radius * TILE_W) / GLOW_TEXTURE_RADIUS;
      sprite.scale.set(scale, scale * 0.5);
      sprite.position.set(at.x, at.y);
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
