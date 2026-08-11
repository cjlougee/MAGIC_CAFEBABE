/**
 * The seam between "how art is made" and "what draws it".
 *
 * Every layer asks this for textures by key and never constructs art itself. Today
 * every texture is generated procedurally; the point of the indirection is that a
 * real artist's atlas can be dropped in behind this interface later without a single
 * change to layer or gameplay code.
 */

import { Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import type { BuildingId } from '../../sim/defs/buildings';
import type { ItemDefId } from '../../sim/defs/items';
import { TERRAIN_DEFS, type TerrainId } from '../../sim/defs/terrain';
import type { PawnAppearance } from '../../sim/entities/pawn';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { GROUND_LEVEL } from '../../sim/core/position';
import { footprintOfBuilding, sizeOf, type Rotation } from '../../sim/world/footprint';
import { footprintBounds } from '../iso';
import { BUILDING_HEIGHT, buildBuildingDrawList, buildBuildingGraphics, buildSiteGraphics } from './buildingArt';
import { isModelled } from './model/buildingModels';
import { rasterize } from './raster/raster';
import { textureFromRaster } from './raster/toTexture';
import { buildContactShadow } from './contactShadow';
import { buildItemGraphics } from './itemArt';
import { buildPlantGraphics } from './plantArt';
import { buildTilePulse } from './tilePulse';
import {
  buildDeconstructMarkerGraphics,
  buildMineMarkerGraphics,
  buildPreviewGraphics,
  buildStockpileGraphics,
} from './overlayArt';
import { Palette } from './palette';
import {
  appearanceKey,
  buildPawnGraphics,
  buildSleepingPawnGraphics,
  PAWN_ASLEEP_H,
  PAWN_ASLEEP_W,
  sleepingKey,
} from './pawnArt';
import { buildTerrainGraphics, terrainHeight } from './terrainArt';

const SELECTION_KEY = 'ui:selection';

export class ArtProvider {
  private readonly cache = new Map<string, Texture>();

  constructor(private readonly renderer: Renderer) {}

  /**
   * Texture for one terrain variant. Generated on first request, then cached.
   *
   * The frame is stated, not inferred. Cropping to the Graphics' bounds means any mark
   * that strays outside the tile silently makes the texture bigger, and since the layers
   * position tiles assuming an exact `TILE_W x (TILE_H + height)`, a bigger texture draws
   * the tile *offset* — which shows up as dark seams between tiles rather than as
   * anything resembling its cause. Grass shipped exactly that: its blades are the only
   * marks that extend upward, they overshot the top vertex by a pixel or two, and every
   * grass tile drew low enough to leave a gap above it.
   */
  terrain(id: TerrainId, variant: number): Texture {
    const frame = new Rectangle(0, 0, TILE_W, TILE_H + terrainHeight(id));
    return this.cached(`terrain:${id}:${variant}`, () => buildTerrainGraphics(id, variant), frame);
  }

  /** Texture for a colonist. Keyed by appearance, so identical pawns share one. */
  pawn(appearance: PawnAppearance): Texture {
    return this.cached(appearanceKey(appearance), () => buildPawnGraphics(appearance));
  }

  /**
   * The same colonist, asleep and lying along a bed.
   *
   * A stated frame, like terrain and buildings, because `ObjectLayer` anchors it by
   * `PAWN_ASLEEP_GROUND_Y` — a sprite cropped to its ink would sink into the bed.
   */
  pawnAsleep(appearance: PawnAppearance, rotation: Rotation): Texture {
    const frame = new Rectangle(0, 0, PAWN_ASLEEP_W, PAWN_ASLEEP_H);
    return this.cached(
      sleepingKey(appearance, rotation),
      () => buildSleepingPawnGraphics(appearance, rotation),
      frame,
    );
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

  /**
   * A tile that glows from its middle out, tinted by whatever is pulsing it.
   *
   * Not through `cached()`: that path renders a Graphics with nearest sampling, and this
   * is a soft gradient. Nearest would band it — the same reason `contactShadow` sits
   * outside that path.
   */
  tilePulse(): Texture {
    const key = 'ui:tilePulse';
    const existing = this.cache.get(key);
    if (existing) return existing;

    const texture = buildTilePulse();
    this.cache.set(key, texture);
    return texture;
  }

  /** Texture for a pile of one kind of item. */
  item(def: ItemDefId): Texture {
    return this.cached(`item:${def}`, () => buildItemGraphics(def));
  }

  /** Texture for a plant at a given growth stage. */
  plant(stage: number): Texture {
    return this.cached(`plant:${stage}`, () => buildPlantGraphics(stage));
  }

  /**
   * Texture for a structure, in the orientation it was placed.
   *
   * The frame is stated rather than inferred, because `generateTexture` otherwise crops
   * to whatever the Graphics happened to draw — and `ObjectLayer` positions every
   * building as though its texture were exactly its footprint's bounding box anchored at
   * the top-left. A structure that doesn't paint into all four corners would come out
   * smaller and land shifted up and left, which is precisely how the campfire first
   * appeared as a small square in the corner of its tile.
   *
   * The frame now comes from `footprintBounds` rather than being `TILE_W` by assumption,
   * and **rotation is part of the cache key** — two rotations of a bed are two different
   * pictures, and sharing one entry would draw every bed the way the first one placed
   * happened to face.
   */
  building(def: BuildingId, rotation: Rotation = 0, locked = false): Texture {
    const { w, h } = sizeOf(footprintOfBuilding(def), rotation);
    const bounds = footprintBounds(0, 0, w, h, GROUND_LEVEL, BUILDING_HEIGHT[def]);
    // Locked is in the key for the same reason rotation is: it is a different picture,
    // and sharing one entry would draw every door the way the first one drawn happened
    // to be set.
    const key = `building:${def}:${rotation}:${locked ? 'locked' : 'open'}`;

    /*
     * Modelled structures are rasterized here on the CPU rather than handed to the GPU.
     *
     * Not an optimisation — the opposite. It buys **per-pixel** work that a vector fill
     * cannot express at all: surface texture, occlusion in the creases, a one-pixel bevel
     * along a lit edge. That is the measured difference between five tones on a bedroll
     * and fifty on a bed, and it is why the detail looked basic before.
     *
     * It also closes the harness's last gap. `tests/art.test.ts` measures this exact
     * buffer, so what is asserted is what is uploaded — not a re-render of the same
     * instructions that could differ at the edges and pass anyway.
     */
    if (isModelled(def)) {
      const existing = this.cache.get(key);
      if (existing) return existing;

      const raster = rasterize(buildBuildingDrawList(def, rotation, locked), bounds.width, bounds.height);
      const texture = textureFromRaster(raster);
      this.cache.set(key, texture);
      return texture;
    }

    const frame = new Rectangle(0, 0, bounds.width, bounds.height);
    return this.cached(key, () => buildBuildingGraphics(def, rotation, locked), frame);
  }

  /** A blueprint or part-built frame, at one of a few progress stages. */
  site(stage: number): Texture {
    return this.cached(`site:${stage}`, () => buildSiteGraphics(stage));
  }

  stockpileTile(): Texture {
    return this.cached('ui:stockpile', buildStockpileGraphics);
  }

  mineMarker(): Texture {
    return this.cached('ui:mine', buildMineMarkerGraphics);
  }

  deconstructMarker(): Texture {
    return this.cached('ui:deconstruct', buildDeconstructMarkerGraphics);
  }

  /**
   * Shading for a ground tile that abuts something raised, keyed by which edges do.
   *
   * Built through the cache like everything else, but *not* through `cached()`: that path
   * generates from a Graphics through the renderer with nearest sampling, and this is a
   * soft gradient drawn on a canvas. Nearest would band it.
   */
  contactShadow(mask: number): Texture {
    const key = `ui:contact:${mask}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const texture = buildContactShadow(mask);
    this.cache.set(key, texture);
    return texture;
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

  private cached(key: string, build: () => Graphics, frame?: Rectangle): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const graphics = build();
    const texture = this.renderer.generateTexture({
      target: graphics,
      resolution: 1,
      // Given explicitly by callers whose layer assumes a fixed footprint; omitted where
      // the art's own bounds are the footprint (items, plants, pawns carry their own
      // anchor constants).
      frame,
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
