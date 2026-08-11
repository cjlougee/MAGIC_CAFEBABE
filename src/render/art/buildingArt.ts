/**
 * Placed structures.
 *
 * Bedrolls lie flat on the ground plane; walls and doors rise from it using the same
 * face geometry as raised terrain, so a stone wall butts against a rock face without a
 * seam or a lighting mismatch.
 */

import { Graphics } from 'pixi.js';
import { Building, buildingDef, type BuildingId } from '../../sim/defs/buildings';
import type { Rotation } from '../../sim/world/footprint';
import { isModelled, MODELLED } from './model/buildingModels';
import { renderModel } from './model/render';
import type { DrawList } from './raster/drawList';
import { drawListFromGraphics } from './raster/fromGraphics';
import { HALF_TILE_H, HALF_TILE_W, TILE_H, TILE_W } from '../constants';
import { footprintCellCentre as cellCentre } from '../iso';
import {
  diamond,
  isoCapsule,
  shifted,
  type Point,
  leftFace,
  LEFT_FACE_SHADE,
  LIT_SHIFT,
  rightFace,
  RIGHT_FACE_SHADE,
  SHADED_SHIFT,
  sunwardBand,
  topFace,
} from './isoShapes';
import { Palette, shade } from './palette';

export const BUILDING_W = TILE_W;
export const BUILDING_H = TILE_H;

/**
 * How far each structure rises off the ground, in world pixels.
 *
 * Every frame in the game is `footprintBounds(..., BUILDING_HEIGHT[def])`, so this is the
 * one number that decides how much headroom a sprite has. For a modelled structure it is
 * also the ceiling: `rise / LEVEL_HEIGHT` storeys, above which a solid projects off the top
 * of its own frame — see `model/render.ts`. `language.ts` states the proportions.
 */
export const BUILDING_HEIGHT: Record<BuildingId, number> = {
  // Was 0, which forced the sprite to be perfectly flat, and a bedroll with no thickness
  // at all reads as a stain on the floor rather than as bedding. Three pixels is enough
  // for a roll of canvas to have a top and a side, and still nothing beside a bed's 11.
  [Building.Bedroll]: 3,
  [Building.Wall]: 22,
  // Shorter than a wall so a doorway reads as a gap in the run, not another wall.
  [Building.Door]: 16,
  // Tall enough for a flame to read as a flame, short enough not to occlude the
  // colonists standing around it — which is exactly what you want to watch.
  [Building.Campfire]: 14,
  // Low: a bed is furniture, and the colonist lying on it is the thing to look at.
  // High enough that the legs read as legs under a 3px frame, and no higher.
  [Building.Bed]: 11,
  // Grander than a campfire and still well under LEVEL_HEIGHT (24). Anything at or above
  // that would be indistinguishable from a genuine storey while behaving nothing alike.
  // Not a cap by decree — see ADR 0003 — there is simply nothing yet for a second storey
  // to *be*. Slice 4 builds levels properly and takes the constraint away.
  [Building.Hearth]: 18,
};

/**
 * The colour each emitter casts, for the lighting layer to tint its glow with.
 *
 * Here rather than in `sim/defs/buildings.ts` because it is a *colour*: how far a fire
 * lights is content, what colour it burns is art direction. Anything absent simply never
 * lights, which `lightRadius` already decides.
 */
export const BUILDING_LIGHT: Partial<Record<BuildingId, number>> = {
  [Building.Campfire]: Palette.firelight,
  [Building.Hearth]: Palette.firelight,
};

// ── Footprint geometry ──────────────────────────────────────────────────────────
//
// A structure's texture covers its whole footprint, so nothing may assume the frame is
// one tile any more. The drawing functions below work in cell offsets and never touch
// frame pixels; `footprintCellCentre` in `iso.ts` is the one place that conversion lives.
// It began here, and moved because the harness needs the same arithmetic to say where ink
// is *allowed* to be — and a test working from a second copy would certify the bug.

/** Toward the sun, in frame pixels: up and to the right, as everything else here. */
const SUNWARD = { x: 2, y: -1 };

