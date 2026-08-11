/**
 * Solids to pixels.
 *
 * A model is a handful of boxes in tile space with materials on them. This turns that into
 * a draw list: three visible faces per box, each shaded by the one sun, textured by its
 * material, darkened where forms meet, and bevelled along its lit edge.
 *
 * The four things here that a vector fill cannot do, and whose absence is the measured
 * difference between "basic" and "formed":
 *
 *  1. **Surface** — grain, coursing, weave, riveted plate. Terrain has had this since M0;
 *     buildings never did, which is the whole diagnosis.
 *  2. **Ambient occlusion** — a few pixels of shadow in a crease. What makes a mattress sit
 *     *in* a bed rather than on top of one.
 *  3. **Bevel** — one lit pixel along the sunward top edge, one dark opposite. What makes
 *     an edge read as an edge rather than a colour change.
 *  4. **A quantised ramp** — four deliberate tones per material instead of one flat fill.
 *
 * Solids are drawn **in the order the author lists them**, exactly as the hand-drawn art
 * already works (legs, then frame, then mattress, then pillow). Not sorted: an automatic
 * painter's sort over a handful of deliberately overlapping parts is a source of surprises,
 * and the author knows the answer already.
 */

import { Polygon } from 'pixi.js';
import type { Footprint } from '../../../sim/defs/buildings';
import type { Rotation } from '../../../sim/world/footprint';
import { LEVEL_HEIGHT } from '../../constants';
import { AO, BEVEL, FACE, MATERIALS, quantiseTone, type MaterialId } from '../language';
import { shade } from '../palette';
import type { DrawList, Mark } from '../raster/drawList';
import { projector, rotatePoint, type Point, type TileSpace } from './project';
import { surfaceTone } from './surface';

/**
 * A box in tile space.
 *
 * `x` and `y` in tiles across the **unrotated** footprint, `z` in storeys. A solid that
 * stays inside `0..w` and `0..h` cannot project outside the footprint's own diamonds —
 * which is containment by construction rather than by assertion.
 */
export interface Solid {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly material: MaterialId;
  /** Names the part in harness failures: "bed: far leg" rather than "mark 6". */
  readonly label?: string;
  /** Omit the top face, for a part that is entirely tucked under another. */
  readonly hideTop?: boolean;
}

export interface ModelFrame {
  /** The def's footprint, unrotated. */
  readonly footprint: Footprint;
  readonly rotation: Rotation;
  /** Frame headroom in pixels, from `BUILDING_HEIGHT`. */
  readonly rise: number;
}

type FaceKind = 'top' | 'right' | 'left';

export function renderModel(solids: readonly Solid[], frame: ModelFrame): DrawList {
  const { footprint, rotation, rise } = frame;
  const rotatedHeight = rotation % 2 === 0 ? footprint.h : footprint.w;
  const project = projector(rotatedHeight, rise);
  const marks: Mark[] = [];

  for (const solid of solids) {
    const box = rotateBox(solid, footprint, rotation);
    const label = solid.label ?? MATERIALS[solid.material].name;

    /*
     * A face thinner than a pixel is not a face.
     *
     * A pillow lying on a mattress is a slab about one pixel thick, and its two side faces
     * come out as one- and two-pixel slivers — marks that contribute nothing the eye can
     * resolve while still being marks. The harness caught exactly this on the first bake of
     * the first modelled sprite, which is the behaviour it was built for: the fix belongs
     * in the renderer, not in an allowance that would then be blind to a real sliver.
     */
    const thickness = (box.z1 - box.z0) * LEVEL_HEIGHT;

    // Sides first: the top face overdraws their upper edge, so the silhouette comes out
    // clean. The same order every hand-drawn raised thing in this project already uses.
    if (thickness >= 1) {
      marks.push(face(project, box, 'right', solid.material, `${label} right`));
      marks.push(face(project, box, 'left', solid.material, `${label} left`));
    }
    if (!solid.hideTop) {
      marks.push(face(project, box, 'top', solid.material, `${label} top`));
    }
  }

  return marks;
}

interface Box {
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
}

/** Turns an axis-aligned box by rotating its corners and re-taking the extremes. */
function rotateBox(solid: Solid, footprint: Footprint, rotation: Rotation): Box {
  const a = rotatePoint({ x: solid.x0, y: solid.y0, z: solid.z0 }, footprint, rotation);
  const b = rotatePoint({ x: solid.x1, y: solid.y1, z: solid.z1 }, footprint, rotation);
  return {
    x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
    y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y),
    z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z),
  };
}

