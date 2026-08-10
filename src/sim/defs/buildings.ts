/**
 * Buildings.
 *
 * Bedrolls arrive *with* the landing party rather than being constructed — honest
 * fiction, and it left M4 free to deliver proper beds as a genuine upgrade. M10 is where
 * that upgrade finally arrives, because a bed is 2×1 and until footprints existed there
 * was no way to say so.
 *
 * **Ids are append-only.** They are written into every save, so inserting one in the
 * middle silently reinterprets every building in every existing colony.
 */

/**
 * Cells a structure stands on, before rotation, `w` along +x.
 *
 * Declared here rather than beside the arithmetic in `world/footprint.ts` so the
 * dependency runs one way: content declares the shape, the world layer interprets it.
 */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

export const SINGLE_CELL: Footprint = { w: 1, h: 1 };

export const Building = {
  Bedroll: 0,
  Wall: 1,
  Door: 2,
  Campfire: 3,
  Bed: 4,
  Hearth: 5,
} as const;

export type BuildingId = (typeof Building)[keyof typeof Building];

export interface BuildingDef {
  readonly id: BuildingId;
  readonly name: string;
  /**
   * Cells this stands on, before rotation, `w` along +x.
   *
   * The cells themselves are derived from this plus the instance's rotation and never
   * saved — see `world/footprint.ts`, which is the only place that arithmetic lives.
   */
  readonly footprint: Footprint;
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
   * Whether the player can bar this against colonists.
   *
   * Only doors, for now. Locking flips `buildingBlocks` and leaves `buildingSealsRoom`
   * alone — a barred door is still a wall as far as the room is concerned, which is
   * exactly the pair of flags M4 kept separate.
   *
   * **There is no "hold open".** It would have to mean "walkable and does not seal", and
   * with no temperature and no cost to opening a door the only thing it could do is take
   * the roof bonus away — a setting whose sole effect is to make things worse is a
   * control nobody would ever touch, and offering it is the same lie as a work column
   * with no giver behind it. It arrives when there is a reason to want it.
   */
  readonly lockable: boolean;
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
  // 2×1, and always was in fiction — a person does not sleep folded in half. It read as
  // one cell only because one cell was all a building could be.
  {
    id: Building.Bedroll,
    name: 'Bedroll',
    footprint: { w: 2, h: 1 },
    isBed: true,
    lightRadius: 0,
    passable: true,
    blocksRoom: false,
    lockable: false,
  },
  { id: Building.Wall, name: 'Wall', footprint: SINGLE_CELL, isBed: false, lightRadius: 0, passable: false, blocksRoom: true, lockable: false },
  { id: Building.Door, name: 'Door', footprint: SINGLE_CELL, isBed: false, lightRadius: 0, passable: true, blocksRoom: true, lockable: true },
  // Impassable but not a room edge: you cannot walk through a fire, and a fire in the
  // middle of a hut must not cut the hut into two rooms. Exactly the case those two
  // flags were kept separate for.
  {
    id: Building.Campfire,
    name: 'Campfire',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 6,
    passable: false,
    blocksRoom: false,
    lockable: false,
  },
  // The upgrade the roadmap promised in M4 and could not deliver until a building was
  // allowed to be longer than it is wide. Passable, because you walk onto a bed to
  // sleep in it.
  {
    id: Building.Bed,
    name: 'Bed',
    footprint: { w: 2, h: 1 },
    isBed: true,
    lightRadius: 0,
    passable: true,
    blocksRoom: false,
    lockable: false,
  },
  // The first structure that is impassable across *several* cells, which is the case a
  // 2×1 bedroll cannot exercise: blocking, standing beside rather than on, and a solid
  // object inside a hut that must not cut the hut into two rooms.
  {
    id: Building.Hearth,
    name: 'Hearth',
    footprint: { w: 2, h: 2 },
    isBed: false,
    lightRadius: 9,
    passable: false,
    blocksRoom: false,
    lockable: false,
  },
];

export function buildingDef(id: BuildingId): BuildingDef {
  return BUILDING_DEFS[id];
}

/** Bedrolls the starting party brought with them — one each. */
export const STARTING_BEDROLLS_PER_COLONIST = 1;
