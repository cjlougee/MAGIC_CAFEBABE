/**
 * What a workbench can be told to make.
 *
 * A recipe is deliberately the same shape as a buildable: a list of required materials,
 * an amount of labour, and a result. That is not a coincidence worth hiding — loading a
 * bench and delivering to a blueprint are the same problem, so they share
 * `outstanding()` / `hasAllMaterials()` / `missingMaterials()` and cannot disagree about
 * what "still needs two berries" means.
 *
 * See docs/design/07-production.md.
 */

import { Building, type BuildingId } from './buildings';
import { ItemDef, type ItemDefId } from './items';

export const Recipe = {
  SimpleMeal: 0,
} as const;

export type RecipeId = (typeof Recipe)[keyof typeof Recipe];

export interface RecipeIngredient {
  readonly def: ItemDefId;
  readonly count: number;
}

export interface RecipeDef {
  readonly id: RecipeId;
  readonly name: string;
  /** The bench this is made at. A bill can only be placed on a matching building. */
  readonly workAt: BuildingId;
  readonly ingredients: readonly RecipeIngredient[];
  readonly product: { readonly def: ItemDefId; readonly count: number };
  /** Ticks of labour once every ingredient has been loaded. */
  readonly work: number;
  /**
   * The quota a freshly added bill starts at.
   *
   * So adding a bill is one click and still does something sensible. The player owns
   * the number afterwards — what counts as "enough" is theirs to decide.
   */
  readonly defaultUntilCount: number;
}

/** Indexed by RecipeId — array position must equal `id`. */
export const RECIPE_DEFS: readonly RecipeDef[] = [
  {
    id: Recipe.SimpleMeal,
    name: 'Simple meal',
    workAt: Building.Campfire,
    // Four berries for one meal, which is a real loss of raw nutrition (4 x 0.14 = 0.56
    // becomes 0.3) paid for in mood. Cooking should be a choice about how the colony
    // lives, not free food.
    ingredients: [{ def: ItemDef.RawFood, count: 4 }],
    product: { def: ItemDef.Meal, count: 1 },
    work: 220,
    defaultUntilCount: 10,
  },
];

export function recipeDef(id: RecipeId): RecipeDef {
  return RECIPE_DEFS[id];
}

/** Every recipe this building can produce. Drives the "add a bill" menu. */
export function recipesFor(building: BuildingId): readonly RecipeDef[] {
  return RECIPE_DEFS.filter((def) => def.workAt === building);
}
