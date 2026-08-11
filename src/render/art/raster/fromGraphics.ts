/**
 * Pixi `Graphics` to draw list.
 *
 * The adapter that makes the harness worth building *today* rather than after the art is
 * rewritten. Every sprite in the game is already a `Graphics`, and Pixi builds one with
 * no GPU, no canvas and no DOM: `context.instructions` is the painter-ordered draw list,
 * and each shape answers `contains` / `strokeContains` itself. So terrain, pawns, plants,
 * items and overlays become measurable without a line of art changing — and the six
 * buildings can be converted one at a time instead of all at once.
 *
 * Shapes arrive already normalised to polygons, ellipses, rectangles and rounded
 * rectangles, all answering the same question. That is why one rasterizer covers the lot.
 */

import type { GraphicsContext, Matrix, ShapePrimitive } from 'pixi.js';
import type { Coverage, DrawList, Mark } from './drawList';

export interface ShapePrimitiveWithHoles {
  readonly shape: ShapePrimitive;
  readonly transform?: Matrix;
  readonly holes?: ShapePrimitiveWithHoles[];
}

/** A fill or a stroke, with its paint and its shapes. */
export interface PaintedInstruction {
  readonly stroked: boolean;
  readonly color: number;
  readonly alpha: number;
  readonly width: number;
  readonly alignment: number;
  readonly primitives: readonly ShapePrimitiveWithHoles[];
}

/** Pixi's instruction union as it really arrives, before narrowing. */
interface RawInstruction {
  readonly action: string;
  readonly data: {
    readonly style?: { color: number; alpha: number; width?: number; alignment?: number };
    readonly path?: { shapePath: { shapePrimitives: ShapePrimitiveWithHoles[] } };
  };
}

/**
 * The context's draw list, narrowed to the two actions this project's art actually uses.
 *
 * One narrowing point rather than three. `texture` and `cut` never appear here — every
 * mark is a solid fill or a stroke — and they are **skipped rather than approximated**: a
 * mark the harness silently guessed at would make it lie, which is worse than not
 * covering it.
 */
export function paintedInstructions(context: GraphicsContext): PaintedInstruction[] {
  const out: PaintedInstruction[] = [];

  for (const raw of context.instructions as unknown as RawInstruction[]) {
    if (raw.action !== 'fill' && raw.action !== 'stroke') continue;
    const { style, path } = raw.data;
    if (!style || !path) continue;

    out.push({
      stroked: raw.action === 'stroke',
      color: style.color,
      alpha: style.alpha ?? 1,
      width: style.width ?? 1,
      alignment: style.alignment ?? 0.5,
      primitives: path.shapePath.shapePrimitives,
    });
  }

  return out;
}

/**
 * Flattens a context into marks, one per primitive, in draw order.
 *
 * A single instruction can carry several primitives — a path with two sub-shapes — and
 * they are split rather than merged so the owner map can attribute a pixel to the shape
 * that actually drew it. `label` names the sprite and the index within it, because a
 * failure that says "instruction 7 is invisible" sends the reader counting draw calls.
 */
export function drawListFromGraphics(context: GraphicsContext, label = 'sprite'): DrawList {
  const marks: Mark[] = [];

  for (const ins of paintedInstructions(context)) {
    for (const prim of ins.primitives) {
      marks.push({
        coverage: coverageOf(prim, ins.stroked, ins.width, ins.alignment),
        paint: ins.color,
        alpha: ins.alpha,
        label: `${label}#${marks.length}`,
      });
    }
  }

  return marks;
}

function coverageOf(
  prim: ShapePrimitiveWithHoles,
  stroked: boolean,
  width: number,
  alignment: number,
): Coverage {
  const { shape, transform, holes } = prim;
  const b = shape.getBounds();

  // A stroke straddles the outline, so its ink reaches half the width beyond the shape's
  // own bounds. Scanning only the shape's box would clip the outer half away — and a
  // selection ring is *entirely* outer half at alignment 0.
  const pad = stroked ? width : 0;
  const local = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };

  const inShape = stroked
    ? (x: number, y: number) => shape.strokeContains(x, y, width, alignment)
    : (x: number, y: number) => shape.contains(x, y);

  const covers = holes?.length
    ? (x: number, y: number) => inShape(x, y) && !holes.some((h) => h.shape.contains(x, y))
    : inShape;

  if (!transform || isIdentity(transform)) {
    return { bounds: local, covers };
  }

  // Transformed primitives are queried in their own space, so the bounds have to be the
  // *transformed* box or the scan misses ink that moved outside it.
  return {
    bounds: transformedBounds(local, transform),
    covers: (x, y) => {
      const p = transform.applyInverse({ x, y });
      return covers(p.x, p.y);
    },
  };
}

function isIdentity(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;
}

function transformedBounds(
  box: { x: number; y: number; width: number; height: number },
  m: Matrix,
): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [cx, cy] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ]) {
    const p = m.apply({ x: cx, y: cy });
    xs.push(p.x);
    ys.push(p.y);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
