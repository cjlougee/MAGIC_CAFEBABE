/**
 * Bringing an old save up to the current shape.
 *
 * **Each step upgrades by exactly one version and never skips.** A chain of small,
 * individually-obvious transforms stays reviewable; one big "handle any old shape"
 * function does not.
 *
 * A step must never import a live definition — no `Terrain.StoneFloor`, no
 * `ITEM_DEFS.length`. Those describe the game as it is *now*, and a migration describes
 * a file as it was *then*. Freeze the literal in the step and say what it was.
 */

import { decodeRle, SAVE_VERSION, type SaveData } from './serialize';

export class SaveVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveVersionError';
  }
}

/** One step up the chain. Add one per format change; never edit an existing step. */
type MigrationStep = (save: Record<string, unknown>) => Record<string, unknown>;

// Terrain ids frozen as they stood at save version 1. Deliberately literals: if the
// terrain table is ever renumbered, this step must still read the old file correctly.
const V1_DIRT = 3;
const V1_STONE_FLOOR = 9;

/**
 * v1 → v2: deconstruction arrives, and with it the natural-terrain grid.
 *
 * v1 never recorded what a floor was laid over, so for those saves it has to be guessed
 * exactly once, here, rather than at every call site forever after. Everything reverts
 * to itself except a stone floor, which becomes dirt — the guess that makes lifting an
 * old floor *do something* instead of silently leaving it in place.
 *
 * The terrain grid is RLE as `[value, run, value, run, ...]`, so the values can be
 * remapped pair-wise without decoding. Adjacent equal runs are left unmerged; the
 * decoder handles them.
 */
function addNaturalTerrain(save: Record<string, unknown>): Record<string, unknown> {
  const map = save.map as { terrain: number[] } & Record<string, unknown>;
  const natural: number[] = [];

  for (let i = 0; i + 1 < map.terrain.length; i += 2) {
    const value = map.terrain[i];
    natural.push(value === V1_STONE_FLOOR ? V1_DIRT : value, map.terrain[i + 1]);
  }

  return {
    ...save,
    version: 2,
    map: { ...map, natural },
    deconstructDesignations: [],
  };
}

// Frozen as they stood at save version 2. Deliberately literals, not `WORK_TYPE_COUNT`
// or `DEFAULT_PRIORITY`: those describe the game now, and this step describes a file as
// it was then. If a work type is ever added again, this must still pad to *four*.
const V2_WORK_TYPE_COUNT = 4;
const V2_DEFAULT_PRIORITY = 3;

/**
 * v2 → v3: workbenches arrive, and with them a fifth work type.
 *
 * Two independent changes that happen to land together. Buildings gain bills and a
 * ledger of loaded ingredients, which for an old save are simply empty — nothing was a
 * workbench before this version. And every pawn's priority array grows by one, because
 * `WorkType.Cook` was appended; an un-padded array would leave `priorities[Cook]`
 * undefined, which compares false against every threshold and reads as "never cook"
 * rather than as the default it should be.
 *
 * Padded from whatever length the file has rather than assuming four, so a save written
 * by a build mid-way through this change still comes out the right shape.
 */
function addWorkbenchesAndCook(save: Record<string, unknown>): Record<string, unknown> {
  const buildings = save.buildings as Record<string, unknown>[];
  const pawns = save.pawns as Record<string, unknown>[];

  return {
    ...save,
    version: 3,
    buildings: buildings.map((building) => ({ ...building, bills: [], loaded: [] })),
    pawns: pawns.map((pawn) => {
      const priorities = [...((pawn.priorities as number[]) ?? [])];
      while (priorities.length < V2_WORK_TYPE_COUNT + 1) priorities.push(V2_DEFAULT_PRIORITY);
      return { ...pawn, priorities };
    }),
  };
}

/**
 * v3 → v4: named places arrive.
 *
 * An old save gets **none**, and that is the honest answer rather than a shortfall. The
 * places in a v4 world were sited during worldgen against the terrain *and the landing
 * site*, and then stamped into the map; a v3 colony's terrain has no compounds in it, so
 * inventing records for places that were never built would describe buildings that are
 * not there.
 *
 * Deliberately not "re-run placement on load". That would stamp compounds into a world
 * the player already knows, possibly across their base, and it would make a place's name
 * a function of the current build rather than of the world — which is the one property
 * naming them was for.
 */
function addPointsOfInterest(save: Record<string, unknown>): Record<string, unknown> {
  return { ...save, version: 4, pois: [], nextPoiId: 1 };
}

