/**
 * Every sprite in the game, in one list, with what it promises about itself.
 *
 * Three surfaces read this: `tests/art.test.ts` asserts against it, `tools/bakeArt.ts`
 * draws the contact sheet from it, and `sprites.html` renders it for a human. Before it
 * existed, adding a sprite meant hand-editing a bespoke review page and remembering to —
 * which is how the sleeping pose reached the sheet two milestones after the buildings did.
 *
 * A **contract** is the part a test can check. It is deliberately per-sprite rather than
 * global, because the interesting cases are all exceptions: the bed's two far legs are
 * *meant* to be invisible, and a rule that forbade hidden marks outright would have to be
 * switched off for the bed and would then be off for the bed's real bugs too.
 */

import type { GraphicsContext } from 'pixi.js';
import { Building, BUILDING_DEFS, buildingDef, type BuildingId } from '../../sim/defs/buildings';
import { ROTATIONS, sizeOf, type Footprint, type Rotation } from '../../sim/world/footprint';
import { GROUND_LEVEL } from '../../sim/core/position';
import { footprintBounds } from '../iso';
import { sleeperCentreAt } from '../placement';
import { BUILDING_HEIGHT, buildBuildingDrawList, buildBuildingGraphics } from './buildingArt';
import { isModelled } from './model/buildingModels';
import { translate, type DrawList } from './raster/drawList';
import { drawListFromGraphics } from './raster/fromGraphics';
import {
  buildPawnGraphics,
  buildSleepingPawnGraphics,
  HAIR_STYLES,
  PAWN_ASLEEP_GROUND_Y,
  PAWN_ASLEEP_H,
  PAWN_ASLEEP_W,
  PAWN_H,
  PAWN_W,
} from './pawnArt';

export interface SpriteContract {
  /**
   * How many marks are *meant* to end up under something else, and why.
   *
   * Declared rather than tolerated. The door's lock bar survived as two visible pixels
   * because nothing was counting; the bed's far legs are hidden on purpose because you
   * cannot see the far legs of a bed either. The difference is not in the pixels — it is
   * in whether somebody wrote it down.
   *
   * A **count**, not a list of indices, because which mark is hidden changes with
   * rotation: at rotation 0 the bed buries its fourth leg, at rotation 1 its first. The
   * count holds across all four, and asserting it *exactly* makes it a ratchet in both
   * directions — a leg that reappears fails just as loudly as a bar that vanishes.
   */
  readonly mayHide?: { readonly count: number; readonly why: string };
  /**
   * Fewest visible pixels a mark may contribute and still be worth drawing.
   *
   * The lock bar's two pixels are the calibration. Below roughly this, a mark is not a
   * detail the player reads, it is a detail the player has to already know about.
   */
  readonly minVisibleInk: number;
  /**
   * Where the ink is allowed to be.
   *
   * `footprint` is the strong form: inside the projected diamonds of the cells the
   * structure claims, extruded upward by its own rise. That is the check that would have
   * caught a hearth drawn a whole storey above its own footprint.
   */
  readonly containment: 'frame' | 'footprint';
  /**
   * Fraction of ink permitted outside the footprint, for art that leans over its own edge
   * on purpose.
   *
   * Zero is the default and the right answer for almost everything. Where it is not, the
   * measured figure goes in the comment beside it, so the allowance is a recorded number
   * rather than a shrug — and any *increase* still fails.
   */
  readonly mayOverhang?: number;
  /** Bounds on ink width ÷ ink height. Catches a pose six times longer than it is wide. */
  readonly aspect?: readonly [number, number];
  /** Rotation pairs that must render differently, and pairs that must render identically. */
  readonly rotationsDiffer?: readonly (readonly [Rotation, Rotation])[];
  readonly rotationsMatch?: readonly (readonly [Rotation, Rotation])[];
}

