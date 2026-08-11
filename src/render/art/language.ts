/**
 * The design language, as numbers.
 *
 * `.claude/skills/art-pass` is good writing and has no figures in it: no stated insets, no
 * proportions, no ground line, no idea how many tones a surface should carry. Prose is
 * what you read once; numbers are what the first attempt lands on. Making the first
 * attempt land closer is cheaper than making the fourth attempt land, and that is the
 * whole economics of the milestone this file belongs to.
 *
 * It is also what the harness asserts against, so the art and the test cannot hold
 * different opinions about what the style *is*.
 *
 * **Heights are fractions of `LEVEL_HEIGHT`, not pixels.** A wall is 0.92 of a storey, not
 * 22 of something. When Slice 4 gives the world real levels, a proportion still means what
 * it meant; a pixel count silently stops meaning anything. See ADR 0003.
 */

import { LEVEL_HEIGHT } from '../constants';
import { Palette, shade } from './palette';

// ── The one sun ─────────────────────────────────────────────────────────────────

/**
 * Light comes from the upper right, for everything.
 *
 * The single most valuable rule in the style, because it is what makes unrelated
 * procedural shapes look like they share a world. Stated here as a direction in tile
 * space so that anything with a normal — a bevel, a curved surface, a face at an angle —
 * can be lit consistently instead of guessing which of two constants to reach for.
 *
 * `+x` runs down-right on screen, `+y` down-left, `+z` up. So "upper right" is `-y`.
 */
export const SUN = { x: 0.42, y: -0.55, z: 0.72 } as const;

/**
 * Tone offsets for the three faces of an axis-aligned solid.
 *
 * These are the numbers terrain and buildings have shared since M0, unchanged — a stone
 * wall has to butt against a rock face without a lighting mismatch, so moving them here
 * moves them for everyone or for no one. `isoShapes.ts` re-exports them under their old
 * names, which is why nothing else had to change.
 */
export const FACE = {
  /** Facing straight up. The reference tone. */
  top: 0,
  /** The `+x` face, down-right on screen. Catches more of the sun than the other. */
  right: -0.14,
  /** The `+y` face, down-left on screen. */
  left: -0.3,
} as const;

/** The same sun for things not built from isometric faces — pawns, plants, item piles. */
export const LIT_SHIFT = 0.16;
export const SHADED_SHIFT = -0.22;

// ── Surface ─────────────────────────────────────────────────────────────────────

/**
 * How many tones a surface carries.
 *
 * The measured diagnosis of "the detail looks basic": a bedroll is **five** distinct
 * colours across a 96×48 sprite and a door is five across 64×48, because every surface is
 * one flat fill with at most a band on it. Terrain does not have this problem — it got a
 * texture pass in M0 (`mottle`, `speckle`, `drawTufts`) and buildings never did.
 *
 * Four steps is the floor at which a face reads as a *surface* rather than a shape. Below
 * it there is nothing for the eye to resolve into material.
 */
export const TONE_STEPS = 4;

/** Spacing between adjacent steps of a material's ramp. Subtle: this is shading, not stripes. */
export const TONE_STEP = 0.055;

/**
 * The ladder every final tone lands on.
 *
 * Face shading, surface, occlusion and bevel all sum to a continuous offset, and a
 * continuous offset produces a continuous palette: the first modelled bed came out with
 * **150 distinct colours** across 1,740 pixels — eleven pixels per tone. That is not
 * shading, it is mud, and at play zoom with nearest sampling it reads as noise.
 *
 * Pixel art gets its character from a small number of deliberate tones, so the sum is
 * snapped to a ladder before it is applied. The forms survive; the palette does not run
 * away. This is the difference between a renderer that *can* do gradients and one that
 * knows it shouldn't.
 */
export const TONE_QUANTUM = 0.045;

/** Snaps a summed tone offset onto the ladder. */
export function quantiseTone(offset: number): number {
  return Math.round(offset / TONE_QUANTUM) * TONE_QUANTUM;
}

/**
 * Ambient occlusion where forms meet, as a tone offset and a reach in pixels.
 *
 * The thing whose absence makes procedurally drawn objects sit *on* each other rather
 * than *in* the same world. A mattress on a frame with no darkening at the join is two
 * shapes that happen to touch; three pixels of shadow in the crease and it is a mattress
 * in a bed. Cheap, mechanical, and impossible to express as a vector fill — which is why
 * it needed the rasterizer before it could exist at all.
 */
export const AO = { depth: -0.3, reach: 3 } as const;

