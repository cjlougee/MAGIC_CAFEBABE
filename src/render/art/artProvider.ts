/**
 * The seam between "how art is made" and "what draws it".
 *
 * Every layer asks this for textures by key and never constructs art itself. Today
 * every texture is generated procedurally; the point of the indirection is that a
 * real artist's atlas can be dropped in behind this interface later without a single
 * change to layer or gameplay code.
 */

import { Texture, type Renderer } from 'pixi.js';
import { TERRAIN_DEFS, type TerrainId } from '../../sim/defs/terrain';
import { buildTerrainGraphics } from './terrainArt';

export class ArtProvider {
  private readonly cache = new Map<string, Texture>();

  constructor(private readonly renderer: Renderer) {}

  /** Texture for one terrain variant. Generated on first request, then cached. */
  terrain(id: TerrainId, variant: number): Texture {
    const key = `terrain:${id}:${variant}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const graphics = buildTerrainGraphics(id, variant);
    const texture = this.renderer.generateTexture({
      target: graphics,
      resolution: 1,
      // Antialiasing is what causes the seams between isometric tiles: a diamond's
      // sloped edge renders as half-transparent pixels, and where two tiles abut, both
      // contribute partial alpha, so the dark background shows through as an outline
      // around every tile. Hard edges make the diamonds interlock exactly — and match
      // the chunky pixel look the rest of the art is going for.
      antialias: false,
    });
    // Nearest keeps tile edges crisp when zoomed in; bilinear would smear the
    // deliberately chunky pixel detail into mush.
    texture.source.scaleMode = 'nearest';
    graphics.destroy();

    this.cache.set(key, texture);
    return texture;
  }

  /** Generates every terrain texture up front, so panning never stutters mid-drag. */
  warmUpTerrain(): void {
    for (const def of TERRAIN_DEFS) {
      for (let variant = 0; variant < def.variants; variant++) {
        this.terrain(def.id, variant);
      }
    }
  }

  destroy(): void {
    for (const texture of this.cache.values()) texture.destroy(true);
    this.cache.clear();
  }
}
