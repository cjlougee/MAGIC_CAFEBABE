/**
 * The art harness.
 *
 * M10 and M11 shipped seven art bugs and caught every one of them late, by eye. **Six
 * were measurements, not judgements**, and each has an assertion below named after it.
 * The seventh — "the shading is an awkward line, hard to tell what it is supposed to be"
 * — has none, and never will. That is the division this milestone exists to draw:
 * automate the measurable completely, so the only thing left to look at is taste.
 *
 * Everything here runs headless in plain node. Pixi builds a `Graphics` with no GPU, no
 * canvas and no DOM, so the whole sprite set is measurable without a dev server, a
 * browser or a screenshot — which is what makes looking properly cheap enough to do every
 * time rather than at the end.
 */

import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { REVIEW_PAWN, spriteManifest, type SpriteEntry } from '../src/render/art/manifest';
import { LIT_SHIFT, MIN_FEATURE } from '../src/render/art/language';
import { cellsOf, headCellOf, ROTATIONS, type Rotation } from '../src/sim/world/footprint';
import { Building, type BuildingId } from '../src/sim/defs/buildings';
import { footprintCentre, sleeperCentreAt } from '../src/render/placement';
import { BUILDING_HEIGHT, buildBuildingDrawList } from '../src/render/art/buildingArt';
import { GROUND_LEVEL } from '../src/sim/core/position';
import { footprintCellCentre, tileToWorld } from '../src/render/iso';
import { HALF_TILE_W } from '../src/render/constants';
import { drawListFromGraphics, paintedInstructions } from '../src/render/art/raster/fromGraphics';
import { footprintMask } from '../src/render/art/raster/footprintMask';
import { selfIntersections } from '../src/render/art/raster/geometry';
import {
  ascii,
  countMask,
  inkMask,
  maskBounds,
  outside,
  samePixels,
  silhouette,
  visibleCounts,
} from '../src/render/art/raster/measure';
import { rasterize } from '../src/render/art/raster/raster';
import { Palette, PawnPalette, shade } from '../src/render/art/palette';

const MANIFEST = spriteManifest();
const cases = MANIFEST.map((s) => [s.key, s] as const);

function render(sprite: SpriteEntry) {
  const list = sprite.draw();
  return { list, raster: rasterize(list, sprite.width, sprite.height) };
}

describe('pixi runs headless under vitest', () => {
  /*
   * The load-bearing fact. If this ever fails, nothing else in this file means anything —
   * and the failure would look like forty confusing assertion errors rather than one
   * honest "the renderer stopped building geometry on the CPU".
   */
  it('builds a Graphics with no renderer, and normalises every primitive', () => {
    const g = new Graphics();
    g.poly([0, 0, 10, 0, 10, 10]).fill({ color: 1 });
    g.ellipse(20, 5, 4, 3).fill({ color: 2 });
    g.rect(30, 0, 6, 6).fill({ color: 3 });
    g.roundRect(40, 0, 6, 6, 2).fill({ color: 4 });

    const kinds = paintedInstructions(g.context).flatMap((i) =>
      i.primitives.map((p) => p.shape.type),
    );
    expect(kinds).toEqual(['polygon', 'ellipse', 'rectangle', 'roundedRectangle']);
  });

  it('composites in painter order, last mark on top', () => {
    const g = new Graphics();
    g.rect(0, 0, 4, 4).fill({ color: 0x111111 });
    g.rect(2, 2, 4, 4).fill({ color: 0x222222 });

    const raster = rasterize(drawListFromGraphics(g.context), 6, 6);
    const px = (x: number, y: number) => raster.rgba[(y * 6 + x) * 4 + 2];
    expect(px(0, 0)).toBe(0x11);
    expect(px(3, 3)).toBe(0x22);
    expect(raster.owner[3 * 6 + 3]).toBe(1);
  });
});

