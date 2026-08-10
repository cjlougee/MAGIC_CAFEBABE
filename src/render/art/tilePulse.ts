/**
 * A tile that glows from the middle out, for the order-target pulse.
 *
 * The first version was a flat-filled diamond fading its alpha as a whole, which reads as
 * a coloured card laid on the ground rather than as something happening *at* a point.
 * A concentric falloff — bright at the centre, gone by the rim — is the same idea as the
 * light diffusion in `glow.ts`, and it makes the pulse look like it belongs to the tile's
 * middle rather than to its edges.
 *
 * Built on a canvas rather than through `ArtProvider.cached()` for the reason the glow and
 * the contact shadow are: that path generates from a Graphics with nearest sampling, and
 * nearest steps a gradient into exactly the contour rings a gradient exists to avoid.
 */

import { Texture } from 'pixi.js';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';

/** Stops across the curve. Enough that the shape survives interpolation between them. */
const STOPS = 24;

/**
 * Falloff exponent. Higher clings tighter to the centre.
 *
 * Squared, matching the contact shadow: linear leaves a visible disc with a hard-ish rim
 * inside a diamond that has its own hard edge, and the two outlines fight.
 */
const FALLOFF = 2;

/**
 * Paints the falloff into a canvas context sized to one tile.
 *
 * White, and tinted at the sprite: one texture then serves any colour a pulse might want
 * later, which is the same trick the glow uses and the reason neither has a palette
 * import. Separated from the texture wrapper so a preview harness can call it directly.
 */
export function paintTilePulse(ctx: CanvasRenderingContext2D): void {
  // Clipped to the diamond, so the glow is a tile rather than a circle sitting on one.
  // Inset by a pixel so it never bleeds onto the tiles it abuts.
  ctx.beginPath();
  ctx.moveTo(HALF_TILE_W, 1);
  ctx.lineTo(TILE_W - 1, HALF_TILE_H);
  ctx.lineTo(HALF_TILE_W, TILE_H - 1);
  ctx.lineTo(1, HALF_TILE_H);
  ctx.closePath();
  ctx.clip();

  /*
   * Squashed vertically before the gradient is drawn, so a circular falloff comes out as
   * an ellipse with the diamond's own 2:1 proportions. A true circle would reach the
   * left and right points long before the top and bottom ones, and the pulse would read
   * as wider than its tile.
   */
  ctx.translate(HALF_TILE_W, HALF_TILE_H);
  ctx.scale(1, HALF_TILE_H / HALF_TILE_W);

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, HALF_TILE_W);
  for (let i = 0; i <= STOPS; i++) {
    const t = i / STOPS;
    const alpha = (1 - t) ** FALLOFF;
    gradient.addColorStop(t, `rgba(255, 255, 255, ${alpha.toFixed(4)})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(-HALF_TILE_W, -HALF_TILE_W, TILE_W, TILE_W);
}

/** Wraps the painting into a texture. Split so the filmstrip can draw it without Pixi. */
export function buildTilePulse(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  paintTilePulse(ctx);

  const texture = Texture.from(canvas);
  // Linear, like the glow and the contact shadow: this is a soft gradient, and nearest
  // sampling would band it.
  texture.source.scaleMode = 'linear';
  return texture;
}
