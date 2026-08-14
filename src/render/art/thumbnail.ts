/**
 * A buildable, as pixels a DOM element can show.
 *
 * The architect menu was a list of words. At six entries that was merely plain; at
 * eighteen it is unusable, because "Shelf" and "Safe" are the same size and shape on a
 * button and the only way to tell what you are about to place is to place it.
 *
 * **The pixels come from the game's own draw list**, and that is the whole design of this
 * file. `buildBuildingDrawList` is what `ArtProvider` uploads to the GPU and what
 * `tests/art.test.ts` measures; rasterizing it again here costs a few hundred
 * microseconds and makes the menu incapable of disagreeing with the world. A thumbnail
 * that derived its own answer is exactly the failure that drew a colonist neatly asleep on
 * a bed in one place and lying on the floor underneath it in another — twice now, and the
 * second time the review surface was the one that was wrong.
 *
 * No GPU, no Pixi texture, no PNG encoder: `rasterize` is plain TypeScript producing
 * straight RGBA, which is exactly what `ImageData` wants. That the M12 rasterizer turns
 * out to serve a React component it was never designed for is the clearest evidence that
 * splitting "make the marks" from "put them on a screen" was the right seam.
 */

import { GROUND_LEVEL } from '../../sim/core/position';
import { buildableDef, type BuildableId } from '../../sim/defs/buildables';
import { footprintOfBuilding, sizeOf } from '../../sim/world/footprint';
import { footprintBounds } from '../iso';
import { BUILDING_HEIGHT, buildBuildingDrawList } from './buildingArt';
import type { Raster } from './raster/raster';
import { rasterize } from './raster/raster';
import { drawListFromGraphics } from './raster/fromGraphics';
import { buildTerrainGraphics, terrainHeight } from './terrainArt';
import { TILE_H, TILE_W } from '../constants';

/**
 * Cached per buildable, forever.
 *
 * There are eighteen of them and they never change within a run, so the map is a handful
 * of kilobytes and the alternative is re-rasterizing on every React render.
 */
const cache = new Map<BuildableId, Raster>();

/** The sprite for a buildable at rotation 0, as straight RGBA. */
export function buildableRaster(id: BuildableId): Raster {
  const existing = cache.get(id);
  if (existing) return existing;

  const raster = render(id);
  cache.set(id, raster);
  return raster;
}

function render(id: BuildableId): Raster {
  const result = buildableDef(id).result;

  if (result.kind === 'building') {
    const def = result.building;
    const { w, h } = sizeOf(footprintOfBuilding(def), 0);
    const box = footprintBounds(0, 0, w, h, GROUND_LEVEL, BUILDING_HEIGHT[def]);
    return rasterize(buildBuildingDrawList(def, 0, false), box.width, box.height);
  }

  /*
   * Terrain has no draw list of its own — it is still hand-drawn vectors — so it comes
   * through the same adapter the harness uses on everything that is not modelled. Variant
   * 0 every time: a thumbnail that picked a variant by hash would show a different tile
   * each run for no reason anyone could act on.
   */
  const terrain = result.terrain;
  const graphics = buildTerrainGraphics(terrain, 0);
  const list = drawListFromGraphics(graphics.context, `terrain:${terrain}`);
  return rasterize(list, TILE_W, TILE_H + terrainHeight(terrain));
}

/** Paints a buildable's sprite onto a canvas, sizing the canvas to match. */
export function drawBuildableThumbnail(canvas: HTMLCanvasElement, id: BuildableId): void {
  const raster = buildableRaster(id);
  canvas.width = raster.width;
  canvas.height = raster.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Through `createImageData` rather than `new ImageData(raster.rgba, …)`: the buffer is
  // handed straight over there, and a canvas holding a live reference to the cached raster
  // is a way for one thumbnail to be scribbled on by the next. One copy, deliberately.
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.rgba);
  ctx.putImageData(image, 0, 0);
}