export interface SpriteEntry {
  /** Stable id: `building:4:1`. The cache key shape the ArtProvider already uses. */
  readonly key: string;
  /** Heading on the contact sheet — one group per row. */
  readonly group: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** How far it rises off the ground plane, in frame pixels. 0 for flat art. */
  readonly rise: number;
  /** Rotated footprint in cells, or `undefined` for art that does not claim ground. */
  readonly footprint?: Footprint;
  readonly rotation: Rotation;
  /**
   * The sprite, in the one form everything downstream reads.
   *
   * A draw list rather than a `Graphics`, because there are now two ways art gets made —
   * hand-drawn vectors and solids in tile space — and the harness must not care which. A
   * check that only ran on one of them would go quiet exactly when new art arrived.
   */
  draw(): DrawList;
  /**
   * The vector source, where there is one.
   *
   * Only vector art can wind its outline into a bow-tie; a model's faces are convex quads
   * by construction. So this is optional, and the polygon check simply has nothing to say
   * about modelled sprites — which is a property of the approach, not a gap in the test.
   */
  vector?(): GraphicsContext;
  readonly contract: SpriteContract;
}

const DEFAULT: SpriteContract = { minVisibleInk: 6, containment: 'footprint' };

/**
 * Per-building contracts, keyed by id.
 *
 * Every exception here is a sentence about the art, not a workaround. If one of these
 * needs relaxing to make a change pass, that is the moment to check whether the change
 * is right rather than whether the number is.
 */
const BUILDING_CONTRACTS: Partial<Record<BuildingId, Partial<SpriteContract>>> = {
  /*
   * Four posts, two visible faces each once their tops are suppressed. Exactly one leg —
   * the far one — is entirely behind the frame, and which one that is changes with the
   * rotation while the count does not. Two marks, in all four facings.
   */
  4: {
    mayHide: { count: 2, why: 'the far leg stands entirely behind the frame' },
    rotationsDiffer: [[0, 2]],
  },
  // A roll of cloth: the pillow moving end to end is the whole visible difference
  // between the two facings that cover identical cells.
  0: { rotationsDiffer: [[0, 2]] },
  // Square and drawn the same from every side; turning it must be a no-op, and a
  // difference here would mean rotation had leaked somewhere it does not belong.
  5: { rotationsMatch: [[0, 1], [0, 2], [0, 3]] },
  /*
   * The jambs are centred *on* the tile's edge vertices, because a door has to continue
   * the wall run it interrupts rather than sit inside its own cell looking like a short
   * wall. Half of each jamb therefore lies over the neighbouring cell — which is where
   * the wall it is continuing actually is. Measured at 13% of the door's ink.
   */
  2: { mayOverhang: 0.16 },
  /*
   * The stone ring is an *ellipse* inscribed in the tile's bounding box, and a tile is a
   * diamond — so the stones nearest the four diagonals sit outside it. Measured at 4%.
   * Small, deliberate, and the reason the number is written down rather than the rule
   * quietly dropped.
   */
  3: { mayOverhang: 0.06 },
  /*
   * The same case as the bed, and reached the same way: four posts, and the far one stands
   * entirely behind the seat. Which post that is changes with the facing while the count
   * does not — two marks, in all four rotations, because a leg's top is hidden by
   * construction and only its two side faces are ever drawn.
   */
  7: {
    mayHide: { count: 2, why: 'the far leg stands entirely behind the seat' },
    rotationsDiffer: [[0, 2]],
  },
  8: {
    mayHide: { count: 2, why: 'the far leg stands entirely behind the table top' },
    rotationsMatch: [[0, 1], [0, 2], [0, 3]],
  },
  // The drawer bank is at one end, so turning the desk has to move it end to end.
  9: { rotationsDiffer: [[0, 2]] },
  // The uprights are symmetric; the lips are all on the front, so the facings differ.
  10: { rotationsDiffer: [[0, 2]] },
  // The cloth hangs on one side of the pole.
  16: { rotationsDiffer: [[0, 2]] },
};

/**
 * Which facings of a structure are worth a row on the sheet.
 *
 * All four for anything `orientable`, and rotation 0 alone for the rest. A wall, a
 * campfire and a hearth each occupied four identical rows, which was affordable at six
 * structures and is not at seventeen — the sheet is the review surface, and three
 * duplicate rows in every four is a worse one.
 *
 * The check that turning a square structure really *is* a no-op does not live here and
 * never did: `rotationsMatch` renders its siblings through `buildBuildingDrawList`
 * directly, which tests the function rather than this list.
 */
