/**
 * The art direction, in one file.
 *
 * The whole look rests on one rule: **terrain is desaturated, technology is
 * saturated.** Wilderness sits in muted earth tones so that anything manufactured —
 * and especially anything relic — reads instantly as the valuable thing on screen.
 * `relic` cyan is the signature colour of the tier you cannot craft.
 *
 * Never hardcode a hex value outside this file. Coherence is the entire reason the
 * procedural art approach works.
 */

export const Palette = {
  // ── Terrain: desaturated, low contrast against each other ──────────────────
  deepWater: 0x1d3b4a,
  shallowWater: 0x2f5f6e,
  sand: 0x8f7f5c,
  dirt: 0x6d5a45,
  grass: 0x5b6b41,
  gravel: 0x6e6a63,
  rock: 0x4b4844,
  ruinFloor: 0x4a4e57,
  ruinWall: 0x353941,
  /** Player-laid paving. Warmer than relic plating, so built floors read as *yours*. */
  stoneFloor: 0x77706a,
  wall: 0x6a6259,

  // ── Accents: saturated. Reserved for tech, alerts, and UI emphasis ─────────
  relic: 0x53d6c4,
  energy: 0x58b6f0,
  hazard: 0xf0904a,
  danger: 0xd9544f,
  good: 0x7fbf5f,
  gold: 0xe8c15c,

  // ── Chrome ────────────────────────────────────────────────────────────────
  void: 0x0a0d11,
  ink: 0x0d1014,
  panel: 0x161b22,
  panelEdge: 0x2a323d,
  text: 0xdfe6ee,
  textDim: 0x8b97a6,

  /** Colour the world is tinted toward at full night. */
  nightTint: 0x2a3f66,

  /**
   * The light a fire casts.
   *
   * Deliberately warmer and paler than the flame itself: light picks up the colour of
   * its source but washes toward white as it brightens what it lands on. A glow tinted
   * the same orange as the fire reads as a coloured filter rather than as illumination —
   * and left pure white, as this first was, it reads as a spotlight.
   */
  firelight: 0xffb765,

  /**
   * What relic tech still gives off.
   *
   * Dimmer and less saturated than `relic`, which is the colour of the *material*. These
   * are weathered panels that have stood in the open for centuries and somehow have not
   * gone out — the reading should be "still running", not "switched on this morning". A
   * bright cyan glow makes ruins look maintained, which is the opposite of the setting:
   * nobody has maintained anything here in a very long time.
   */
  relicGlow: 0x3f9e92,

  /**
   * Multiplied over a structure standing on a cell marked for demolition.
   *
   * A *tint*, not an overlay marker, because designation marks are drawn on the floor
   * and objects cover them — so a wall hid its own mark completely and the player got no
   * answer at all to "did that order take?". Kept pale enough to stay recognisably a
   * wall, and pushed toward `danger` so it reads as the same warning the floor mark uses.
   */
  markedForDeconstruct: 0xe09b96,
} as const;

export type PaletteColor = (typeof Palette)[keyof typeof Palette];

/**
 * Character colours, indexed by the appearance numbers sim/ rolls.
 *
 * These arrays must be at least as long as the counts in sim/defs/pawnKind.ts —
 * asserted in tests/pawn.test.ts, because a short array would silently render pawns
 * with an undefined colour rather than failing.
 *
 * Apparel is where the saturated half of the palette finally lands on something that
 * moves. Terrain stays muted so colonists read instantly as the things that matter.
 */
export const PawnPalette = {
  skin: [0xf0d6b8, 0xe0b48c, 0xc08a5e, 0x94603c, 0x63412a],
  hair: [0x241c16, 0x4a3323, 0x7d5730, 0xb59760, 0x8e9095, 0x9c4436],
  apparel: [0x3f7fae, 0x4a9c78, 0xb0663c, 0x8c4f63, 0x5b5f8a, 0x9c8f45, 0x556070],
} as const;

/** Blend toward white (amount > 0) or black (amount < 0). Amount is -1..1. */
export function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);

  const mix = (channel: number): number =>
    Math.max(0, Math.min(255, Math.round(channel + (target - channel) * t)));

  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** Linear blend between two colours. `t` of 0 returns `a`, 1 returns `b`. */
export function mixColors(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const channel = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * clamped) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