/**
 * A long flat form with the one sun on it.
 *
 * `sunwardBand` works on a single tile diamond and has nothing sensible to say about a
 * shape two tiles long — pointed at the midpoint it draws a band across the middle of the
 * object instead of along its lit edge.
 *
 * The first attempt at a replacement laid the lit tone down full size and cut it back
 * with the body nudged *away* from the sun, which is the crescent bushes and pawn heads
 * use. On a round mass that leaves a rim; on a shape two tiles long it leaves a two-pixel
 * sliver running the entire length **outside** the body, which reads as a stray line
 * lying next to the bed rather than as light on it.
 *
 * So the highlight is **contained**: three concentric capsules, the innermost inset far
 * enough that nudging it sunward can never push it past the body. Light lands on the
 * upper-right because that inset shape is offset that way, and the base tone survives as
 * a margin on the lower-left. Nothing escapes the silhouette, so there is no line to
 * misread.
 */
function litCapsule(
  g: Graphics,
  a: Point,
  b: Point,
  rw: number,
  rh: number,
  base: number,
): void {
  isoCapsule(g, a, b, rw, rh).fill({ color: shade(base, SHADED_SHIFT * 0.5) });
  isoCapsule(g, a, b, rw - 1.5, rh - 0.8).fill({ color: base });
  isoCapsule(
    g,
    shifted(a, SUNWARD.x, SUNWARD.y),
    shifted(b, SUNWARD.x, SUNWARD.y),
    rw - 4.5,
    rh - 2.4,
  ).fill({ color: shade(base, LIT_SHIFT) });
}

/**
 * The four corners of a capsule's footprint rectangle, pulled in toward its middle.
 *
 * Where the legs of a bed go. The capsule's own hull has six vertices — two of them are
 * mid-points along the long sides — so the corners have to be named rather than taken
 * off the outline.
 */
function capsuleCorners(a: Point, b: Point, rw: number, rh: number): Point[] {
  const [near, far] = a.y <= b.y ? [a, b] : [b, a];
  const corners =
    far.x > near.x
      ? [
          { x: near.x - rw, y: near.y },
          { x: near.x, y: near.y - rh },
          { x: far.x + rw, y: far.y },
          { x: far.x, y: far.y + rh },
        ]
      : [
          { x: near.x, y: near.y - rh },
          { x: near.x + rw, y: near.y },
          { x: far.x, y: far.y + rh },
          { x: far.x - rw, y: far.y },
        ];

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const INSET = 0.26;
  return corners.map((c) => ({
    x: c.x + (cx - c.x) * INSET,
    y: c.y + (cy - c.y) * INSET,
  }));
}

/** One post, standing on the ground plane at `at` and reaching `height` up to the frame. */
function drawLeg(g: Graphics, at: Point, height: number, colour: number): void {
  const halfW = 2.5;
  g.rect(at.x - halfW, at.y - height, halfW * 2, height + 1).fill({
    color: shade(colour, RIGHT_FACE_SHADE - 0.08),
  });
  // Sunward half catches the light, same as every other pair of faces here.
  g.rect(at.x - halfW, at.y - height, halfW, height + 1).fill({
    color: shade(colour, LEFT_FACE_SHADE - 0.06),
  });
}

/**
 * A capsule extruded downward — a slab with a visible thickness, not a solid block.
 *
 * The lower silhouette splits at the south vertex: everything before it faces down-left
 * and takes the darker shade, everything after faces down-right. Spelled out per branch
 * rather than derived, because the capsule already branches on which screen diagonal it
 * runs along and there are only two cases.
 */
