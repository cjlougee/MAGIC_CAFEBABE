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
  // ── M13: what goes *in* a room ────────────────────────────────────────────
  Stool: 6,
  Chair: 7,
  Table: 8,
  Desk: 9,
  Shelf: 10,
  Crate: 11,
  Safe: 12,
  Torch: 13,
  Lamp: 14,
  Floodlight: 15,
  Banner: 16,
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
   * Whether facing this one way rather than another changes anything the player can see.
   *
   * True for a footprint that is not square, and *also* for a door — which is one cell,
   * so its cells never change, but whose jambs have to line up with the wall run they
   * interrupt. Drives whether rotation is offered at all: a control that visibly does
   * nothing teaches the player that the controls lie.
   */
  readonly orientable: boolean;
  /**
   * Whether a colonist can claim this as theirs.
   *
   * True for a bed and **false for a bedroll**, which is the whole reason this is a flag
   * rather than `isBed`: bedrolls are the landing party's shared kit, so the upgrade to a
   * bed of your own is something a colonist can actually notice. Without a distinction
   * here, `SleptInOwnBed` would be unreachable in one direction — a colonist would own a
   * bed from their first night and the ordinary thought would never fire again, which is
   * the same lie as a work column with no giver behind it.
   *
   * `owner` itself has been on `Building` since M3, saved and hashed and never set.
   */
  readonly ownable: boolean;
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
    orientable: true,
    // Shared kit the party landed with. Nobody's own.
    ownable: false,
  },
  { id: Building.Wall, name: 'Wall', footprint: SINGLE_CELL, isBed: false, lightRadius: 0, passable: false, blocksRoom: true, lockable: false, orientable: false, ownable: false },
  { id: Building.Door, name: 'Door', footprint: SINGLE_CELL, isBed: false, lightRadius: 0, passable: true, blocksRoom: true, lockable: true, orientable: true, ownable: false },
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
    orientable: false,
    ownable: false,
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
    orientable: true,
    ownable: true,
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
    // Square, and drawn the same from every side. Turning it would be a control that
    // visibly does nothing.
    orientable: false,
    ownable: false,
  },

  /*
   * ── Furniture ─────────────────────────────────────────────────────────────
   *
   * Everything below is the same three questions answered eleven times, which is the
   * point: `passable` / `blocksRoom` / `orientable` were all in place before any of this
   * existed, so a piece of furniture is data rather than a system.
   *
   * **Nothing here seals a room.** A table in the middle of a hut must not cut the hut in
   * two, exactly as a hearth must not — that is what the flag pair M4 kept separate is
   * for, and eleven more structures is eleven more chances to conflate them.
   *
   * Passability follows what you *do* with the thing. You sit on a stool, so you walk onto
   * it; you stand beside a desk, so you do not. Chosen deliberately to keep the number of
   * ways a player can wall a colonist in as small as the furniture allows — the backstop
   * is `buildAlerts`' "X is cut off from the colony", and nothing here removes it.
   */
  {
    id: Building.Stool,
    name: 'Stool',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 0,
    // You sit on it, so you stand on it. Round in fiction, so turning it does nothing.
    passable: true,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Chair,
    name: 'Chair',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 0,
    passable: true,
    blocksRoom: false,
    lockable: false,
    // One cell in every rotation, like a door — and like a door it still has a facing,
    // because the back is on one side. The same reason `orientable` is not "more than one
    // cell": see ADR 0009.
    orientable: true,
    ownable: false,
  },
  {
    id: Building.Table,
    name: 'Table',
    footprint: { w: 2, h: 2 },
    isBed: false,
    lightRadius: 0,
    passable: false,
    blocksRoom: false,
    lockable: false,
    // Square, so turning it covers identical cells and draws an identical picture.
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Desk,
    name: 'Desk',
    footprint: { w: 2, h: 1 },
    isBed: false,
    lightRadius: 0,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: true,
    ownable: false,
  },
  {
    id: Building.Shelf,
    name: 'Shelf',
    footprint: { w: 2, h: 1 },
    isBed: false,
    lightRadius: 0,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: true,
    ownable: false,
  },
  {
    id: Building.Crate,
    name: 'Supply Crate',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 0,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Safe,
    name: 'Safe',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 0,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },

  /*
   * ── Light ──────────────────────────────────────────────────────────────────
   *
   * The three of these are the `scrap → refined → relic` ladder stated in light, which is
   * the clearest place in the game to state it: a torch burns and casts firelight, a lamp
   * and a floodlight are salvaged tech and cast the cold `relicGlow` that says *this was
   * made by somebody who could*. Reach follows the tier.
   *
   * All three are two data fields and nothing else — `lightRadius` here and a colour in
   * `BUILDING_LIGHT`. `LightingLayer` has read both since M6.
   */
  {
    id: Building.Torch,
    name: 'Torch',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 4,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Lamp,
    name: 'Lamp',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 7,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Floodlight,
    name: 'Floodlight',
    footprint: SINGLE_CELL,
    isBed: false,
    // Further than a hearth, which is the point of it: the first light that covers a yard
    // rather than a room.
    lightRadius: 11,
    passable: false,
    blocksRoom: false,
    lockable: false,
    orientable: false,
    ownable: false,
  },
  {
    id: Building.Banner,
    name: 'Banner',
    footprint: SINGLE_CELL,
    isBed: false,
    lightRadius: 0,
    // Passable: decoration the player scatters should never be a thing that traps anyone.
    passable: true,
    blocksRoom: false,
    lockable: false,
    /*
     * **Temporary, and a retreat.** The cloth currently wraps the pole, so it looks the
     * same from every side and there is nothing for a turn to do.
     *
     * A one-sided banner is perfectly possible — a chair's back and a desk's drawers are
     * off-centre and turn fine. What this sprite lacks is a crossbar for the cloth to hang
     * from, so that something the player can *see* rotates with it. `bannerModel` has the
     * measurements and the fix; this goes back to `true` with it.
     */
    orientable: false,
    ownable: false,
  },
];

export function buildingDef(id: BuildingId): BuildingDef {
  return BUILDING_DEFS[id];
}

/** Bedrolls the starting party brought with them — one each. */
export const STARTING_BEDROLLS_PER_COLONIST = 1;