/**
 * The four corners of one visible face, in projection order.
 *
 * Only three of a box's six faces can be seen: the top, the `+x` face (down-right on
 * screen) and the `+y` face (down-left). The other three are behind it, always, because
 * the camera never moves. That is the economy isometric buys.
 */
function cornersOf(box: Box, kind: FaceKind): TileSpace[] {
  switch (kind) {
    case 'top':
      return [
        { x: box.x0, y: box.y0, z: box.z1 },
        { x: box.x1, y: box.y0, z: box.z1 },
        { x: box.x1, y: box.y1, z: box.z1 },
        { x: box.x0, y: box.y1, z: box.z1 },
      ];
    case 'right':
      return [
        { x: box.x1, y: box.y0, z: box.z1 },
        { x: box.x1, y: box.y1, z: box.z1 },
        { x: box.x1, y: box.y1, z: box.z0 },
        { x: box.x1, y: box.y0, z: box.z0 },
      ];
    case 'left':
      return [
        { x: box.x1, y: box.y1, z: box.z1 },
        { x: box.x0, y: box.y1, z: box.z1 },
        { x: box.x0, y: box.y1, z: box.z0 },
        { x: box.x1, y: box.y1, z: box.z0 },
      ];
  }
}

function face(
  project: (p: TileSpace) => Point,
  box: Box,
  kind: FaceKind,
  materialId: MaterialId,
  label: string,
): Mark {
  const p = cornersOf(box, kind).map(project);
  const polygon = new Polygon(p.flatMap((q) => [q.x, q.y]));
  const bounds = polygon.getBounds();
  const material = MATERIALS[materialId];

  // Face-local axes. `u` runs along the first edge, `v` down the second, so a texture is
  // written once and works on a top face, a side face, and a face of any size.
  const ux = p[1].x - p[0].x;
  const uy = p[1].y - p[0].y;
  const vx = p[3].x - p[0].x;
  const vy = p[3].y - p[0].y;
  const det = ux * vy - uy * vx;

  // Pixel extents of the face's own axes, so texture density is constant across sprites
  // rather than stretching with whatever the part happens to be.
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);

  const tone = FACE[kind] + material.bias;

  return {
    label,
    alpha: 1,
    coverage: {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      covers: (x, y) => polygon.contains(x, y),
    },
    paint: (px, py) => {
      let u = 0;
      let v = 0;
      if (det !== 0) {
        const dx = px + 0.5 - p[0].x;
        const dy = py + 0.5 - p[0].y;
        u = (dx * vy - dy * vx) / det;
        v = (ux * dy - uy * dx) / det;
      }
      const clampedU = Math.max(0, Math.min(1, u));
      const clampedV = Math.max(0, Math.min(1, v));

      const offset =
        tone +
        surfaceTone(material, clampedU * uLen, clampedV * vLen) +
        occlusion(kind, clampedU, clampedV, uLen, vLen) +
        bevel(kind, clampedU, clampedV, uLen, vLen);

      // Snapped to the ladder, not applied raw: continuous shading gives a continuous
      // palette, and 150 tones across 1,740 pixels is mud rather than form.
      return shade(material.base, quantiseTone(offset));
    },
  };
}

/**
 * Shadow gathering where a form meets what is under and behind it.
 *
 * Not a depth buffer — a few boxes do not need one, and the cost of getting one wrong is
 * shadows in places nothing is casting them. Instead each face darkens toward the edges
 * that face *away* from the light and *into* whatever it is standing on, which is where
 * occlusion actually collects on shapes this simple.
 */
function occlusion(kind: FaceKind, u: number, v: number, uLen: number, vLen: number): number {
  const falloff = (distance: number): number =>
    Math.max(0, 1 - distance / AO.reach) ** 2;

  if (kind === 'top') {
    // The two edges away from the sun: the object's own upper-left, where a raised part
    // above would cut the light off.
    return AO.depth * 0.5 * Math.max(falloff(u * uLen), falloff(v * vLen));
  }

  // Side faces darken toward the ground line, which is the single cheapest thing that
  // stops an object looking like it is hovering.
  return AO.depth * falloff((1 - v) * vLen);
}

/** One lit pixel along the sunward top edge, one dark one opposite. */
function bevel(kind: FaceKind, u: number, v: number, uLen: number, vLen: number): number {
  if (kind === 'top') {
    // Sunward is up-and-right: high `u`, low `v` on the top face.
    if ((1 - u) * uLen < BEVEL.width || v * vLen < BEVEL.width) return BEVEL.lit;
    if (u * uLen < BEVEL.width || (1 - v) * vLen < BEVEL.width) return BEVEL.shaded;
    return 0;
  }
  // The lip where a side face meets the top it hangs from.
  return v * vLen < BEVEL.width ? BEVEL.lit * 0.5 : 0;
}