/**
 * v4 → v5: draft, standing orders, and the player character.
 *
 * Nobody is drafted in an old save, which is simply true — the concept did not exist, so
 * everyone was in the work pool.
 *
 * The player character needs a *guess*, and it is made once here rather than at every
 * call site forever after, the same way v1 → v2 had to decide what a stone floor was laid
 * on. A world generated before this version records nobody as "you", but one of that
 * landing party always was; the first colonist still alive is an arbitrary and stable
 * answer, and an arbitrary answer beats a colony with no protagonist in it.
 */
function addDraftAndPlayerCharacter(save: Record<string, unknown>): Record<string, unknown> {
  const pawns = save.pawns as Record<string, unknown>[];
  const chosen = pawns.find((pawn) => pawn.dead !== true) ?? pawns[0];

  return {
    ...save,
    version: 5,
    pawns: pawns.map((pawn) => ({
      ...pawn,
      drafted: false,
      draftTarget: null,
      playerCharacter: pawn === chosen,
    })),
  };
}

// Frozen as they stood at save version 5. `Bedroll` was building id 0, and v6 is the
// version that widened it from one cell to two. Deliberately literals rather than
// `Building.Bedroll` or `footprintOfBuilding(...)`: those describe the game now, and if
// the building table is ever renumbered this step must still read an old file correctly.
const V5_BEDROLL = 0;
const V5_BEDROLL_WIDTH = 2;

/**
 * v5 → v6: buildings and sites gain a rotation, and the bedroll gains a second cell.
 *
 * Rotation is simply zero for everything: nothing could be rotated before this version,
 * so every structure was in its default orientation and saying so is not a guess.
 *
 * The bedroll is a guess, and it is the interesting half. Widening it to 2×1 extends it
 * one cell east, and in an old colony that cell may hold a wall the player built after
 * landing. So the step reads the save's *own* blocking grid — it must not consult the
 * live map, which does not exist yet at migration time — and turns the bedroll a quarter
 * turn if east is occupied. If south is occupied too, the bedroll stays where it is and
 * overlaps: a bedroll is passable and seals no room, so a residual overlap is untidy on
 * screen rather than a corrupt grid, and refusing to load a colony over it would be a
 * far worse trade.
 */
function addRotationAndWidenBedrolls(save: Record<string, unknown>): Record<string, unknown> {
  const map = save.map as { width: number; height: number; blocks: number[] };
  const blocks = decodeRle(map.blocks, map.width * map.height);
  const buildings = save.buildings as Record<string, unknown>[];

  const occupied = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
    return blocks[y * map.width + x] !== 0;
  };

  return {
    ...save,
    version: 6,
    buildings: buildings.map((building) => {
      if (building.def !== V5_BEDROLL) return { ...building, rotation: 0 };

      const pos = building.pos as { x: number; y: number };
      const eastClear = !occupied(pos.x + V5_BEDROLL_WIDTH - 1, pos.y);
      const southClear = !occupied(pos.x, pos.y + V5_BEDROLL_WIDTH - 1);

      return { ...building, rotation: eastClear || !southClear ? 0 : 1 };
    }),
    sites: (save.sites as Record<string, unknown>[]).map((site) => ({ ...site, rotation: 0 })),
  };
}

/** Keyed by the version being upgraded *from*. */
const STEPS: Record<number, MigrationStep> = {
  1: addNaturalTerrain,
  2: addWorkbenchesAndCook,
  3: addPointsOfInterest,
  4: addDraftAndPlayerCharacter,
  5: addRotationAndWidenBedrolls,
};

/**
 * Validates and upgrades raw parsed JSON.
 *
 * Throws rather than guessing. A save from a *newer* build cannot be safely down-graded,
 * and silently loading it half-understood would corrupt a colony rather than refuse it.
 */
export function migrate(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaveVersionError('Save file is not an object');
  }

  let save = raw as Record<string, unknown>;
  const version = save.version;

  if (typeof version !== 'number') {
    throw new SaveVersionError('Save file has no version');
  }
  if (version > SAVE_VERSION) {
    throw new SaveVersionError(
      `Save is from a newer version (${version}); this build understands up to ${SAVE_VERSION}`,
    );
  }

  let current = version;
  while (current < SAVE_VERSION) {
    const step = STEPS[current];
    if (!step) {
      throw new SaveVersionError(`No migration from save version ${current}`);
    }
    save = step(save);
    current = save.version as number;
  }

  return save as unknown as SaveData;
}
