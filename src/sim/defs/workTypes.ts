/**
 * Work types — the columns of the priority grid.
 *
 * A work type is what the *player* schedules; a WorkGiver is what actually finds a
 * specific job of that type. One work type can have several givers (Haul will grow
 * "deliver to blueprint" and "restock workbench" without gaining a column).
 *
 * Priorities follow RimWorld's convention because it is the one players already know:
 * **lower number = more urgent**, and 0 means "never do this". The inversion is
 * unintuitive read cold, which is exactly why matching the genre standard beats
 * inventing something cleaner.
 *
 * Only Mine and Haul exist today. Construct arrives with blueprints (M4) and Cook with
 * stoves (M3) — a column with no giver behind it would be a lie told to the player.
 */

export const WorkType = {
  Harvest: 0,
  Mine: 1,
  Haul: 2,
} as const;

export type WorkTypeId = (typeof WorkType)[keyof typeof WorkType];

export interface WorkTypeDef {
  readonly id: WorkTypeId;
  readonly label: string;
  readonly description: string;
}

/**
 * Indexed by WorkTypeId. Display order is the order of this array.
 *
 * Harvest sits first because food is the work that keeps everyone alive, and the
 * leftmost column is the one players read as most important.
 */
export const WORK_TYPE_DEFS: readonly WorkTypeDef[] = [
  {
    id: WorkType.Harvest,
    label: 'Harvest',
    description: 'Gather ripe food from plants.',
  },
  {
    id: WorkType.Mine,
    label: 'Mine',
    description: 'Cut rock and strip bulkheads down for materials.',
  },
  {
    id: WorkType.Haul,
    label: 'Haul',
    description: 'Carry loose items to a stockpile.',
  },
];

export const WORK_TYPE_COUNT = WORK_TYPE_DEFS.length;

/** 0 disables the work type entirely; 1 is the most urgent. */
export const PRIORITY_DISABLED = 0;
export const PRIORITY_HIGHEST = 1;
export const PRIORITY_LOWEST = 4;
export const DEFAULT_PRIORITY = 3;

export function defaultPriorities(): number[] {
  return new Array(WORK_TYPE_COUNT).fill(DEFAULT_PRIORITY);
}
