/**
 * Points of interest — the places on the map that are *places*.
 *
 * The distinction this whole file rests on: the ruin noise field makes **texture**, and
 * a POI is a **place**. Scattered plating and bulkheads say the world was inherited; they
 * are weather. A POI is a structure somebody built, sited on purpose, named once, and
 * remembered — it is the difference between "there is wreckage over there" and "that is
 * Kessler Relay, and we have been". See `docs/decisions/0008-places.md`.
 *
 * Both still come out of a seed. What separates them is *how*: texture comes from a
 * threshold on noise, a place comes from a constraint search.
 */

export const Poi = {
  ListeningPost: 0,
  RelicVault: 1,
} as const;

export type PoiId = (typeof Poi)[keyof typeof Poi];

export interface PoiDef {
  readonly id: PoiId;
  /** What this kind of place is, for the UI. Not its name — its name is generated. */
  readonly kind: string;
  /**
   * Type nouns its name may end in, so a vault is never called a mast.
   *
   * On the def rather than in `names.ts` because it is the one part of a place name that
   * is genuinely about what the thing *is*.
   */
  readonly nouns: readonly string[];
  /** Footprint, in tiles across. Picked per instance from this range. */
  readonly minSpan: number;
  readonly maxSpan: number;
  /** How many the world tries to place. */
  readonly count: number;
  /**
   * Whether a world without one is a failure.
   *
   * Exactly one kind carries this. A frontier with nothing to walk to is the M8 version
   * of a bigger screensaver, so placement relaxes its constraints rather than give up.
   */
  readonly guaranteed: boolean;
}

/** Indexed by PoiId — array position must equal `id`. */
export const POI_DEFS: readonly PoiDef[] = [
  // Small, and there are several. These are what make the map feel *inhabited before
  // you* — you find one, and it implies the others you have not found yet.
  {
    id: Poi.ListeningPost,
    kind: 'Listening post',
    nouns: ['Relay', 'Mast', 'Beacon', 'Watch', 'Array', 'Post'],
    minSpan: 7,
    maxSpan: 11,
    count: 5,
    guaranteed: false,
  },
  // The big one, and the only guaranteed one. Large enough to read as a compound from
  // across a valley, which is the entire job: it has to be visible before it is
  // interesting. Relic-tech is recovered here in M10.
  {
    id: Poi.RelicVault,
    kind: 'Relic vault',
    nouns: ['Vault', 'Hold', 'Deep', 'Cache', 'Reliquary'],
    minSpan: 15,
    maxSpan: 21,
    count: 1,
    guaranteed: true,
  },
];

export function poiDef(id: PoiId): PoiDef {
  return POI_DEFS[id];
}