function facingsOf(def: { orientable: boolean }): readonly Rotation[] {
  return def.orientable ? ROTATIONS : [0];
}

function buildingEntries(): SpriteEntry[] {
  const entries: SpriteEntry[] = [];

  for (const def of BUILDING_DEFS) {
    const states = def.lockable ? [false, true] : [false];
    for (const locked of states) {
      for (const rotation of facingsOf(def)) {
        const size = sizeOf(def.footprint, rotation);
        const rise = BUILDING_HEIGHT[def.id];
        const box = footprintBounds(0, 0, size.w, size.h, 0, rise);

        entries.push({
          key: `building:${def.id}:${rotation}:${locked ? 'locked' : 'open'}`,
          group: def.name,
          label: `rot ${rotation}${locked ? ' · locked' : ''}`,
          width: box.width,
          height: box.height,
          rise,
          footprint: size,
          rotation,
          draw: () => buildBuildingDrawList(def.id, rotation, locked),
          vector: isModelled(def.id)
            ? undefined
            : () => buildBuildingGraphics(def.id, rotation, locked).context,
          contract: { ...DEFAULT, ...BUILDING_CONTRACTS[def.id] },
        });
      }
    }
  }

  return entries;
}

/** A stand-in colonist. Any appearance will do — the pose is what is under review. */
export const REVIEW_PAWN = { skinTone: 1, hairStyle: 2, hairColour: 0, apparelColour: 3 };

/**
 * A colonist, once per hair style.
 *
 * **One entry was the gap that shipped the faceless colonist.** The defect was
 * style-dependent — a crown ellipse larger than the skull, on three styles of five — and
 * the sheet rendered exactly one style, so the four that were never drawn were also never
 * looked at. A variant that no review surface renders is a variant nobody reviews.
 *
 * Everything else about the appearance is held fixed: skin, hair colour and apparel change
 * no geometry, so varying them would add rows without adding coverage.
 */
function pawnEntries(): SpriteEntry[] {
  /*
   * No footprint: a pawn stands on a cell but does not claim it, and their sprite is
   * taller than a tile on purpose. The floor is 2 rather than 6 because an eye is
   * deliberately two pixels — on a 26px figure that is a readable feature.
   *
   * `mayHide` is **absent, and that is the assertion**: every mark on a colonist is meant
   * to be visible. It used to declare two, for a sunward crescent buried under hair, and
   * the declaration is what made the burial look accounted for. See `tests/art.test.ts`
   * for the check that the face itself survives, which no per-mark floor could make —
   * the head contributed six pixels, and six is not zero.
   */
  const CONTRACT: SpriteContract = {
    minVisibleInk: 2,
    containment: 'frame',
    aspect: [0.35, 0.75],
  };

  const entries: SpriteEntry[] = [];

  for (let hairStyle = 0; hairStyle < HAIR_STYLES; hairStyle++) {
    const appearance = { ...REVIEW_PAWN, hairStyle };
    entries.push({
      key: `pawn:standing:${hairStyle}`,
      group: 'Colonist',
      label: `hair ${hairStyle}`,
      width: PAWN_W,
      height: PAWN_H,
      rise: 0,
      rotation: 0,
      draw: () =>
        drawListFromGraphics(buildPawnGraphics(appearance).context, `pawn:standing:${hairStyle}`),
      vector: () => buildPawnGraphics(appearance).context,
      contract: CONTRACT,
    });
  }

  for (const rotation of ROTATIONS) {
    entries.push({
      key: `pawn:asleep:${rotation}`,
      group: 'Colonist asleep',
      label: `bed rot ${rotation}`,
      width: PAWN_ASLEEP_W,
      height: PAWN_ASLEEP_H,
      rise: 0,
      rotation,
      draw: () =>
        drawListFromGraphics(buildSleepingPawnGraphics(REVIEW_PAWN, rotation).context, 'asleep'),
      vector: () => buildSleepingPawnGraphics(REVIEW_PAWN, rotation).context,
      /*
       * The aspect bound is the one that would have caught the first sleeping pose: it
       * came out six times longer than it was wide and read as a plank with a head on
       * one end. A person lying along an isometric axis is a broad shape, not a line.
       */
      contract: { minVisibleInk: 2, containment: 'frame', aspect: [1.2, 2.6] },
    });
  }

  return entries;
}

