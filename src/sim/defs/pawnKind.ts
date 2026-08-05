/**
 * How much variety a pawn's appearance can have.
 *
 * Counts, not colours — sim/ picks an index, render/ decides what that index looks
 * like. The renderer's palette arrays must be at least this long, which
 * tests/pawn.test.ts asserts: if they drift apart, pawns silently render with an
 * undefined colour instead of failing loudly.
 */

export const APPEARANCE_VARIANTS = {
  skinTones: 5,
  hairStyles: 5,
  hairColours: 6,
  apparelColours: 7,
} as const;

/** Colonists in a starting party. */
export const STARTING_COLONISTS = 3;