describe('every sprite draws something', () => {
  it.each(cases)('%s has ink', (_key, sprite) => {
    const { raster } = render(sprite);
    expect(countMask(inkMask(raster))).toBeGreaterThan(0);
  });
});

describe('no polygon crosses itself', () => {
  /*
   * `isoCapsule` branched on raw argument order, and rotations 2 and 3 hand over the head
   * end second — so for exactly those two facings the outline wound into a bow-tie. It
   * survived two milestones, was invisible at play zoom, and was obvious within a minute
   * of `sprites.html` existing. This is that minute, spent automatically.
   */
  it.each(MANIFEST.filter((s) => s.vector).map((s) => [s.key, s] as const))('%s', (_key, sprite) => {
    const faults = selfIntersections(sprite.vector!());
    expect(
      faults,
      faults.length
        ? `polygon ${faults[0].mark} crosses itself between edges ` +
          `${faults[0].edges.join(' and ')}: [${faults[0].points.map((n) => Math.round(n)).join(', ')}]`
        : '',
    ).toEqual([]);
  });
});

describe('ink stays inside the frame', () => {
  /*
   * `generateTexture` crops to the Graphics' bounds, and the layers position sprites
   * assuming an exact stated frame. Art that overshoots produces a larger texture drawn
   * offset — which is how grass drew a dark seam above every tile.
   */
  it.each(cases)('%s', (_key, sprite) => {
    /*
     * Measured on the *draw list*, not on a Graphics' bounds, so both ways of making art
     * are held to it. A model cannot escape sideways — its solids live inside the
     * footprint's own tile range — but it can absolutely escape upward by declaring a
     * solid taller than the rise its frame was cut for, and that reads as a sprite with
     * its head sliced off.
     */
    const over = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const mark of sprite.draw()) {
      const b = mark.coverage.bounds;
      over.left = Math.max(over.left, Math.ceil(Math.max(0, -b.x)));
      over.top = Math.max(over.top, Math.ceil(Math.max(0, -b.y)));
      over.right = Math.max(over.right, Math.ceil(Math.max(0, b.x + b.width - sprite.width)));
      over.bottom = Math.max(over.bottom, Math.ceil(Math.max(0, b.y + b.height - sprite.height)));
    }
    expect(over, `ink escapes the ${sprite.width}x${sprite.height} frame`).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });
});

describe('ink stands on the footprint it claims', () => {
  /*
   * The strong form, and the one that matters. "Inside the frame" is a weak promise: the
   * frame is `TILE_H + rise` tall, so a hearth drawn at the very top of its own frame is
   * inside it and standing on nothing — which is precisely the bug that shipped, with the
   * footprint visibly floating underneath it.
   */
  const footprinted = MANIFEST.filter((s) => s.contract.containment === 'footprint' && s.footprint);

  it.each(footprinted.map((s) => [s.key, s] as const))('%s', (_key, sprite) => {
    const { raster } = render(sprite);
    const { w, h } = sprite.footprint!;
    const ink = inkMask(raster);
    const allowed = footprintMask(sprite.width, sprite.height, w, h, sprite.rise);

    const stray = outside(ink, allowed);
    const fraction = stray / countMask(ink);
    const budget = sprite.contract.mayOverhang ?? 0;

    expect(
      fraction <= budget,
      `${stray}px (${(fraction * 100).toFixed(1)}%) of ink lies outside a ${w}x${h} ` +
        `footprint rising ${sprite.rise}px, against a declared ${(budget * 100).toFixed(0)}% ` +
        `budget\n${ascii(raster)}`,
    ).toBe(true);
  });
});