function isoCapsuleSlab(
  g: Graphics,
  a: Point,
  b: Point,
  rw: number,
  rh: number,
  thickness: number,
  base: number,
): void {
  const [near, far] = a.y <= b.y ? [a, b] : [b, a];
  const down = (p: Point) => shifted(p, 0, thickness);

  if (far.x > near.x) {
    const west = { x: near.x - rw, y: near.y };
    const nearBottom = { x: near.x, y: near.y + rh };
    const south = { x: far.x, y: far.y + rh };
    const east = { x: far.x + rw, y: far.y };

    g.poly([
      west.x, west.y, nearBottom.x, nearBottom.y, south.x, south.y,
      down(south).x, down(south).y, down(nearBottom).x, down(nearBottom).y, down(west).x, down(west).y,
    ]).fill({ color: shade(base, LEFT_FACE_SHADE) });
    g.poly([
      south.x, south.y, east.x, east.y, down(east).x, down(east).y, down(south).x, down(south).y,
    ]).fill({ color: shade(base, RIGHT_FACE_SHADE) });
  } else {
    const east = { x: near.x + rw, y: near.y };
    const farRight = { x: far.x + rw, y: far.y };
    const south = { x: far.x, y: far.y + rh };
    const west = { x: far.x - rw, y: far.y };

    g.poly([
      east.x, east.y, farRight.x, farRight.y, south.x, south.y,
      down(south).x, down(south).y, down(farRight).x, down(farRight).y, down(east).x, down(east).y,
    ]).fill({ color: shade(base, RIGHT_FACE_SHADE) });
    g.poly([
      south.x, south.y, west.x, west.y, down(west).x, down(west).y, down(south).x, down(south).y,
    ]).fill({ color: shade(base, LEFT_FACE_SHADE) });
  }

  isoCapsule(g, a, b, rw, rh).fill({ color: base });
}

/**
 * A raised block on an arbitrary diamond, with the one sun on it.
 *
 * `isoShapes`' `leftFace` / `rightFace` are hard-wired to a single tile; a 2×2 hearth
 * needs the same geometry at twice the size, so the faces are built here from the
 * diamond's own vertices. Same shading constants, so it sits in the same light as
 * everything else.
 */
function isoBlock(
  g: Graphics,
  c: Point,
  hw: number,
  hh: number,
  height: number,
  base: number,
): void {
  const bottom = { x: c.x, y: c.y + hh };
  const left = { x: c.x - hw, y: c.y };
  const right = { x: c.x + hw, y: c.y };

  // Sides first — the top face overdraws their upper edge for a clean silhouette.
  g.poly([left.x, left.y - height, bottom.x, bottom.y - height, bottom.x, bottom.y, left.x, left.y])
    .fill({ color: shade(base, LEFT_FACE_SHADE) });
  g.poly([bottom.x, bottom.y - height, right.x, right.y - height, right.x, right.y, bottom.x, bottom.y])
    .fill({ color: shade(base, RIGHT_FACE_SHADE) });

  diamond(g, c.x, c.y - height, hw, hh).fill({ color: base });
}

/** The two cells a 2×1 footprint covers, head end first. */
function longAxisCells(rotation: Rotation, rise = 0): { head: Point; foot: Point } {
  const h = rotation % 2 === 0 ? 1 : 2;
  const a = cellCentre(0, 0, h, rise);
  const b = rotation % 2 === 0 ? cellCentre(1, 0, h, rise) : cellCentre(0, 1, h, rise);
  // Rotations 0 and 2 cover identical cells; the pillow moving end to end is the entire
  // visible difference between them, and the reason four facings exist at all.
  return rotation < 2 ? { head: a, foot: b } : { head: b, foot: a };
}

const BEDROLL = 0x6f5a48;
const MATTRESS = 0x8a7a63;

/** How thick the bed's frame is. Much less than its height — the rest is leg. */
const BED_SLAB = 3;

function drawBedroll(g: Graphics, rotation: Rotation): void {
  const { head, foot } = longAxisCells(rotation);
  // No legs and no frame: a bedroll is a roll of cloth on the ground, and that contrast
  // with the bed is the only thing telling the player the upgrade was worth building.
  litCapsule(g, head, foot, HALF_TILE_W - 10, HALF_TILE_H - 5, BEDROLL);
  drawPillow(g, head);
}

/** The accent that says which end you sleep at. */
function drawPillow(g: Graphics, at: Point): void {
  diamond(g, at.x, at.y - 3, 9, 4.5).fill({ color: shade(Palette.text, -0.32) });
  diamond(g, at.x, at.y - 4.5, 7.5, 3.6).fill({ color: shade(Palette.text, -0.12) });
}