/**
 * A colonist asleep, drawn **on the bed they are asleep in**.
 *
 * The composite the whole sleeping-pose saga needed and nobody had. Both halves were
 * reviewable on their own and both looked fine: the pose has the right proportions, its
 * head is on the bedding, its ink is inside its frame. It was still wrong on screen for
 * two milestones, because `ObjectLayer` centred it on the pawn's cell while the pawn
 * sleeps at `headCellOf` — one end of a 2×1 — so the body ran half its length off the head
 * of the bed.
 *
 * No check on either sprite could ever have caught that, and no amount of looking at
 * `sprites.html` either, because the two were never on the same page. Composing them at
 * the offsets the layer really uses turns a browser expedition into a row on the sheet —
 * which is the shape of question M13 asks constantly the moment rooms get contents.
 */
function sleeperOnBedEntries(): SpriteEntry[] {
  return ROTATIONS.flatMap((rotation) =>
    ([Building.Bed, Building.Bedroll] as const).map((building) => {
      const def = buildingDef(building);
      const size = sizeOf(def.footprint, rotation);
      const rise = BUILDING_HEIGHT[building];
      const box = footprintBounds(0, 0, size.w, size.h, 0, rise);

      /*
       * **The same function the layer calls**, not the same intent expressed twice.
       *
       * This was originally derived here from the sprite frame, whose top already carries
       * `-rise` — so the sheet drew a colonist lying neatly on a bed while the game drew
       * one lying on the floor underneath it, off by exactly the bed's height. A review
       * surface that computes the answer its own way can agree with itself and disagree
       * with the screen, which is the one thing it must never do.
       */
      const centre = sleeperCentreAt(building, { x: 0, y: 0, z: GROUND_LEVEL }, rotation);
      const dx = centre.x - PAWN_ASLEEP_W / 2 - box.left;
      const dy = centre.y - PAWN_ASLEEP_GROUND_Y - box.top;

      return {
        key: `scene:asleep:${building}:${rotation}`,
        group: `Asleep in a ${def.name.toLowerCase()}`,
        label: `rot ${rotation}`,
        width: box.width,
        height: box.height,
        rise,
        footprint: size,
        rotation,
        draw: () => [
          ...buildBuildingDrawList(building, rotation, false),
          ...translate(
            drawListFromGraphics(buildSleepingPawnGraphics(REVIEW_PAWN, rotation).context, 'asleep'),
            dx,
            dy,
          ),
        ],
        // A scene, not a sprite: the pose legitimately overhangs the bed it lies on — a
        // person is longer than the furniture is wide — so containment is not the question
        // being asked here. What is being asked is whether it lands on the *middle*.
        contract: { minVisibleInk: 0, containment: 'frame' as const },
      };
    }),
  );
}

/*
 * `legacyEntries()` lived here — the hand-drawn bed and bedroll kept on the sheet as
 * `— before` rows so the conversion could be judged side by side rather than taken on
 * faith. M12 wrote "delete when M13 signs the models off", and M13 signs them off:
 * measured over the same ink area, the bed carries 55 distinct tones against the drawing's
 * 10 and the bedroll 38 against 5. Every structure M13 added is modelled on that evidence.
 *
 * Kept in the history rather than in the manifest, because the comparison is answered.
 * Wall, door and hearth have no `— before` row for the opposite reason: they were not
 * converted, and are M14's.
 */

export function spriteManifest(): SpriteEntry[] {
  return [...buildingEntries(), ...pawnEntries(), ...sleeperOnBedEntries()];
}
