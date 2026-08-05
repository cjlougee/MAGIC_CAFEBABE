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
} as const;

export type ItemDefId = (typeof ItemDef)[keyof typeof ItemDef];

export interface ItemDefinition {
  readonly id: ItemDefId;
  readonly name: string;
  /** Most that can occupy a single cell. Overflow spills to a neighbouring cell. */
  readonly stackLimit: number;
}

/** Indexed by ItemDefId — array position must equal `id`. */
export const ITEM_DEFS: readonly ItemDefinition[] = [
  { id: ItemDef.Stone, name: 'Stone', stackLimit: 75 },
  { id: ItemDef.Scrap, name: 'Scrap', stackLimit: 75 },
];

export function itemDef(id: ItemDefId): ItemDefinition {
  return ITEM_DEFS[id];
}
