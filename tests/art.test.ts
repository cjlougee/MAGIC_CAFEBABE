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
import { spriteManifest, type SpriteEntry } from '../src/render/art/manifest';
import { cellsOf, headCellOf, ROTATIONS, type Rotation } from '../src/sim/world/footprint';
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
import { Palette, PawnPalette } from '../src/render/art/palette';

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
    const siblings = MANIFEST.filter((s) => s.group === sprite.group && s.key.endsWith('open'));
    const rasterFor = (rotation: number) => {
      const found = siblings.find((s) => s.rotation === rotation)!;
      return render(found).raster;
    };

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
