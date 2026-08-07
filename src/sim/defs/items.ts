/**
 * Item definitions.
 *
 * The bottom rung of the crafting ladder: **scrap → refined → salvaged relic-tech**.
 * Stone comes out of rock, scrap out of the fallen civilization's bulkheads — so from
 * the first minute the two resources the player sees encode the setting's premise.
 * Refining and relic recovery arrive in Slice 2 and Slice 4.
 */

import { Thought, type ThoughtId } from './thoughts';

export const ItemDef = {
  Stone: 0,
  Scrap: 1,
  RawFood: 2,
  Meal: 3,
} as const;

export type ItemDefId = (typeof ItemDef)[keyof typeof ItemDef];

/**
 * What eating this does. `null` for anything inedible.
 *
 * Nutrition and the resulting thought live here rather than as constants beside the
 * eating code, because the moment there were two foods that code would have needed to
 * branch on which one — and two branches that must agree about what food *is* drift.
 * As item data, a third food is a data change and `consumeFood` never learns about it.
 */
export interface FoodValue {
  /** Hunger restored by one unit, on the 0–1 need scale. */
  readonly nutrition: number;
  /** The memory left behind. What makes cooking worth the labour. */
  readonly thought: ThoughtId;
}

export interface ItemDefinition {
  readonly id: ItemDefId;
  readonly name: string;
  /** Most that can occupy a single cell. Overflow spills to a neighbouring cell. */
  readonly stackLimit: number;
  /** What eating it is worth, or null if it isn't food. */
  readonly food: FoodValue | null;
}

/** Indexed by ItemDefId — array position must equal `id`. */
export const ITEM_DEFS: readonly ItemDefinition[] = [
  { id: ItemDef.Stone, name: 'Stone', stackLimit: 75, food: null },
  { id: ItemDef.Scrap, name: 'Scrap', stackLimit: 75, food: null },
  // Edible, but eaten raw it costs mood — the pressure that makes cooking worth
  // building rather than a feature nobody asked for.
  {
    id: ItemDef.RawFood,
    name: 'Raw Food',
    stackLimit: 50,
    food: { nutrition: 0.14, thought: Thought.AteRawFood },
  },
  // Worth roughly two units of raw food and a mood swing besides, so a campfire pays
  // for itself in both directions: fewer trips to the larder, and a better day.
  {
    id: ItemDef.Meal,
    name: 'Meal',
    stackLimit: 25,
    food: { nutrition: 0.3, thought: Thought.AteMeal },
  },
];

/** Whether a colonist can eat this at all. */
export function isEdible(id: ItemDefId): boolean {
  return ITEM_DEFS[id].food !== null;
}

export function itemDef(id: ItemDefId): ItemDefinition {
  return ITEM_DEFS[id];
}
