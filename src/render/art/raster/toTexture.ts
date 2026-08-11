/**
 * A rasterized sprite, handed to Pixi as a texture.
 *
 * The last link in the chain that makes the harness honest: the game uploads **the same
 * bytes the tests measured**, rather than a GPU re-render of the same instructions. A
 * harness that measures an approximation of what ships can be green while the screen is
 * wrong, which is the failure mode this whole milestone exists to close.
 *
 * `nearest` for the same reason everything else here is nearest — bilinear smears the
 * deliberately chunky pixel detail into mush. See ADR 0002.
 */

import { BufferImageSource, Texture } from 'pixi.js';
import type { Raster } from './raster';

export function textureFromRaster(raster: Raster): Texture {
  const source = new BufferImageSource({
    resource: new Uint8Array(raster.rgba.buffer.slice(0)),
    width: raster.width,
    height: raster.height,
    scaleMode: 'nearest',
    // The art is drawn with hard edges on purpose: an antialiased diamond edge is
    // half-transparent, and where two tiles abut both contribute partial alpha, so the
    // background shows through as an outline around every tile.
    alphaMode: 'premultiply-alpha-on-upload',
  });

  return new Texture({ source });
}
