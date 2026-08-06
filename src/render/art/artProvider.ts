/**
 * The seam between "how art is made" and "what draws it".
 *
 * Every layer asks this for textures by key and never constructs art itself. Today
 * every texture is generated procedurally; the point of the indirection is that a
 * real artist's atlas can be dropped in behind this interface later without a single
 * change to layer or gameplay code.
 */

import { Graphics, Texture, type Renderer } from 'pixi.js';
import type { BuildingId } from '../../sim/defs/buildings';
import type { ItemDefId } from '../../sim/defs/items';
import { TERRAIN_DEFS, type TerrainId } from '../../sim/defs/terrain';
import type { PawnAppearance } from '../../sim/entities/pawn';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { buildBuildingGraphics } from './buildingArt';
import { buildItemGraphics } from './itemArt';
import { buildPlantGraphics } from './plantArt';
import {
  buildMineMarkerGraphics,
  buildPreviewGraphics,
  buildStockpileGraphics,
} from './overlayArt';
import { Palette } from './palette';
import { appearanceKey, buildPawnGraphics } from './pawnArt';
import { buildTerrainGraphics } from './terrainArt';

const SELECTION_KEY = 'ui:selection';

export class ArtProvider {
  private readonly cache = new Map<string, Texture>();

  constructor(private readonly renderer: Renderer) {}

  /** Texture for one terrain variant. Generated on first request, then cached. */
  terrain(id: TerrainId, variant: number): Texture {
    return this.cached(`terrain:${id}:${variant}`, () => buildTerrainGraphics(id, variant));
  }

  /** Texture for a colonist. Keyed by appearance, so identical pawns share one. */
  pawn(appearance: PawnAppearance): Texture {
    return this.cached(appearanceKey(appearance), () => buildPawnGraphics(appearance));
  }

  /** The diamond ring drawn under a selected pawn. */
  selectionRing(): Texture {
    return this.cached(SELECTION_KEY, () => {
      const g = new Graphics();
      const w = HALF_TILE_W - 4;
      const h = HALF_TILE_H - 2;
      g.poly([HALF_TILE_W, HALF_TILE_H - h, HALF_TILE_W + w, HALF_TILE_H, HALF_TILE_W, HALF_TILE_H + h, HALF_TILE_W - w, HALF_TILE_H])
        .stroke({ width: 2, color: Palette.relic, alignment: 0.5 });
      return g;
    });
  }

  /** Texture for a pile of one kind of item. */
  item(def: ItemDefId): Texture {
    return this.cached(`item:${def}`, () => buildItemGraphics(def));
  }

  /** Texture for a plant at a given growth stage. */
  plant(stage: number): Texture {
    return this.cached(`plant:${stage}`, () => buildPlantGraphics(stage));
  }

  building(def: BuildingId): Texture {
    return this.cached(`building:${def}`, () => buildBuildingGraphics(def));
  }

  stockpileTile(): Texture {
    return this.cached('ui:stockpile', buildStockpileGraphics);
  }

  mineMarker(): Texture {
    return this.cached('ui:mine', buildMineMarkerGraphics);
  }

  previewTile(): Texture {
    return this.cached('ui:preview', buildPreviewGraphics);
  }

  /** Generates every terrain texture up front, so panning never stutters mid-drag. */
  warmUpTerrain(): void {
    for (const def of TERRAIN_DEFS) {
      for (let variant = 0; variant < def.variants; variant++) {
        this.terrain(def.id, variant);
      }
    }
  }

  private cached(key: string, build: () => Graphics): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const graphics = build();
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
    // Nearest keeps edges crisp when zoomed in; bilinear would smear the deliberately
    // chunky pixel detail into mush.
    texture.source.scaleMode = 'nearest';
    graphics.destroy();

    this.cache.set(key, texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.cache.values()) texture.destroy(true);
    this.cache.clear();
  }
}
