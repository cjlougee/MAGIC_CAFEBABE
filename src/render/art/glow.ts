/**
 * Soft radial light, as a texture.
 *
 * One definition, because there are now two things that emit — fires and relic tech —
 * and a second hand-rolled falloff would drift from the first in shape and in the
 * mistakes it makes. The campfire's original glow was concentric translucent circles,
 * and every ring boundary showed as a contour line; a canvas gradient interpolates
 * smoothly and that lesson should only have to be learned once.
 *
 * Always generated white and tinted at the sprite, so a single texture serves every
 * colour of light in the game.
 */

import { Texture } from 'pixi.js';

export interface GlowOptions {
  /** Texture radius in pixels. Sprites scale this to the span they need to light. */
  readonly radius: number;
  /**
   * Alpha at the very centre.
   *
   * Kept below 1 for anything additive: at full strength the core saturates to white and
   * erases whatever is emitting the light, which is the opposite of what light does.
   */
  readonly peak: number;
  /**
   * Falloff exponent. Higher clings tighter to the centre.
   *
   * Linear (1) reads as a flat disc with a hard rim. Above 2 the edge dissolves into the
   * dark instead of ending somewhere.
   */
  readonly falloff: number;
}

/** Stops across the curve. Enough that the shape survives interpolation between them. */
const STOPS = 32;

export function buildGlowTexture(options: GlowOptions): Texture {
  const size = options.radius * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const gradient = ctx.createRadialGradient(
    options.radius,
    options.radius,
    0,
    options.radius,
    options.radius,
    options.radius,
  );

  for (let i = 0; i <= STOPS; i++) {
    const t = i / STOPS;
    const alpha = (1 - t) ** options.falloff * options.peak;
    gradient.addColorStop(t, `rgba(255, 255, 255, ${alpha.toFixed(4)})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = Texture.from(canvas);
  // Linear, unlike almost everything else in the game: this *is* a smooth gradient, and
  // the nearest-neighbour sampling that keeps the pixel art crisp would band it.
  texture.source.scaleMode = 'linear';
  return texture;
}
