/**
 * The intermediate form every sprite passes through on its way to pixels.
 *
 * A draw list is an ordered sequence of marks, back to front — the painter's order the
 * art is already written in. Two things produce one: `fromGraphics.ts` adapts a Pixi
 * `Graphics`, so every sprite the game already has becomes measurable without being
 * rewritten; and the model layer emits one directly, so new art can shade per pixel in
 * ways a vector fill cannot express.
 *
 * Three things consume one: the runtime (a texture), the bake (a PNG), and the tests
 * (assertions). That is the whole point of the indirection — **what the tests measure is
 * what the game draws**, rather than an approximation of it.
 */

/** Screen-space box in frame pixels. Used to clip the rasterizer's scan. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Anything that can say which pixels it covers.
 *
 * Pixi's shapes satisfy this natively via `contains` / `strokeContains`, which is why
 * one rasterizer is enough for polygons, ellipses, rectangles and rounded rectangles
 * alike — see `fromGraphics.ts`.
 */
export interface Coverage {
  /** Bounds to scan. Coverage outside this is never queried, so it must not lie. */
  readonly bounds: Box;
  /** Whether this covers the pixel whose centre is (x, y). */
  covers(x: number, y: number): boolean;
}

/**
 * A colour that varies across the mark.
 *
 * The reason the draw list is not simply a list of flat fills. Ambient occlusion at a
 * contact edge, a dithered ramp across a face, and per-face surface noise are all
 * per-pixel functions; expressing them as vector fills means emitting hundreds of tiny
 * polygons, which is exactly why the current buildings are flat.
 */
export type PixelPaint = (x: number, y: number) => number;

/** One drawing operation. */
export interface Mark {
  readonly coverage: Coverage;
  /** `0xRRGGBB`, or a function of frame position. */
  readonly paint: number | PixelPaint;
  /** 0..1. Marks below show through anything under 1. */
  readonly alpha: number;
  /**
   * What this mark is, for failure messages.
   *
   * A test that says "instruction 7 draws nothing you can see" sends the reader counting
   * draw calls; one that says "bed: far leg" does not. Cheap here, and the harness exists
   * to make judging cheap.
   */
  readonly label: string;
}

export type DrawList = readonly Mark[];

/**
 * The same marks, moved.
 *
 * What lets one sprite be reviewed *on* another. A sleeping colonist is correct in
 * isolation and was still wrong on screen for two milestones, because the question is not
 * "is the pose right" but "does it land on the bed" — and answering that needs the two
 * composed at the offsets the layer actually uses.
 */
export function translate(list: DrawList, dx: number, dy: number): DrawList {
  return list.map((mark) => ({
    ...mark,
    coverage: {
      bounds: {
        x: mark.coverage.bounds.x + dx,
        y: mark.coverage.bounds.y + dy,
        width: mark.coverage.bounds.width,
        height: mark.coverage.bounds.height,
      },
      covers: (x, y) => mark.coverage.covers(x - dx, y - dy),
    },
    paint:
      typeof mark.paint === 'number'
        ? mark.paint
        : (x: number, y: number) => (mark.paint as PixelPaint)(x - dx, y - dy),
  }));
}

/** A rectangular coverage, for the handful of places that want one without Pixi. */
export function boxCoverage(box: Box): Coverage {
  return {
    bounds: box,
    covers: (x, y) =>
      x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height,
  };
}
