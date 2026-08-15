/**
 * What goes *in* a room, described as objects rather than as pictures.
 *
 * Eleven models, and the whole argument of M12's model layer is whether the eleventh costs
 * less than the first. Each is a handful of boxes in tile space with a material on them;
 * rotation, footprint containment and depth order within the object all come out of the
 * renderer, so what is written here is only ever *what the thing is*.
 *
 * **The material table is the `scrap → refined → relic` ladder made visible**, and it is
 * spent deliberately across the set rather than picked per sprite. Cheap furniture is
 * riveted salvage; the middle tier is the same metal cut square and dressed; relic appears
 * on exactly three things, all of them lights, because a light is where "nobody here could
 * make this" is easiest to read. Nothing here needed a material the table did not already
 * have, which was the open question this milestone was going to answer.
 *
 * Heights come from `HEIGHT` in `language.ts`. `rise / LEVEL_HEIGHT` is the ceiling — a
 * solid above it projects off the top of its own frame, and the harness fails on that
 * rather than cropping it silently.
 */

import { HEIGHT } from '../language';
import type { Solid } from './render';
import { legsAt, MARGIN, slab } from './shape';

/** A thin board, in storeys. Two pixels at `LEVEL_HEIGHT` 24 — enough to have an edge. */
const BOARD = 0.083;

// Every 1×1 piece stands inside this square; a 2×1 runs to `2 - MARGIN` in x.
const A = MARGIN;
const B = 1 - MARGIN;

/**
 * A stool: a cut section of salvaged drum with a pad on it.
 *
 * It was a seat on a single post, and the post was invisible. **A top face's diamond hangs
 * `side × HALF_TILE_H` below its own plane**, so a 0.48-tile seat hangs about eight pixels
 * while `HEIGHT.seat` lifts it four and a half — the post was inside its own seat's
 * silhouette, and nothing about the numbers looked wrong. That arithmetic is why furniture
 * this low is drawn as a *body* rather than as legs, and it is the one thing the model
 * layer cannot make correct by construction.
 *
 * So the pad is deliberately **narrower than the drum**, which leaves the drum's rim
 * showing all round it. Nothing here can hide anything else.
 */
export function stoolModel(): Solid[] {
  return [
    // Narrow and upright, with the pad *overhanging* it slightly. Squat and wide it read
    // as a crate lid lying on the floor rather than as something you sit on.
    {
      x0: 0.38, y0: 0.38, z0: 0,
      x1: 0.62, y1: 0.62, z1: HEIGHT.seat - 0.07,
      material: 'scrap', label: 'stool drum', hideTop: true,
    },
    slab(0.3, 0.3, 0.7, 0.7, HEIGHT.seat, 0.07, 'canvas', 'stool pad'),
  ];
}

/**
 * A chair: four legs, a seat, and a back on one side.
 *
 * The back is the entire visible difference between rotation 0 and rotation 2 — a chair
 * covers one cell in every facing, so without it "turn the chair" would be a control that
 * does nothing, which is the same test a door has to pass.
 */
export function chairModel(): Solid[] {
  const seat = HEIGHT.seat;
  /*
   * **Narrower than a cell.** At the full `MARGIN` inset a chair is as broad as a bed is,
   * and with a low back it read as one — same wide plank, same rail down one edge. A chair
   * has to be the *small* piece of furniture in the room, and its own footprint is the only
   * thing that can say so.
   */
  const c0 = 0.24;
  const c1 = 0.76;
  return [
    // Thicker than a bed's posts relative to what stands on them: at this height a leg
    // shows only the sliver below the seat's own front vertex, so its *width* is the only
    // thing making it readable at all.
    ...legsAt(c0, c0, c1, c1, seat - BOARD + 0.02, 'scrap', 'chair leg', 0.15),
    slab(c0, c0, c1, c1, seat, BOARD, 'plank', 'chair seat'),
    {
      x0: c0, y0: c0, z0: seat - 0.02,
      x1: c0 + 0.11, y1: c1, z1: HEIGHT.back,
      material: 'plank', label: 'chair back',
    },
  ];
}

/** A table: a top on four legs, two cells square. */
export function tableModel(): Solid[] {
  const top = HEIGHT.table;
  return [
    ...legsAt(A, A, 2 - MARGIN, 2 - MARGIN, top - 0.07, 'scrap', 'table leg'),
    slab(A, A, 2 - MARGIN, 2 - MARGIN, top, 0.06, 'plank', 'table top'),
  ];
}

/**
 * A desk: a dressed top on two end panels, with a drawer bank at one end.
 *
 * Panels rather than legs, so it does not read as a narrow table — and the drawers are
 * what make its two facings different. Refined rather than salvage: this is the piece
 * somebody cut square on purpose.
 */