/**
 * The lit lip along a form's sunward top edge, and the dark one opposite.
 *
 * One pixel, both of them. This is the bevel that says an edge is an edge; without it a
 * box top meets a box side at a colour change and reads as a fold in paper.
 *
 * **Never on anything that tiles.** A lit edge on every rock draws a bright line between
 * adjacent rocks in one mass — a seam grid over the whole mountain, which is exactly what
 * ADR 0002 exists to prevent. Applied to an already-inset shape it is safe, because unlit
 * border separates it from the next tile.
 */
export const BEVEL = { lit: 0.14, shaded: -0.16, width: 1 } as const;

/**
 * Smallest mark the eye integrates at play zoom.
 *
 * A 2px mark is below it: a hundred of them average back to the base colour and the
 * surface reads as flat. The lock bar survived as two visible pixels and read as nothing
 * at all. Vary at roughly a third of a tile and let fine speckle serve the close-up view.
 */
export const MIN_FEATURE = 3;

// ── Proportions, in storeys ─────────────────────────────────────────────────────

/**
 * How tall things are, as fractions of one level.
 *
 * A hovel is not a shorter skyscraper, and until Slice 4 lands it is not a *shorter*
 * anything — it is a differently-built one. These are the numbers a new sprite starts
 * from instead of inventing its own.
 */
export const HEIGHT = {
  /** Flat on the ground: a bedroll, a carpet, a spill. */
  flat: 0,
  /** Furniture you sit on or put things on. */
  seat: 0.19,
  bed: 0.46,
  table: 0.55,
  /** Waist-high: a counter, a crate, a low wall. */
  counter: 0.6,
  /** A wall. Deliberately under a storey — see ADR 0003 on why nothing may reach 1.0 yet. */
  wall: 0.92,
  /** A doorway, shorter than the run it interrupts so it reads as a gap. */
  door: 0.67,
} as const;

/** Frame pixels for a height in storeys. */
export function storeys(fraction: number): number {
  return fraction * LEVEL_HEIGHT;
}

// ── Materials ───────────────────────────────────────────────────────────────────

/**
 * What a thing is made of, which in this setting is also *what tier it is*.
 *
 * The crafting ladder is `scrap → refined → relic-tech`, and that is a claim about how
 * things should look as much as about what they cost. A material system is the ladder
 * made visible: salvage reads as patched plate with rivets, refined work reads as cut and
 * dressed, relic reads as something nobody here could make. Getting that legible is worth
 * more than any individual sprite.
 *
 * `surface` names a texture routine in `model/surface.ts`; `grain` scales how coarse it is.
 */
export type SurfaceKind = 'smooth' | 'grain' | 'coursed' | 'weave' | 'plated' | 'speckled';

export interface Material {
  readonly name: string;
  readonly base: number;
  /** Extra tone offset applied to every face. For materials that read dark or bright. */
  readonly bias: number;
  readonly surface: SurfaceKind;
  /** 0 for a surface with no visible structure, 1 for a coarse one. */
  readonly grain: number;
}

export const MATERIALS = {
  wood: { name: 'wood', base: 0x6b543c, bias: 0, surface: 'grain', grain: 0.6 },
  plank: { name: 'plank', base: 0x7d6547, bias: 0.03, surface: 'grain', grain: 0.45 },
  stone: { name: 'stone', base: Palette.wall, bias: 0, surface: 'coursed', grain: 0.5 },
  rubble: { name: 'rubble', base: Palette.gravel, bias: -0.04, surface: 'speckled', grain: 0.8 },
  /** Salvage: mismatched plate, riveted together. The bottom of the ladder, and it shows. */
  scrap: { name: 'scrap', base: 0x6e6357, bias: -0.02, surface: 'plated', grain: 0.7 },
  /** Refined: the same metal, cut square and dressed. */
  refined: { name: 'refined', base: 0x8a8578, bias: 0.04, surface: 'smooth', grain: 0.15 },
  /** Relic: nobody here could make this. Smooth, and faintly still running. */
  relic: { name: 'relic', base: Palette.relicGlow, bias: 0.05, surface: 'smooth', grain: 0.08 },
  cloth: { name: 'cloth', base: 0x8a7a63, bias: 0, surface: 'weave', grain: 0.35 },
  canvas: { name: 'canvas', base: 0x6f5a48, bias: -0.02, surface: 'weave', grain: 0.5 },
  linen: { name: 'linen', base: shade(Palette.text, -0.22), bias: 0.02, surface: 'weave', grain: 0.25 },
} as const satisfies Record<string, Material>;

export type MaterialId = keyof typeof MATERIALS;