/**
 * A built bed: four legs, a slab frame, a mattress, a pillow.
 *
 * The legs are the whole point of the sprite. A bedroll and a bed occupy the same two
 * cells and lie at the same angle, so without something that says *made of parts* the
 * upgrade the colony spent scrap and labour on looks like a bedroll drawn slightly
 * paler. Posts under the corners are the cheapest possible reading of "somebody built
 * this", and they are what the slab's thickness exists to leave room for.
 */
function drawBed(g: Graphics, rotation: Rotation): void {
  const rise = BUILDING_HEIGHT[Building.Bed];
  const { head, foot } = longAxisCells(rotation, rise);
  const rw = HALF_TILE_W - 9;
  const rh = HALF_TILE_H - 4.5;

  const frame = shade(Palette.wall, -0.26);
  const top = -rise;

  // Legs first, so the frame lands on top of them. The two at the back end up entirely
  // behind it, which is correct — you cannot see the far legs of a bed either.
  for (const corner of capsuleCorners(head, foot, rw, rh)) {
    drawLeg(g, corner, rise, frame);
  }

  // A slab, not a block: its thickness is a fraction of the height it stands at, and
  // that gap is where the legs show. Extruding the full `rise` would bury them and turn
  // the bed back into a solid lump.
  isoCapsuleSlab(g, shifted(head, 0, top), shifted(foot, 0, top), rw, rh, BED_SLAB, frame);

  // Mattress, inset so the frame reads as a rail around it, and carrying the light.
  const mattressY = top - 2;
  litCapsule(
    g,
    shifted(head, 0, mattressY),
    shifted(foot, 0, mattressY),
    rw - 3.5,
    rh - 1.8,
    MATTRESS,
  );
  drawPillow(g, shifted(head, 0, mattressY - 1));
}

function drawRaised(g: Graphics, base: number, height: number, cap: number): void {
  // Sides first: the top face must overdraw their upper edge for a clean silhouette.
  leftFace(g, 0, height).fill({ color: shade(base, LEFT_FACE_SHADE) });
  rightFace(g, 0, height).fill({ color: shade(base, RIGHT_FACE_SHADE) });
  topFace(g).fill({ color: base });

  const capW = HALF_TILE_W - 4;
  const capH = HALF_TILE_H - 2;
  diamond(g, HALF_TILE_W, HALF_TILE_H, capW, capH).fill({ color: cap });
  // Drawn on the *cap*, which is already inset, so a run of walls never gets a lit line
  // down the joins between segments. See sunwardBand.
  sunwardBand(g, HALF_TILE_W, HALF_TILE_H, capW, capH, 0.26).fill({
    color: shade(cap, LIT_SHIFT),
  });
}

function drawWall(g: Graphics): void {
  const base = Palette.wall;
  drawRaised(g, base, BUILDING_HEIGHT[Building.Wall], shade(base, 0.1));

  // Coursing on the faces, so a long run reads as masonry rather than a solid slab.
  for (let i = 1; i <= 2; i++) {
    const y = Math.round((BUILDING_HEIGHT[Building.Wall] * i) / 3);
    leftFace(g, y, 1).fill({ color: shade(base, LEFT_FACE_SHADE - 0.1) });
    rightFace(g, y, 1).fill({ color: shade(base, RIGHT_FACE_SHADE - 0.1) });
  }
}

/**
 * A doorway: two jambs with a gap between them, not a shorter wall.
 *
 * The old door was `drawRaised` with a coloured strip on it, which made it a wall of a
 * different colour — in a run of walls the one you could walk through was findable only
 * by looking for the shade. A door has to read as an *opening*, so the tile is drawn as
 * the two posts that continue the wall either side and a low threshold across the gap,
 * with the ground visible between them.
 *
 * `rotation` says which way the run goes, so the jambs continue the wall rather than
 * standing across it. It is placed facing whichever way the neighbouring walls run — see
 * `orientDoor` in the input layer — and R overrides that.
 */