export function deskModel(): Solid[] {
  const top = HEIGHT.table;
  const panel = 0.16;
  return [
    {
      x0: A, y0: A + 0.06, z0: 0,
      x1: A + panel, y1: B - 0.06, z1: top - 0.05,
      material: 'scrap', label: 'desk panel left', hideTop: true,
    },
    {
      x0: 2 - MARGIN - panel, y0: A + 0.06, z0: 0,
      x1: 2 - MARGIN, y1: B - 0.06, z1: top - 0.05,
      material: 'scrap', label: 'desk panel right', hideTop: true,
    },
    // The asymmetry. At one end only, so turning the desk moves it end to end — and
    // clear of the panel beside it, which it used to overlap and bury.
    {
      x0: 2 - MARGIN - 0.72, y0: A + 0.04, z0: 0.14,
      x1: 2 - MARGIN - 0.22, y1: B - 0.04, z1: top - 0.05,
      material: 'refined', label: 'desk drawers', hideTop: true,
    },
    slab(A - 0.03, A - 0.02, 2 - MARGIN + 0.03, B + 0.02, top, 0.06, 'refined', 'desk top'),
  ];
}

/**
 * A shelf: a shallow carcass with three shelf fronts standing proud of it.
 *
 * **Three shapes were tried and the projection killed two.** Full boards on uprights: a
 * horizontal surface in a 2:1 view hides everything under it — a board's top face is a
 * diamond hanging `depth × HALF_TILE_H` below its own plane, far more than the gap between
 * two shelves — so the harness correctly reported the back panel contributing nothing.
 * Front lips instead of boards: visible, but they read as slats *lying on* a bench, because
 * a horizontal slab low and forward of a big top board looks like decking.
 *
 * What works is putting the detail on the **front face**, where a shelf actually shows it.
 * The carcass is one box, and the shelves are thin bands protruding three hundredths of a
 * tile in `+y` so they cannot be swallowed by the face they sit on. Half a cell deep, so
 * the top surface stops being the largest thing in the sprite.
 */
export function shelfModel(): Solid[] {
  const top = HEIGHT.shelf;
  const front = A + 0.46;
  /*
   * Protruding nearly a tenth of a cell, not three hundredths.
   *
   * At 0.03 the band's own *end* face came out a pixel wide and the harness called all
   * three of them, in every rotation — correctly. A detail applied to one face still has
   * the other two, and they have to be worth drawing or the band is a decal rather than a
   * shelf.
   */
  const shelfFront = (z: number, label: string): Solid => ({
    x0: A + 0.06, y0: front, z0: z,
    x1: 2 - MARGIN - 0.06, y1: front + 0.09, z1: z + 0.12,
    material: 'plank', label,
  });

  return [
    { x0: A, y0: A, z0: 0, x1: 2 - MARGIN, y1: front, z1: top, material: 'scrap', label: 'shelf carcass' },
    shelfFront(0.12, 'shelf front low'),
    shelfFront(0.36, 'shelf front mid'),
    shelfFront(0.6, 'shelf front high'),
  ];
}

/** A supply crate: a box with a bundle lashed on top under canvas. */
export function crateModel(): Solid[] {
  return [
    // Top hidden by construction: the cover is draped straight over it.
    { x0: A, y0: A, z0: 0, x1: B, y1: B, z1: 0.5, material: 'plank', label: 'crate box', hideTop: true },
    // Wider than the box, so the cover reads as draped over it rather than stacked on it.
    slab(A - 0.02, A - 0.02, B + 0.02, B + 0.02, 0.56, 0.06, 'canvas', 'crate cover'),
    { x0: 0.3, y0: 0.3, z0: 0.52, x1: 0.7, y1: 0.7, z1: 0.62, material: 'canvas', label: 'crate bundle' },
  ];
}

/** A safe: refined plate on a plinth, with a relic lock on the face you can see. */
export function safeModel(): Solid[] {
  return [
    // Drawn first and wider, so it survives as a foot under the body.
    slab(A - 0.03, A - 0.03, B + 0.03, B + 0.03, 0.07, 0.07, 'scrap', 'safe plinth'),
    { x0: A, y0: A, z0: 0.05, x1: B, y1: B, z1: HEIGHT.counter - 0.04, material: 'refined', label: 'safe body' },
    // Standing proud of the +x face — the one that faces down-right into the camera.
    {
      x0: B, y0: A + 0.1, z0: 0.1,
      x1: B + 0.03, y1: B - 0.1, z1: 0.46,
      material: 'refined', label: 'safe door',
    },
    {
      x0: B, y0: 0.38, z0: 0.22,
      x1: B + 0.05, y1: 0.62, z1: 0.38,
      material: 'relic', label: 'safe lock',
    },
  ];
}