describe('every mark earns its place', () => {
  /*
   * The lock bar was drawn behind the near jamb. It was *correct* — a bar does sit between
   * the frames — and all the player could see was two pixels, which is a lock they have to
   * remember rather than read.
   *
   * Zero is the same measure at its limit, and legitimately reached: the bed's two far
   * legs are meant to be invisible. The difference between that and the lock bar is not
   * in the pixels, it is in whether somebody wrote it down — so `mayHide` takes a reason.
   */
  it.each(cases)('%s', (_key, sprite) => {
    const { list, raster } = render(sprite);
    const { minVisibleInk, mayHide } = sprite.contract;
    const counts = visibleCounts(raster, list.length);

    const faint = counts
      .map((visible, index) => ({ index, visible }))
      .filter(({ visible }) => visible < minVisibleInk);

    /*
     * Exact, not "at most". A ratchet that only tightens catches a bar disappearing
     * behind a jamb; one that holds in both directions also catches a leg *reappearing*,
     * which means the declaration has stopped describing the art it was written for.
     */
    const declared = mayHide?.count ?? 0;
    expect(
      faint.length,
      faint.length > declared
        ? `mark ${faint.find((f) => f.visible < minVisibleInk)!.index} contributes ` +
          `${faint[0].visible}px, under the ${minVisibleInk}px floor, and ${declared} ` +
          `mark(s) are declared hidden. Fix it, or say why in mayHide.`
        : `${declared} marks are declared hidden ("${mayHide?.why}") but only ` +
          `${faint.length} are. The art moved out from under the declaration.`,
    ).toBe(declared);
  });
});

describe('proportions', () => {
  /*
   * The first sleeping pose was six times longer than it was wide — a plank with a head
   * stuck on one end. The correction overshot and covered half the bedroll. Both are one
   * ratio away from being caught.
   */
  const shaped = MANIFEST.filter((s) => s.contract.aspect);

  it.each(shaped.map((s) => [s.key, s] as const))('%s', (_key, sprite) => {
    const { raster } = render(sprite);
    const box = maskBounds(inkMask(raster), sprite.width)!;
    const ratio = box.width / box.height;
    const [min, max] = sprite.contract.aspect!;

    expect(
      ratio >= min && ratio <= max,
      `ink is ${box.width}x${box.height}, ratio ${ratio.toFixed(2)}, ` +
        `outside the declared ${min}–${max}\n${ascii(raster)}`,
    ).toBe(true);
  });
});

describe('rotations differ when they must, and match when they must', () => {
  /*
   * Rotations 0 and 2 cover *identical cells*. The pillow moving end to end is the entire
   * visible difference between them, and without it "rotate the bed" is a control that
   * does nothing. A hearth is square and must be the opposite: turning it is a no-op, and
   * a difference would mean rotation leaked somewhere it does not belong.
   */
  const withRules = MANIFEST.filter(
    (s) => s.rotation === 0 && (s.contract.rotationsDiffer || s.contract.rotationsMatch),
  );

  it.each(withRules.map((s) => [s.group, s] as const))('%s', (_group, sprite) => {
    /*
     * Rendered from `buildBuildingDrawList` rather than looked up in the manifest.
     *
     * The manifest only carries all four facings for structures that are `orientable`,
     * because three duplicate rows in every four made the contact sheet a worse review
     * surface once there were seventeen structures on it. That is a decision about the
     * *sheet*; this is a claim about the *function*, and it would be a poor check if
     * turning off a row could turn off an assertion. Frame comes from the sprite, whose
     * footprint bounds are rotation-invariant for anything this rule is applied to.
     */
    const building = Number(sprite.key.split(':')[1]) as BuildingId;
    const rasterFor = (rotation: number) =>
      rasterize(
        buildBuildingDrawList(building, rotation as Rotation, false),
        sprite.width,
        sprite.height,
      );

    for (const [a, b] of sprite.contract.rotationsDiffer ?? []) {
      expect(samePixels(rasterFor(a), rasterFor(b)), `rot ${a} and rot ${b} are identical`).toBe(
        false,
      );
    }
    for (const [a, b] of sprite.contract.rotationsMatch ?? []) {
      expect(samePixels(rasterFor(a), rasterFor(b)), `rot ${a} and rot ${b} differ`).toBe(true);
    }
  });
});

