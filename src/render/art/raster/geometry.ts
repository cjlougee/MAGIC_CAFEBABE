/**
 * Geometry questions answered on the outline, before anything is rasterized.
 *
 * A self-intersecting polygon is the sharpest example of a bug a picture hides and a
 * number cannot: `isoCapsule` branched on the raw argument order, so rotations 2 and 3 —
 * which hand over the head end *second* — wound their outline into a bow-tie. It was
 * invisible at play zoom, unmissable on the sprite sheet, and it would have been a one
 * line assertion at any point in the two milestones it survived.
 */

import type { GraphicsContext } from 'pixi.js';
import { paintedInstructions } from './fromGraphics';

export interface PolygonFault {
  /** Index of the mark within the flattened draw list — the same numbering the raster uses. */
  readonly mark: number;
  /** The two edge indices whose interiors cross. */
  readonly edges: readonly [number, number];
  readonly points: readonly number[];
}

/** Every polygon in a sprite whose outline crosses itself. Empty is the healthy answer. */
export function selfIntersections(context: GraphicsContext): PolygonFault[] {
  const faults: PolygonFault[] = [];
  let mark = 0;

  for (const ins of paintedInstructions(context)) {
    for (const prim of ins.primitives) {
      // Only polygons can do this. An ellipse or a rounded rectangle is convex by
      // construction, and Pixi has already normalised everything into one of the four.
      const points = (prim.shape as { type: string; points?: number[] }).points;
      if (prim.shape.type === 'polygon' && points) {
        const crossing = firstCrossing(points);
        if (crossing) faults.push({ mark, edges: crossing, points });
      }
      mark++;
    }
  }

  return faults;
}

/**
 * The first pair of non-adjacent edges whose interiors properly cross.
 *
 * *Proper* crossings only. Shapes here legitimately touch at shared vertices and
 * occasionally run collinear along an edge; flagging those would make the check cry wolf
 * on art that is perfectly fine, and a check nobody trusts is worse than no check.
 */
function firstCrossing(points: readonly number[]): [number, number] | null {
  const n = points.length / 2;
  if (n < 4) return null;

  const at = (i: number): [number, number] => [points[(i % n) * 2], points[(i % n) * 2 + 1]];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex by construction; so do the first and last.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (properlyCross(at(i), at(i + 1), at(j), at(j + 1))) return [i, j];
    }
  }
  return null;
}

type P = readonly [number, number];

function cross(o: P, a: P, b: P): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function properlyCross(a1: P, a2: P, b1: P, b2: P): boolean {
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  // Strict signs on both sides: touching (a zero) is not a crossing.
  return d1 * d2 < 0 && d3 * d4 < 0;
}
