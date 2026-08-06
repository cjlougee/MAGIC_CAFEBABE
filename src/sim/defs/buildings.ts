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
} as const;

export type BuildingId = (typeof Building)[keyof typeof Building];

export interface BuildingDef {
  readonly id: BuildingId;
  readonly name: string;
  /** Colonists can sleep here, and sleeping here is better than the ground. */
  readonly isBed: boolean;
  /** Whether the building blocks movement. */
  readonly passable: boolean;
}

/** Indexed by BuildingId — array position must equal `id`. */
export const BUILDING_DEFS: readonly BuildingDef[] = [
  { id: Building.Bedroll, name: 'Bedroll', isBed: true, passable: true },
];

export function buildingDef(id: BuildingId): BuildingDef {
  return BUILDING_DEFS[id];
}

/** Bedrolls the starting party brought with them — one each. */
export const STARTING_BEDROLLS_PER_COLONIST = 1;