describe('the colonist has a face', () => {
  /*
   * The assertion no per-mark floor could make.
   *
   * `drawHair` drew a crown ellipse both wider *and* taller than the skull it sat on, for
   * three of the five styles, so the hair covered the head outright. Measured on the style
   * the sheet happened to render: the head contributed **six** visible pixels, all of them
   * chin and jaw corner, and both eyes were `Palette.ink` painted onto hair.
   *
   * `mayHide` counts marks at *zero* and the floor is 2 — an eye is deliberately two pixels
   * on a 26px figure. Six is neither, so the harness reported two hidden marks (the
   * crescent and its cut-back) and had nothing to say about the face they were meant to be
   * on. **The floor is the wrong instrument**: it asks whether a mark exists, and the
   * question here is whether a mark is still big enough to be the thing it is for.
   *
   * So this measures the face directly, and on **every** style — the defect was
   * style-dependent, which is exactly why one entry on the sheet was not enough.
   */
  const skin = PawnPalette.skin[REVIEW_PAWN.skinTone];
  const lit = shade(skin, LIT_SHIFT);

  /** Face pixels: the skin base and its sunward crescent, wherever they survive. */
  const faceTones = new Set([skin, lit]);

  /**
   * Measured at 62 with the fix in, against 6 before it. Set at 40 so an ordinary style
   * change has room and a burial does not: the gap between a face and no face is an order
   * of magnitude, not a few pixels.
   */
  const MIN_FACE = 40;

  it.each(
    MANIFEST.filter((s) => s.key.startsWith('pawn:standing')).map((s) => [s.key, s] as const),
  )('%s shows skin below the hairline', (_key, sprite) => {
    const { raster } = render(sprite);

    let face = 0;
    for (let i = 0; i < raster.rgba.length; i += 4) {
      if (raster.rgba[i + 3] < 255) continue;
      const colour = (raster.rgba[i] << 16) | (raster.rgba[i + 1] << 8) | raster.rgba[i + 2];
      if (faceTones.has(colour)) face++;
    }

    expect(
      face,
      `only ${face}px of face survive this hair style — the head is buried under it, ` +
        `and the eyes are being drawn onto hair\n${ascii(raster)}`,
    ).toBeGreaterThanOrEqual(MIN_FACE);
  });

  it('the sunward crescent is visible, on every style', () => {
    /*
     * Stated separately from the face count because it is a *different* failure. A face
     * can be perfectly visible with the crescent still buried — that is the state the last
     * milestone shipped — and the crescent is the shape language's own worked example, on
     * the most-looked-at sprite in the game. If it is invisible here it is decoration
     * nobody reads, and the rule it demonstrates is not being demonstrated.
     */
    for (const sprite of MANIFEST.filter((s) => s.key.startsWith('pawn:standing'))) {
      const { raster } = render(sprite);
      let crescent = 0;
      for (let i = 0; i < raster.rgba.length; i += 4) {
        const colour = (raster.rgba[i] << 16) | (raster.rgba[i + 1] << 8) | raster.rgba[i + 2];
        if (raster.rgba[i + 3] === 255 && colour === lit) crescent++;
      }
      // `language.ts`' own floor: below it a mark is not a detail the player reads.
      expect(crescent, `${sprite.key} draws no visible sunward crescent`).toBeGreaterThanOrEqual(
        MIN_FEATURE,
      );
    }
  });
});

