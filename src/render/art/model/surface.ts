/**
 * What a face is made of, per pixel.
 *
 * The measured reason detail looks basic: every building surface is one flat fill with at
 * most a band on it — a bedroll is five distinct colours across a 96×48 sprite. Terrain
 * does not have that problem, because it got `mottle` and `speckle` in M0 and buildings
 * never got an equivalent.
 *
 * These are that equivalent, and they are **per-pixel functions rather than shapes**.
 * Expressing wood grain or a course of masonry as vector fills means emitting hundreds of
 * tiny polygons, which is why nobody did. Given a rasterizer it is a few lines each.
 *
 * Everything here is a pure function of face coordinates and a seed. No `Math.random`:
 * `src/render/` is outside enforcement rule 2, but a sprite that drew differently on each
 * run could not be asserted on or diffed, and the whole harness rests on being able to.
 */

import { MATERIALS, TONE_STEP, TONE_STEPS, type Material } from '../language';

/**
 * Deterministic value noise in 0..1.
 *
 * The same integer hash `variantForCell` uses to pick terrain variants, which is not an
 * accident: one source of reproducible randomness in `render/` means art regenerated after
 * a context loss matches the art it replaces.
 */
export function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2f) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * Which step of the material's ramp a point on a face sits on.
 *
 * Returns a **quantised** offset, not a continuous one. Pixel art gets its character from
 * a small number of deliberate tones; a smooth gradient sampled nearest-neighbour is just
 * banding nobody chose. `TONE_STEPS` steps of `TONE_STEP` each.
 *
 * `px` and `py` are **face-local pixels** — distance along the face's own two edges, not
 * screen position. So grain runs along a plank whichever way the plank is turned, and a
 * course of masonry stays a course rather than skewing with the projection.
 */
export function surfaceTone(material: Material, px: number, py: number): number {
  const step = surfaceStep(material, px, py);
  // Centred on the ramp, so a material's declared base is its middle tone rather than its
  // brightest — otherwise adding texture would lighten or darken everything it touched.
  return (step - (TONE_STEPS - 1) / 2) * TONE_STEP * (0.4 + material.grain);
}

function surfaceStep(material: Material, px: number, py: number): number {
  const n = hash2(px, py, 0x9e37);
  const coarse = hash2(Math.floor(px / 3), Math.floor(py / 3), 0x51ed);

  switch (material.surface) {
    case 'smooth':
      // Barely anything: refined and relic surfaces are meant to read as *finished*.
      return quantise(0.5 + (n - 0.5) * 0.25);

    case 'grain': {
      // Long streaks along the face's first axis — the direction a plank was cut. Sampled
      // coarsely across the grain and finely along it, which is what makes it read as
      // timber rather than as noise.
      const streak = hash2(Math.floor(px / 7), Math.floor(py), 0x2f1c);
      return quantise(0.5 + (streak - 0.5) * 0.85 + (n - 0.5) * 0.2);
    }

    case 'coursed': {
      // Masonry. A dark line every few pixels down the face, offset course to course so
      // the joints do not stack into a visible column.
      const courseH = 5;
      const course = Math.floor(py / courseH);
      const joint = py % courseH === 0;
      const offset = course % 2 === 0 ? 0 : 3;
      const perpend = (px + offset) % 9 === 0;
      if (joint || perpend) return 0;
      return quantise(0.55 + (hash2(Math.floor(px / 4), course, 0x77af) - 0.5) * 0.7);
    }

    case 'weave': {
      // Cloth: a soft cross-hatch at two-pixel pitch, plus broad slack. No hard lines —
      // fabric has no edges, and putting them in is what makes a blanket read as a plank.
      const warp = ((px + py) % 4 < 2 ? 1 : 0) + ((px - py + 64) % 4 < 2 ? 1 : 0);
      return quantise(0.35 + warp * 0.14 + (coarse - 0.5) * 0.45);
    }

    case 'plated': {
      // Salvage: mismatched panels with rivets at their corners. The clearest possible
      // statement of "this was made out of whatever was lying around".
      const panelX = Math.floor(px / 9);
      const panelY = Math.floor(py / 7);
      const panel = hash2(panelX, panelY, 0x4b2e);
      const seam = px % 9 === 0 || py % 7 === 0;
      const rivet = px % 9 === 4 && py % 7 === 3;
      if (rivet) return TONE_STEPS - 1;
      if (seam) return 0;
      return quantise(0.4 + panel * 0.6);
    }

    case 'speckled':
    default:
      // Loose aggregate. Coarse enough to see at play zoom, which is the whole point —
      // a hundred single-pixel marks average back to the base colour.
      return quantise(0.5 + (coarse - 0.5) * 1.1 + (n - 0.5) * 0.3);
  }
}

function quantise(t: number): number {
  return Math.max(0, Math.min(TONE_STEPS - 1, Math.round(t * (TONE_STEPS - 1))));
}

export function materialOf(id: keyof typeof MATERIALS): Material {
  return MATERIALS[id];
}
