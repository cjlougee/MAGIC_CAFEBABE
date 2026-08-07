/**
 * Buildings.
 *
 * Only bedrolls so far, and they arrive *with* the landing party rather than being
 * constructed. Construction is M4; giving the player a placeholder build tool now would
 * mean writing code M4 immediately deletes. A landing party carrying bedrolls is honest
 * fiction, and it leaves M4 free to deliver proper beds as a genuine upgrade.
 */

export const Building = {
  Bedroll: 0,
  Wall: 1,
  Door: 2,
  Campfire: 3,
} as const;

export type BuildingId = (typeof Building)[keyof typeof Building];

export interface BuildingDef {
  readonly id: BuildingId;
  readonly name: string;
  /** Colonists can sleep here, and sleeping here is better than the ground. */
  readonly isBed: boolean;
  /**
   * Radius in cells this lights, or 0 for nothing.
   *
   * Content, so it lives here — but only `render/` reads it, because darkness has no
   * effect on the simulation yet. See docs/design/07-production.md.
   */
  readonly lightRadius: number;
  /** Whether colonists can walk through it. */
  readonly passable: boolean;
  /**
   * Whether it forms the edge of a room.
   *
   * Separate from `passable` because a **door is both**: colonists walk through it, and
   * it still seals the room. Conflating the two would mean a house with a door has no
   * interior, which is the whole point of building one.
   */
  readonly blocksRoom: boolean;
}

/** Indexed by BuildingId — array position must equal `id`. */
export const BUILDING_DEFS: readonly BuildingDef[] = [
  { id: Building.Bedroll, name: 'Bedroll', isBed: true, lightRadius: 0, passable: true, blocksRoom: false },
  { id: Building.Wall, name: 'Wall', isBed: false, lightRadius: 0, passable: false, blocksRoom: true },
  { id: Building.Door, name: 'Door', isBed: false, lightRadius: 0, passable: true, blocksRoom: true },
  // Impassable but not a room edge: you cannot walk through a fire, and a fire in the
  // middle of a hut must not cut the hut into two rooms. Exactly the case those two
  // flags were kept separate for.
  {
    id: Building.Campfire,
    name: 'Campfire',
    isBed: false,
    lightRadius: 6,
    passable: false,
    blocksRoom: false,
  },
];

export function buildingDef(id: BuildingId): BuildingDef {
  return BUILDING_DEFS[id];
}

/** Bedrolls the starting party brought with them — one each. */
export const STARTING_BEDROLLS_PER_COLONIST = 1;