describe('a resting mark stays attached to what it rests on', () => {
  /*
   * The head floated outside the blanket, twice. A capsule's end is a *diagonal* edge
   * between its west and north vertices, not a point on the centre line, so an offset
   * measured along the body overshoots that edge long before it reaches the silhouette's
   * tip — and the head lands free at the corner.
   *
   * **Overlap, not containment**, and the first draft of this test got it backwards. A
   * head on a pillow is *supposed* to extend past the blanket's end: that is what makes
   * it a head rather than a bulge. Measured, two thirds of it lies beyond the blanket and
   * the sprite is fine. What went wrong in M10 was the head coming *away* — so the thing
   * to assert is that enough of it still lands on the bedding to read as attached, which
   * a head floating at the corner fails at zero.
   *
   * Needs the blanket's *whole* shape, not the part still showing once the head is on
   * top, so the two slices are rasterized separately.
   */
  const BLANKET_MARKS = 3;
  const MIN_OVERLAP = 0.25;

  it.each(
    MANIFEST.filter((s) => s.key.startsWith('pawn:asleep')).map((s) => [s.key, s] as const),
  )('%s keeps the head on the bedding', (_key, sprite) => {
    const list = sprite.draw();
    const blanket = silhouette(list.slice(0, BLANKET_MARKS), sprite.width, sprite.height);
    const head = silhouette(list.slice(BLANKET_MARKS), sprite.width, sprite.height);

    const headPixels = countMask(head);
    const resting = headPixels - outside(head, blanket);

    expect(
      resting / headPixels,
      `only ${resting} of ${headPixels} head pixels touch the blanket — the head has ` +
        `come away from the bedding\n${ascii(rasterize(list, sprite.width, sprite.height))}`,
    ).toBeGreaterThan(MIN_OVERLAP);
  });
});

