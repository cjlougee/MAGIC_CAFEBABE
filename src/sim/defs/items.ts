/**
 * Item definitions.
 *
 * The bottom rung of the crafting ladder: **scrap → refined → salvaged relic-tech**.
 * Stone comes out of rock, scrap out of the fallen civilization's bulkheads — so from
 * the first minute the two resources the player sees encode the setting's premise.
 * Refining and relic recovery arrive in Slice 2 and Slice 4.
 */

export const ItemDef = {
  Stone: 0,
  Scrap: 1,
  RawFood: 2,
} as const;

export type ItemDefId = (typeof ItemDef)[keyof typeof ItemDef];

export interface ItemDefinition {
  readonly id: ItemDefId;
  readonly name: string;
  /** Most that can occupy a single cell. Overflow spills to a neighbouring cell. */
  readonly stackLimit: number;
  /** Whether a colonist can eat this. Raw food works, but they won't enjoy it. */
  readonly edible: boolean;
}

/** Indexed by ItemDefId — array position must equal `id`. */
export const ITEM_DEFS: readonly ItemDefinition[] = [
  { id: ItemDef.Stone, name: 'Stone', stackLimit: 75, edible: false },
  { id: ItemDef.Scrap, name: 'Scrap', stackLimit: 75, edible: false },
  // Edible, but eaten raw it costs mood — the pressure that makes cooking worth
  // building in Slice 2 rather than a feature nobody asked for.
  { id: ItemDef.RawFood, name: 'Raw Food', stackLimit: 50, edible: true },
];

export function itemDef(id: ItemDefId): ItemDefinition {
  return ITEM_DEFS[id];
}