function drawDoor(g: Graphics, rotation: Rotation, locked: boolean): void {
  const height = BUILDING_HEIGHT[Building.Door];
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H + height;
  const base = 0x5d5148;

  // Along the wall run: +x is down-right on screen, +y down-left.
  const along =
    rotation % 2 === 0
      ? { x: HALF_TILE_W * 0.5, y: HALF_TILE_H * 0.5 }
      : { x: -HALF_TILE_W * 0.5, y: HALF_TILE_H * 0.5 };

  // Threshold first, so the jambs overdraw its ends and it reads as running *under* them.
  const sill = shade(base, -0.3);
  diamond(g, cx, cy - 3, HALF_TILE_W - 8, HALF_TILE_H - 4).fill({ color: sill });
  // The relic accent lives down here on the track rather than capping the posts. Capped,
  // it made two glowing pillars and stopped reading as a doorway at all — the strip is
  // meant to say "built out of the wreckage", not "this is the brightest thing on screen".
  isoCapsule(
    g,
    { x: cx - along.x * 0.8, y: cy - along.y * 0.8 - 4 },
    { x: cx + along.x * 0.8, y: cy + along.y * 0.8 - 4 },
    3,
    1.6,
  ).fill({ color: shade(Palette.relic, -0.5) });

  // The two jambs, each continuing the wall it interrupts.
  for (const side of [-1, 1]) {
    const at = { x: cx + along.x * side, y: cy + along.y * side };
    isoBlock(g, at, HALF_TILE_W * 0.42, HALF_TILE_H * 0.42, height, base);
    sunwardBand(g, at.x, at.y - height, HALF_TILE_W * 0.42, HALF_TILE_H * 0.42, 0.3).fill({
      color: shade(base, LIT_SHIFT),
    });
  }

  /*
   * A locked door is a wall, and has to say so at a glance.
   *
   * Drawn **after** both jambs, not between the threshold and them. Behind the near post
   * it was correct — a bar does sit between the frames — and all the player could see was
   * a two-pixel sliver, which is a lock they have to remember rather than read. Across
   * the front it is unmistakable, and this whole milestone is about being able to tell
   * whether an order registered.
   */
  if (!locked) return;

  const bar = { x: along.x * 1.15, y: along.y * 1.15 };
  const barY = cy - height * 0.62;
  isoCapsule(
    g,
    { x: cx - bar.x, y: barY - bar.y },
    { x: cx + bar.x, y: barY + bar.y },
    5,
    3,
  ).fill({ color: shade(Palette.relic, -0.55) });
  isoCapsule(
    g,
    { x: cx - bar.x, y: barY - bar.y - 1.5 },
    { x: cx + bar.x, y: barY + bar.y - 1.5 },
    4,
    2.2,
  ).fill({ color: Palette.relic });
}

/** One tongue of flame: a leaning spike, widest at its base. */
function flame(g: Graphics, x: number, base: number, halfW: number, tall: number, lean: number, colour: number): void {
  g.poly([
    x - halfW, base,
    x + halfW, base,
    x + halfW * 0.4 + lean * 0.5, base - tall * 0.55,
    x + lean, base - tall,
    x - halfW * 0.5 + lean * 0.5, base - tall * 0.5,
  ]).fill({ color: colour });
}

/**
 * A ring of stones with a fire in it.
 *
 * Drawn back-to-front — far stones, pit, logs, flame, near stones — so the near stones
 * overlap the flame and it sits *inside* the ring rather than on top of it. The ring
 * fills most of the tile, because a campfire that reads as a small dot in a large square
 * looks like a bug rather than a hearth.
 *
 * Everything is measured from the ground plane, which for a raised building sits `height`
 * pixels below the texture's top face. Getting that wrong is what put the first version
 * in the corner of its tile.
 */