describe('placement: a sleeper lies on the bed, not beside it', () => {
  /*
   * A **placement** contract rather than a sprite one, and the distinction is the whole
   * reason both exist. The sleeping sprite is fine in isolation — right proportions, head
   * on the bedding, ink inside its frame — and it was still wrong on screen for two
   * milestones, because `ObjectLayer` centred it on the pawn's own cell while the pawn
   * sleeps at `headCellOf`, one end of a 2×1. The body ran half its length past the head
   * of the bed and reached only the middle of it.
   *
   * No amount of measuring the sprite would ever have caught that. What has to be measured
   * is the sprite *against the cells the bed claims*, which is what this does: project both
   * into world pixels the way the layer does, and check the pose lands on the bed.
   */
  const BED = { w: 2, h: 1 };

  /** Where `ObjectLayer` puts the sleeping sprite's centre, in world pixels. */
  function poseCentre(anchor: { x: number; y: number; z: number }, rotation: Rotation) {
    const cells = cellsOf(anchor, BED, rotation);
    const mean = cells.reduce((sum, c) => ({ x: sum.x + c.x, y: sum.y + c.y }), { x: 0, y: 0 });
    return tileToWorld(mean.x / cells.length, mean.y / cells.length, anchor.z);
  }

  it.each(ROTATIONS.map((r) => [r] as const))(
    'rotation %i centres the pose on the footprint, not the head cell',
    (rotation) => {
      const anchor = { x: 10, y: 10, z: GROUND_LEVEL };
      const centre = poseCentre(anchor, rotation);
      const head = headCellOf(anchor, BED, rotation);
      const headCentre = tileToWorld(head.x, head.y, head.z);

      // The two differ by half a tile along the bed's axis — which is exactly the error
      // that was on screen, and exactly what the fix removes.
      const drift = Math.hypot(centre.x - headCentre.x, centre.y - headCentre.y);
      expect(drift, 'the head cell is not the footprint centre of a 2x1').toBeGreaterThan(0);

      // Every cell of the bed must be nearer the pose's centre than half the bed's length,
      // i.e. the pose sits between the two cells rather than over one of them.
      for (const cell of cellsOf(anchor, BED, rotation)) {
        const at = tileToWorld(cell.x, cell.y, cell.z);
        expect(
          Math.hypot(at.x - centre.x, at.y - centre.y),
          `cell ${cell.x},${cell.y} is not covered by a pose centred on the footprint`,
        ).toBeLessThanOrEqual(HALF_TILE_W);
      }
    },
  );

  it.each(ROTATIONS.map((r) => [r] as const))(
    'rotation %i lifts the sleeper onto the bed, not the floor under it',
    (rotation) => {
      /*
       * The second correction, and the one that shipped wrong. A bed stands 11px off the
       * ground; a sleeper anchored at their own ground line lies on the floor beneath it
       * with their head hanging off the end. A bedroll's rise is 3px, so the same error is
       * nearly invisible there — which is exactly how it read: "beds are broken, bedrolls
       * are fine".
       */
      const anchor = { x: 10, y: 10, z: GROUND_LEVEL };
      const onBed = sleeperCentreAt(Building.Bed, anchor, rotation);
      const ground = footprintCentre(cellsOf(anchor, { w: 2, h: 1 }, rotation), anchor.z);

      expect(onBed.x, 'lifting must not shift the pose along the bed').toBe(ground.x);
      expect(
        ground.y - onBed.y,
        'the sleeper must rise by exactly the height of what they are lying on',
      ).toBe(BUILDING_HEIGHT[Building.Bed]);
    },
  );

  it('lifts by less for a bedroll, which is why that one always looked fine', () => {
    const anchor = { x: 3, y: 3, z: GROUND_LEVEL };
    const bed = footprintCentre(cellsOf(anchor, { w: 2, h: 1 }, 0), anchor.z).y
      - sleeperCentreAt(Building.Bed, anchor, 0).y;
    const bedroll = footprintCentre(cellsOf(anchor, { w: 2, h: 1 }, 0), anchor.z).y
      - sleeperCentreAt(Building.Bedroll, anchor, 0).y;

    expect(bed).toBeGreaterThan(bedroll);
    expect(bedroll).toBe(BUILDING_HEIGHT[Building.Bedroll]);
  });

  /*
   * The check that would have caught it as a *picture*, not just as arithmetic.
   *
   * The composed scene draws the sleeper on the bed at the offsets the layer really uses,
   * so a pose sitting 11px low puts most of its ink below the bed's silhouette. Measured
   * with the lift correct: 10–16% of the pose falls outside the bed, which is a head
   * extending past the pillow and shoulders past the mattress — both right. Dropping the
   * lift roughly triples it.
   */
  const MAX_OFF_BED = 0.25;

  it.each(
    MANIFEST.filter((s) => s.key.startsWith('scene:asleep')).map((s) => [s.key, s] as const),
  )('%s lands the pose on the furniture, not the floor beside it', (_key, sprite) => {
    const building = Number(sprite.key.split(':')[2]) as BuildingId;
    const furnitureMarks = buildBuildingDrawList(building, sprite.rotation, false).length;
    const list = sprite.draw();

    const furniture = silhouette(list.slice(0, furnitureMarks), sprite.width, sprite.height);
    const pose = silhouette(list.slice(furnitureMarks), sprite.width, sprite.height);
    const posePixels = countMask(pose);
    const off = outside(pose, furniture) / posePixels;

    expect(
      off <= MAX_OFF_BED,
      `${(off * 100).toFixed(0)}% of the sleeping pose falls outside the furniture it is ` +
        `lying on — they are beside it, or on the floor underneath it`,
    ).toBe(true);
  });

  it('reduces to the tile centre for a 1x1, so nothing already centred moves', () => {
    const anchor = { x: 4, y: 7, z: GROUND_LEVEL };
    const cells = cellsOf(anchor, { w: 1, h: 1 }, 0);
    const mean = cells.reduce((s, c) => ({ x: s.x + c.x, y: s.y + c.y }), { x: 0, y: 0 });
    const centre = tileToWorld(mean.x / cells.length, mean.y / cells.length, anchor.z);
    expect(centre).toEqual(tileToWorld(anchor.x, anchor.y, anchor.z));
  });
});

