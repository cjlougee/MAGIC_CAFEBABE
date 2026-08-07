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

import { SAVE_VERSION, type SaveData } from './serialize';

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

/** Keyed by the version being upgraded *from*. */
const STEPS: Record<number, MigrationStep> = {
  1: addNaturalTerrain,
  2: addWorkbenchesAndCook,
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