function drawCampfire(g: Graphics): void {
  const height = BUILDING_HEIGHT[Building.Campfire];
  const cx = HALF_TILE_W;
  const cy = HALF_TILE_H + height;

  const ringW = HALF_TILE_W - 5;
  const ringH = HALF_TILE_H - 3;
  const stone = Palette.gravel;

  const stones: { x: number; y: number; front: boolean }[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    stones.push({
      x: cx + Math.cos(angle) * ringW,
      y: cy + Math.sin(angle) * ringH,
      front: Math.sin(angle) > 0,
    });
  }

  for (const s of stones) {
    if (s.front) continue;
    diamond(g, s.x, s.y - 2, 5, 2.6).fill({ color: shade(stone, -0.22) });
  }

  // Ash bed, then embers glowing through it.
  diamond(g, cx, cy, ringW - 4, ringH - 2).fill({ color: shade(Palette.void, 0.3) });
  diamond(g, cx, cy, ringW - 9, ringH - 5).fill({ color: shade(Palette.hazard, -0.55) });

  // Two crossed logs. Nothing says "campfire" faster than a pair of sticks.
  const log = shade(Palette.dirt, -0.15);
  g.poly([cx - 15, cy + 1, cx + 12, cy - 6, cx + 14, cy - 3, cx - 13, cy + 4]).fill({ color: log });
  g.poly([cx - 12, cy - 6, cx + 15, cy + 1, cx + 13, cy + 4, cx - 14, cy - 3]).fill({
    color: shade(log, 0.12),
  });

  // Three tongues, hottest and brightest at the core, leaning slightly apart so the
  // silhouette isn't a symmetrical cone.
  flame(g, cx - 5, cy - 3, 5, height * 0.75, -2, shade(Palette.hazard, -0.2));
  flame(g, cx + 5, cy - 3, 5, height * 0.85, 2, shade(Palette.hazard, -0.1));
  flame(g, cx, cy - 2, 7, height * 1.25, 0, Palette.hazard);
  flame(g, cx, cy - 2, 4, height * 0.95, 0, shade(Palette.gold, 0.05));
  flame(g, cx, cy - 1, 2, height * 0.6, 0, shade(Palette.gold, 0.45));

  for (const s of stones) {
    if (!s.front) continue;
    diamond(g, s.x, s.y - 2, 5, 2.6).fill({ color: stone });
    diamond(g, s.x, s.y - 3.5, 4, 2).fill({ color: shade(stone, 0.14) });
  }
}

/**
 * A built fire: a raised stone kerb two cells square with a pit sunk into it.
 *
 * Deliberately the campfire's language at a larger scale rather than a new idea — same
 * ash bed, same crossed logs, same flame tongues — so the pair read as a tier rather than
 * as two unrelated objects. What makes it the upgrade is that it is *built*: a kerb with
 * real faces on it instead of a ring of loose stones dropped on the grass.
 *
 * A 2×2 block of tiles is exactly one diamond at twice the linear size, which is why the
 * kerb is a single `isoBlock` and not four.
 */
function drawHearth(g: Graphics): void {
  const height = BUILDING_HEIGHT[Building.Hearth];
  // Centre of a 2×2 footprint: midway between the anchor and the far corner, **on the
  // ground plane**, which for a raised structure sits `height` below the frame's top.
  // Omitting that term draws the whole hearth one storey up with its own footprint
  // visibly floating underneath it — the same mistake that first put the campfire in the
  // corner of its tile.
  const c = { x: TILE_W, y: TILE_H + height };
  const hw = TILE_W - 6;
  const hh = TILE_H - 3;
  const stone = Palette.wall;

  isoBlock(g, c, hw, hh, height, stone);

  // The rim highlight sits on the kerb's *top face*, which is already inset from the
  // footprint, so nothing abutting the hearth picks up a lit line against it.
  sunwardBand(g, c.x, c.y - height, hw, hh, 0.2).fill({ color: shade(stone, LIT_SHIFT) });

  // The pit, sunk into the top face. Two diamonds: the shadowed throat and the ash in it.
  const pitTop = c.y - height + 3;
  diamond(g, c.x, pitTop, hw - 12, hh - 6).fill({ color: shade(Palette.void, 0.18) });
  diamond(g, c.x, pitTop + 2, hw - 17, hh - 9).fill({ color: shade(Palette.void, 0.34) });
  diamond(g, c.x, pitTop + 3, hw - 24, hh - 13).fill({ color: shade(Palette.hazard, -0.55) });

  const fireY = pitTop + 3;
  const log = shade(Palette.dirt, -0.15);
  g.poly([c.x - 20, fireY + 1, c.x + 16, fireY - 8, c.x + 19, fireY - 4, c.x - 17, fireY + 5]).fill({
    color: log,
  });
  g.poly([c.x - 16, fireY - 8, c.x + 20, fireY + 1, c.x + 17, fireY + 5, c.x - 19, fireY - 4]).fill({
    color: shade(log, 0.12),
  });

  // Same five-tongue build as the campfire, scaled up. Leaning apart so the silhouette
  // is not a symmetrical cone.
  flame(g, c.x - 7, fireY - 3, 6, height * 0.8, -3, shade(Palette.hazard, -0.2));
  flame(g, c.x + 7, fireY - 3, 6, height * 0.9, 3, shade(Palette.hazard, -0.1));
  flame(g, c.x, fireY - 2, 9, height * 1.3, 0, Palette.hazard);
  flame(g, c.x, fireY - 2, 5, height * 1.0, 0, shade(Palette.gold, 0.05));
  flame(g, c.x, fireY - 1, 2.5, height * 0.65, 0, shade(Palette.gold, 0.45));
}

