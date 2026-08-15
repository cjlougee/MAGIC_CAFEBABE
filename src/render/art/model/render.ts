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
 * Solids are drawn in **depth order**, with the author's order breaking ties.
 *
 * This file used to say the opposite — that sorting was a source of surprises and the
 * author knew the answer already — and that was true for as long as every model stacked its
 * parts in `z`. A bed is legs, then frame, then mattress, then pillow, and each sits on the
 * last: the order is the same from every side, so writing it down worked.
 *
 * It stops being true the moment a part is offset in the **ground plane**. A banner's cloth
 * hangs to one side of its pole, so at two facings the cloth is behind the pole and at the
 * other two it is in front — and no single author order can be right for all four. What
 * shipped was a pole painted straight through the near face of its own banner, twice, while
 * every measurement of the sprite passed. **The author cannot know an answer that changes
 * with the rotation.**
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

  // Turned first, then ordered: which part is in front is a question about the *rotated*
  // boxes, and asking it of the unrotated ones would give the same answer four times.
  const boxes = solids.map((solid) => rotateBox(solid, footprint, rotation));

  for (const index of paintOrder(boxes)) {
    const solid = solids[index];
    const box = boxes[index];
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

/**
 * Whether `a` can hide part of `b` — the separating-axis test for boxes under a camera
 * that never moves.
 *
 * `+x` runs down-right, `+y` down-left and `+z` up, so a box lying entirely beyond another
 * along any one of those three is nearer the viewer and paints over it. If none of the three
 * separates them the boxes interpenetrate, neither is strictly in front, and the author's
 * order decides — which is the case for every part of a bed, and why sorting changes that
 * sprite not at all.
 */
function nearerThan(a: Box, b: Box): boolean {
  /*
   * Beyond `b` along one axis **and overlapping it on the other two**, which is the part
   * that is easy to leave out and produces nonsense when you do.
   *
   * A bed's far-right leg is beyond its pillow along `+y` and sits a third of a storey
   * below it: the two share no screen pixel and neither can hide the other, but the
   * one-sided test calls the leg "in front" anyway. That edge then propagates through the
   * sort and drags the bed's frame out from under three of its own legs — a sprite that had
   * been correct for two milestones, broken by a constraint between two parts that never
   * touch.
   */
  const overX = a.x0 < b.x1 && b.x0 < a.x1;
  const overY = a.y0 < b.y1 && b.y0 < a.y1;
  const overZ = a.z0 < b.z1 && b.z0 < a.z1;

  if (a.x0 >= b.x1) return overY && overZ;
  if (a.y0 >= b.y1) return overX && overZ;
  if (a.z0 >= b.z1) return overX && overY;
  return false;
}

/**
 * The order to paint boxes in: anything behind, before the thing in front of it.
 *
 * A topological sort rather than a sort key, because "is in front of" is **not a total
 * order** on boxes — a pillow is above a mattress but nearer than nothing else, and any
 * scalar depth that ranked the two would have to choose between `x + y` and `z` and be
 * wrong about the other. Ranking a bed by `x + y` puts its pillow under its own mattress.
 *
 * Ties break on the author's index, so a model whose parts all interpenetrate comes out in
 * exactly the order it was written — which is every model here except the banner and the
 * shelf. A cycle (boxes mutually beyond one another) cannot overlap on screen, so the
 * remainder simply keeps author order.
 */
function paintOrder(boxes: readonly Box[]): number[] {
  const n = boxes.length;
  const waitingOn = new Array<number>(n).fill(0);
  const behindMe: number[][] = boxes.map(() => []);

  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b || !nearerThan(boxes[a], boxes[b])) continue;
      // `a` is in front of `b`, so `b` is painted first.
      behindMe[b].push(a);
      waitingOn[a]++;
    }
  }

  const order: number[] = [];
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (waitingOn[i] === 0) ready.push(i);

  while (ready.length > 0) {
    // Lowest author index among everything currently free, which is what makes the sort
    // stable — and what makes it a no-op for a model with nothing to reorder.
    let pick = 0;
    for (let i = 1; i < ready.length; i++) if (ready[i] < ready[pick]) pick = i;
    const next = ready.splice(pick, 1)[0];
    order.push(next);
    for (const dependent of behindMe[next]) {
      if (--waitingOn[dependent] === 0) ready.push(dependent);
    }
  }

  if (order.length < n) {
    const placed = new Set(order);
    for (let i = 0; i < n; i++) if (!placed.has(i)) order.push(i);
  }
  return order;
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
