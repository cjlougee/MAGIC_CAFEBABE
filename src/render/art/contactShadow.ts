/**
 * The dark seam where flat ground meets something standing on it.
 *
 * Without it, a cliff or a wall is a shape *pasted over* the floor: the two meet at a
 * clean line with nothing between them, and the eye reads them as two flat pictures
 * rather than one place. A few pixels of shading along that join is the cheapest thing
 * in rendering that makes a scene look built rather than assembled — and unlike sprite
 * detail it costs nothing per object, because it belongs to the ground.
 *
 * Not to be confused with `render/occlusion.ts`, which fades raised *tiles* that hide a
 * pawn. This is shading; that is visibility.
 *
 * One texture per combination of shaded edges, generated on demand — at most sixteen,
 * and a colony only ever uses a handful.
 */

import { Texture } from 'pixi.js';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';

/**
 * Which edges of the diamond touch something raised.
 *
 * Named for where the neighbour appears *on screen*, not for its tile delta — in a 2:1
 * projection `x - 1` is up-and-left, and reasoning in tile axes here is how shading ends
 * up on the wrong side of everything.
 */
export const Edge = {
  /** The (x - 1) neighbour: up-left. */
  NW: 1,
  /** The (y - 1) neighbour: up-right. */
  NE: 2,
  /** The (x + 1) neighbour: down-right. */
  SE: 4,
  /** The (y + 1) neighbour: down-left. */
  SW: 8,
} as const;

export const EDGE_COMBINATIONS = 16;

/**
 * How far the shading reaches in from an edge, in pixels.
 *
 * The diamond's inradius is only about 14px, so this has to stay well under that or the
 * band spans the whole half-tile and stops reading as a join at all.
 */
const DEPTH = 9;

/** Darkness right at the join. Subtle on purpose — this should be felt, not seen. */
const STRENGTH = 0.34;

/** Stops across the falloff, for the same reason the light glow needs them. */
const STOPS = 12;

/**
 * Each edge's midpoint, its inward *normal*, and how strongly it shades.
 *
 * The normal is perpendicular to the edge — **not** the direction to the tile centre.
 * Those coincide on a square and differ on a 2:1 diamond, and using the latter was the
 * first version's bug: a canvas gradient holds its colour along lines perpendicular to
 * its axis, so an axis that wasn't the edge normal ran the bands diagonally across the
 * tile and piled them into one corner as a dark wedge.
 *
 * Weights follow the same light-from-the-upper-right that `LEFT_FACE_SHADE` and
 * `RIGHT_FACE_SHADE` assume: something rising to the up-right throws a real shadow, and
 * something rising to the up-left only darkens by contact.
 */
const EDGES = [
  { bit: Edge.NW, mx: HALF_TILE_W / 2, my: HALF_TILE_H / 2, nx: 0.447, ny: 0.894, weight: 0.55 },
  { bit: Edge.NE, mx: HALF_TILE_W * 1.5, my: HALF_TILE_H / 2, nx: -0.447, ny: 0.894, weight: 1 },
  { bit: Edge.SE, mx: HALF_TILE_W * 1.5, my: HALF_TILE_H * 1.5, nx: -0.447, ny: -0.894, weight: 1 },
  { bit: Edge.SW, mx: HALF_TILE_W / 2, my: HALF_TILE_H * 1.5, nx: 0.447, ny: -0.894, weight: 1 },
];

/**
 * Shading for one set of edges, clipped to the tile diamond.
 *
 * Canvas gradients rather than stacked shapes: overlapping translucent fills quantise
 * into visible contour lines, which is exactly the fault the campfire's glow shipped with
 * once already. Clipping to the diamond is what keeps the shading inside its own tile —
 * a soft square would bleed over the neighbours it is supposed to be seated against.
 */
export function buildContactShadow(mask: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.EMPTY;

  ctx.beginPath();
  ctx.moveTo(HALF_TILE_W, 0);
  ctx.lineTo(TILE_W, HALF_TILE_H);
  ctx.lineTo(HALF_TILE_W, TILE_H);
  ctx.lineTo(0, HALF_TILE_H);
  ctx.closePath();
  ctx.clip();

  for (const edge of EDGES) {
    if ((mask & edge.bit) === 0) continue;

    const gradient = ctx.createLinearGradient(
      edge.mx,
      edge.my,
      edge.mx + edge.nx * DEPTH,
      edge.my + edge.ny * DEPTH,
    );

    for (let i = 0; i <= STOPS; i++) {
      const t = i / STOPS;
      // Squared, so the darkness clings to the join instead of washing the whole tile.
      const alpha = (1 - t) ** 2 * STRENGTH * edge.weight;
      gradient.addColorStop(t, `rgba(0, 0, 0, ${alpha.toFixed(4)})`);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, TILE_W, TILE_H);
  }

  const texture = Texture.from(canvas);
  // Linear, like the light glow and unlike everything else: this is a soft gradient, and
  // nearest sampling would step it into the bands it exists to avoid.
  texture.source.scaleMode = 'linear';
  return texture;
}