/**
 * The sprite for a structure, in the orientation it was placed.
 *
 * Rotation reaches only the two defs that have a long axis. Everything else covers one
 * cell and looks identical from every side, so taking a rotation it ignores keeps the
 * caller from having to know which is which.
 */
export function buildBuildingGraphics(
  def: BuildingId,
  rotation: Rotation = 0,
  locked = false,
): Graphics {
  const g = new Graphics();
  switch (def) {
    case Building.Bedroll:
      drawBedroll(g, rotation);
      break;
    case Building.Wall:
      drawWall(g);
      break;
    case Building.Door:
      drawDoor(g, rotation, locked);
      break;
    case Building.Campfire:
      drawCampfire(g);
      break;
    case Building.Bed:
      drawBed(g, rotation);
      break;
    case Building.Hearth:
      drawHearth(g);
      break;
  }
  return g;
}

/**
 * The draw list for a structure — the one entry point, whichever way it is drawn.
 *
 * Two paths converge here, and the seam is deliberate and temporary. A **modelled**
 * structure is a handful of solids in tile space, rasterized with surface texture, contact
 * shadow and a bevel — per-pixel work no vector fill can express, and the measured
 * difference between "basic" and "formed". Everything else is still the hand-drawn
 * `Graphics`, adapted into the same form so the harness measures both the same way.
 *
 * M13 and M14 convert the rest as they touch them. Until then nothing on the vector path
 * changes by a single pixel, which is what keeps a pure-infrastructure milestone from
 * quietly restyling the game.
 */
export function buildBuildingDrawList(
  def: BuildingId,
  rotation: Rotation = 0,
  locked = false,
): DrawList {
  if (isModelled(def)) {
    return renderModel(MODELLED[def](), {
      footprint: buildingDef(def).footprint,
      rotation,
      rise: BUILDING_HEIGHT[def],
    });
  }
  return drawListFromGraphics(buildBuildingGraphics(def, rotation, locked).context, `building:${def}`);
}

/**
 * A blueprint, or a part-built frame.
 *
 * Drawn as an outline that fills in as work progresses, so the player can read how far
 * along a site is without selecting it.
 */
export function buildSiteGraphics(stage: number): Graphics {
  const g = new Graphics();
  const filled = stage / (SITE_STAGES - 1);

  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 3, HALF_TILE_H - 1.5).fill({
    color: Palette.energy,
    alpha: 0.1 + filled * 0.28,
  });
  diamond(g, HALF_TILE_W, HALF_TILE_H, HALF_TILE_W - 3, HALF_TILE_H - 1.5).stroke({
    width: 1,
    color: Palette.energy,
    alpha: 0.75,
  });

  // A small riser once materials are in, so "waiting for stone" and "being built" look
  // different at a glance.
  if (filled > 0.5) {
    const height = Math.round(6 * filled);
    leftFace(g, 0, height).fill({ color: Palette.energy, alpha: 0.22 });
    rightFace(g, 0, height).fill({ color: Palette.energy, alpha: 0.32 });
  }

  return g;
}

export const SITE_STAGES = 4;

export function siteStageFor(progress: number): number {
  return Math.min(SITE_STAGES - 1, Math.floor(progress * SITE_STAGES));
}
