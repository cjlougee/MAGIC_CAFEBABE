/**
 * The click animation: four darts converge on the point you ordered.
 *
 * The old-game convention — a cursor that *does something* when you click, rather than a
 * static arrow and a hope that the game heard you. Four arrows sweep in from the corners
 * along an arc, and once they meet, their tails are drawn into the same point and vanish.
 *
 * Drawn on a plain 2D canvas rather than in Pixi, because it belongs to the **cursor**,
 * not to the world: it plays at the point on screen the player clicked and must not pan,
 * zoom, or scale with the map.
 *
 * `drawOrderCursor` is a pure function of `t` on purpose. An animation cannot be checked
 * by taking a screenshot and hoping to catch it — the whole thing is over in under half a
 * second. As a function of time it can be sampled into a filmstrip and inspected frame by
 * frame in one still image.
 */

import { cssColor, Palette } from './palette';

/** Whole animation, in milliseconds. Long enough to read, short enough not to nag. */
export const ORDER_CURSOR_MS = 420;

/** Canvas the animation is drawn into, in CSS pixels. */
export const ORDER_CURSOR_SIZE = 56;

/** Darts, one per corner. */
const ARROWS = 4;

/** Fraction of the timeline the tail lags the head by. This is the "stretch". */
const TAIL_LAG = 0.28;

/** When the head finishes arriving, as a fraction of the timeline. */
const HEAD_ARRIVES = 0.62;

/** Segments each dart is sampled into. Enough that the arc reads as a curve. */
const SEGMENTS = 12;

/**
 * The two shapes this can take.
 *
 * `sweep` is how far the path bends on the way in: the angle is offset most when a dart
 * is furthest out and unwinds to its true diagonal as it arrives. `profile` is the
 * half-width along the dart, from 0 at the tip to 1 at the back — which is the whole
 * difference between a petal and an arrow.
 */
interface CursorStyle {
  readonly sweep: number;
  readonly maxWidth: number;
  readonly profile: (s: number) => number;
}

const STYLES: Record<'converge' | 'arrows', CursorStyle> = {
  /**
   * Four curved blades drawn into the point, like something converging rather than
   * something thrown. The heavy sweep is the character of it: at speed the four read as
   * one turning motion that closes on the target.
   */
  converge: {
    sweep: Math.PI * 0.3,
    maxWidth: 0.055,
    profile: (s) => Math.sin(Math.PI * Math.pow(s, 0.62)),
  },

  /**
   * Literal arrows: a point, barbs behind it, then a shaft tapering away. Far less
   * sweep, because a barbed head already says which way it is travelling and the curve
   * then fights it — with both, the arrows read as being flung sideways.
   */
  arrows: {
    sweep: Math.PI * 0.1,
    maxWidth: 0.085,
    profile: (s) => {
      const BARB = 0.24;
      const SHOULDER = 0.32;
      const SHAFT = 0.34;
      if (s < BARB) return s / BARB;
      if (s < SHOULDER) return 1 - ((s - BARB) / (SHOULDER - BARB)) * (1 - SHAFT);
      return SHAFT * (1 - (s - SHOULDER) / (1 - SHOULDER));
    },
  },
};

export type OrderCursorStyle = keyof typeof STYLES;

/** Which one the game uses. */
export const ORDER_CURSOR_STYLE: OrderCursorStyle = 'converge';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Cubic ease-out: fast where the eye is caught, gentle where it stops. */
function easeOut(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/**
 * Draws one frame at normalised time `t`.
 *
 * Clears the canvas first, so a caller can drive it straight from a clock without any
 * bookkeeping of its own.
 */
export function drawOrderCursor(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  style: OrderCursorStyle = ORDER_CURSOR_STYLE,
): void {
  ctx.clearRect(0, 0, size, size);
  if (t <= 0 || t >= 1) return;

  const cx = size / 2;
  const cy = size / 2;
  const shape = STYLES[style];
  const reach = size * 0.46;
  const maxHalfWidth = size * shape.maxWidth;

  const headD = reach * (1 - easeOut(clamp01(t / HEAD_ARRIVES)));
  const tailD = reach * (1 - easeOut(clamp01((t - TAIL_LAG) / (1 - TAIL_LAG))));

  // Holds full strength while the darts travel, then goes out with the tails.
  const alpha = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
  ctx.fillStyle = cssColor(Palette.danger, alpha);

  for (let arrow = 0; arrow < ARROWS; arrow++) {
    const base = Math.PI / 4 + (arrow * Math.PI) / 2;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];

    for (let step = 0; step <= SEGMENTS; step++) {
      const s = step / SEGMENTS;
      const distance = headD + (tailD - headD) * s;
      // Unwinds toward the true diagonal as the dart closes on the centre.
      const angle = base + shape.sweep * (distance / reach);

      const px = cx + Math.cos(angle) * distance;
      const py = cy + Math.sin(angle) * distance;
      const w = maxHalfWidth * shape.profile(clamp01(s));

      // Perpendicular to the direction of travel, so the shaft stays an even thickness
      // around the bend instead of pinching on the inside of it.
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);

      left.push([px + nx * w, py + ny * w]);
      right.push([px - nx * w, py - ny * w]);
    }

    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [x, y] of left.slice(1)) ctx.lineTo(x, y);
    for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
}
