/**
 * Names — for the people, and for the places.
 *
 * Deliberately plain and a little worn — these are salvagers on a frontier, not
 * officers. A recognisable name is what turns "pawn 3 starved" into a story about
 * someone, which is the entire point of the genre.
 *
 * The same argument is why places get names at all. See `docs/decisions/0008-places.md`:
 * a generated world produces instances of types, and the whole design wants particulars.
 * A name generated once and *kept* is the cheapest thing that turns "a ruin" into
 * somewhere you went.
 */

export const FIRST_NAMES: readonly string[] = [
  'Ash',
  'Bex',
  'Cato',
  'Dima',
  'Enna',
  'Fen',
  'Gil',
  'Hale',
  'Ivo',
  'Jarn',
  'Kesh',
  'Lior',
  'Mora',
  'Nils',
  'Oda',
  'Pike',
  'Quill',
  'Rask',
  'Sena',
  'Tov',
  'Ulla',
  'Vex',
  'Wren',
  'Yara',
  'Zeke',
];

export const SURNAMES: readonly string[] = [
  'Ardent',
  'Bellweather',
  'Crane',
  'Dross',
  'Ember',
  'Fallow',
  'Grange',
  'Hollow',
  'Ironsend',
  'Kestrel',
  'Lowe',
  'Marrow',
  'Nash',
  'Orrick',
  'Pallas',
  'Redfern',
  'Stave',
  'Thorne',
  'Vantage',
  'Wilder',
];

// ── Places ──────────────────────────────────────────────────────────────────────
//
// A place name has to sound like somebody used it, which mostly means it must not
// describe the thing. "Ruin 3" and "Large Relic Site" are labels on a category; "Kessler
// Relay" is somewhere you can arrange to meet. The three patterns below all produce the
// second kind, and the *type* noun each draws from lives on the PoiDef, so a vault is
// never called a mast.

/** Proper names, as if whoever built the place is still faintly remembered. */
export const PLACE_WORDS: readonly string[] = [
  'Kessler',
  'Corvid',
  'Halbrand',
  'Sable',
  'Meridian',
  'Ostrog',
  'Calder',
  'Varn',
  'Pell',
  'Ashgate',
  'Dunmore',
  'Levant',
  'Storrow',
  'Wyckham',
  'Bracken',
  'Fennow',
  'Orlow',
  'Quillon',
  'Sarn',
  'Toller',
];

/** For "The Pale Mast" — descriptive, but of mood rather than of function. */
export const PLACE_ADJECTIVES: readonly string[] = [
  'Pale',
  'Sunken',
  'Broken',
  'Quiet',
  'Long',
  'Iron',
  'Hollow',
  'Far',
  'Cold',
  'Drowned',
];

/**
 * Written out rather than digits.
 *
 * "Vault Nine" is a place; "Vault 9" is a database row, and the difference is most of
 * what this whole file is for.
 */
export const PLACE_NUMERALS: readonly string[] = [
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Nine',
  'Eleven',
  'Twelve',
  'Sixteen',
];