/**
 * A torch: a brand on a post.
 *
 * The bottom of the light ladder, and the only one of the three that *burns* — its flame is
 * drawn as a vector over the top of this model, because flame has no faces and the model
 * layer shades faces. See `MODEL_OVERLAY` in `buildingModels.ts`.
 */
export function torchModel(): Solid[] {
  return [
    slab(0.36, 0.36, 0.64, 0.64, 0.08, 0.08, 'stone', 'torch base'),
    { x0: 0.44, y0: 0.44, z0: 0.06, x1: 0.56, y1: 0.56, z1: 0.62, material: 'wood', label: 'torch post', hideTop: true },
    { x0: 0.38, y0: 0.38, z0: 0.6, x1: 0.62, y1: 0.62, z1: 0.7, material: 'scrap', label: 'torch bracket' },
  ];
}

/**
 * A lamp: salvaged relic tech on a dressed post. Cold light, and the tier says so.
 *
 * The head is a **lantern** — taller than it is wide, with a cap over it. A flat slab of
 * relic on a post read as a small table with a teal top, which is what happens when the
 * only thing distinguishing a light from furniture is its colour.
 */
export function lampModel(): Solid[] {
  return [
    slab(0.34, 0.34, 0.66, 0.66, 0.07, 0.07, 'refined', 'lamp base'),
    { x0: 0.45, y0: 0.45, z0: 0.05, x1: 0.55, y1: 0.55, z1: 0.58, material: 'refined', label: 'lamp post', hideTop: true },
    { x0: 0.36, y0: 0.36, z0: 0.56, x1: 0.64, y1: 0.64, z1: 0.76, material: 'relic', label: 'lamp lantern', hideTop: true },
    slab(0.31, 0.31, 0.69, 0.69, 0.81, 0.05, 'refined', 'lamp cap'),
  ];
}

/** A floodlight: a mast, a yoke, and a head far too good for this colony to have made. */
export function floodlightModel(): Solid[] {
  return [
    slab(0.3, 0.3, 0.7, 0.7, 0.08, 0.08, 'scrap', 'floodlight base'),
    { x0: 0.46, y0: 0.46, z0: 0.06, x1: 0.54, y1: 0.54, z1: 0.66, material: 'refined', label: 'floodlight mast', hideTop: true },
    // Wider than the head it carries, so its ends stay visible either side. The other way
    // round the head simply swallowed it.
    { x0: 0.22, y0: 0.4, z0: 0.62, x1: 0.78, y1: 0.6, z1: 0.7, material: 'scrap', label: 'floodlight yoke', hideTop: true },
    { x0: 0.3, y0: 0.32, z0: 0.68, x1: 0.7, y1: 0.68, z1: HEIGHT.standing, material: 'relic', label: 'floodlight head' },
  ];
}

/** A banner: cloth hung down one side of a pole. Does nothing, and is the point. */
export function bannerModel(): Solid[] {
  return [
    // Top hidden: the pole stands in it.
    { x0: 0.42, y0: 0.42, z0: 0, x1: 0.58, y1: 0.58, z1: 0.06, material: 'stone', label: 'banner foot', hideTop: true },
    /*
     * **Small, and hung right at the top**, because the swing cannot be designed away.
     *
     * A part offset from the tile centre swings vertically as the model rotates: under the
     * four quarter turns a point `(px, py)` takes sums `px+py`, `1+px−py`, `2−px−py` and
     * `1−px+py`, and those are all equal **only at (0.5, 0.5)**. So a banner that visibly
     * hangs to one side necessarily drops by `offset × TILE_H` pixels at two of its four
     * facings — sideways offset and vertical swing are the same number, and one cannot be
     * bought without the other.
     *
     * That kills the obvious fixes. Centring the cloth removes the swing and makes the
     * facings identical; simply raising the hem does not work either, because the sheet has
     * *depth* — a box wide enough to read as a banner reaches toward the camera, and its
     * near-bottom corner hangs far below its own hem. The first attempt raised the hem to
     * 0.44 storeys and still left four pixels of bare post at two facings.
     *
     * So the cloth is **shallower and shorter, and sits in the top fifth of the post**:
     * three pixels of swing against nine of clearance at the worst facing, twelve at the
     * best. Both read as hanging, which is the only thing the player is judging.
     *
     * Cloth before pole, which is the order the object is in at two of the four facings.
     * The model layer does not depth-sort — see `render.ts` — so a part offset in the
     * ground plane cannot be correctly ordered for all four, and a pole drawn across the
     * near face of its own banner is the reading that survives being wrong.
     */
    { x0: 0.36, y0: 0.34, z0: 0.6, x1: 0.46, y1: 0.66, z1: 0.83, material: 'cloth', label: 'banner cloth' },
    { x0: 0.46, y0: 0.46, z0: 0.04, x1: 0.54, y1: 0.54, z1: HEIGHT.standing, material: 'wood', label: 'banner pole' },
  ];
}