describe('the facing end is the end the simulation says it is', () => {
  /*
   * ADR 0009 keeps four rotations when two would cover the cells, and the entire thing it
   * buys is **facing**: `headCellOf` is the only thing that can tell rotation 0 from
   * rotation 2, and without it "rotate the bed" is a control that visibly does nothing.
   *
   * That makes the art a load-bearing part of the decision, and until now nothing checked
   * it. A bed whose pillow drifted to the wrong end would round-trip perfectly through the
   * save, hash identically, place identically, and be wrong on screen in the one way the
   * rotation exists to prevent — a colonist sleeping with their head at the foot.
   */
  const PILLOW = 'pillow';

  it.each(ROTATIONS.map((r) => [r] as const))('bed rotation %i', (rotation) => {
    const sprite = MANIFEST.find((s) => s.key === `building:4:${rotation}:open`)!;
    const { list, raster } = render(sprite);

    // Centroid of the pillow's ink, in frame pixels.
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    for (let i = 0; i < raster.owner.length; i++) {
      const owner = raster.owner[i];
      if (owner < 0 || !list[owner].label.startsWith(PILLOW)) continue;
      sumX += i % sprite.width;
      sumY += (i / sprite.width) | 0;
      n++;
    }
    expect(n, 'the bed draws no pillow at all').toBeGreaterThan(0);
    const centroid = { x: sumX / n, y: sumY / n };

    // Where the simulation says the facing end is, projected into the same frame.
    const anchor = { x: 0, y: 0, z: GROUND_LEVEL };
    const { w, h } = sprite.footprint!;
    const head = headCellOf(anchor, { w: 2, h: 1 }, rotation);
    const cells = cellsOf(anchor, { w: 2, h: 1 }, rotation);

    const distanceTo = (cell: { x: number; y: number }) => {
      const at = footprintCellCentre(cell.x, cell.y, h, sprite.rise);
      return Math.hypot(at.x - centroid.x, at.y - centroid.y);
    };

    const toHead = distanceTo(head);
    const toOther = Math.min(...cells.filter((c) => c.x !== head.x || c.y !== head.y).map(distanceTo));

    expect(
      toHead < toOther,
      `the pillow sits ${toHead.toFixed(1)}px from the head cell (${head.x},${head.y}) and ` +
        `${toOther.toFixed(1)}px from the foot — a colonist would sleep the wrong way round ` +
        `in a ${w}x${h} at rotation ${rotation}`,
    ).toBe(true);
  });
});

describe('colours come from the palette', () => {
  /*
   * The palette *is* the art direction, and coherence is the entire reason procedural art
   * works here. A hex literal in an art file is a colour nobody can find when the
   * direction changes.
   */
  const known = new Set<number>([
    ...Object.values(Palette),
    ...PawnPalette.skin,
    ...PawnPalette.hair,
    ...PawnPalette.apparel,
  ]);

  it('no sprite introduces a base colour the palette has never heard of', () => {
    // Shades and blends of palette entries are the whole shading model, so the check is
    // on the *literals the art names*, not on every tone that reaches a pixel.
    const strays: string[] = [];
    for (const sprite of MANIFEST) {
      if (!sprite.vector) continue;
      for (const { color: colour } of paintedInstructions(sprite.vector())) {
        if (known.has(colour)) continue;
        // A derived tone is a shade of something known; an invented one is not close to
        // anything. Distance in RGB is crude and sufficient to tell them apart.
        if (![...known].some((base) => near(base, colour))) {
          strays.push(`${sprite.key}: #${colour.toString(16).padStart(6, '0')}`);
        }
      }
    }
    expect([...new Set(strays)]).toEqual([]);
  });

  function near(a: number, b: number): boolean {
    const d = (shift: number) => Math.abs(((a >> shift) & 0xff) - ((b >> shift) & 0xff));
    return d(16) + d(8) + d(0) < 120;
  }
});
