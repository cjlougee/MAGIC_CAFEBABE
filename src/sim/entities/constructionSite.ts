/**
 * A blueprint, and the frame it becomes.
 *
 * RimWorld keeps blueprints and frames as separate things; this merges them into one
 * entity with two phases, because the only real difference is whether the materials
 * have arrived. One entity means one reservation, one cancel path, and one place to ask
 * "what is being built here".
 *
 * Sites are **passable** while under construction. A colonist must be able to walk over
 * a planned wall to reach the far side of it, or a half-drawn house becomes a cage.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { buildableDef, type BuildableId } from '../defs/buildables';
import { type ItemDefId } from '../defs/items';
import { cellsOf, footprintOfBuildable, type Rotation } from '../world/footprint';
import { emptyLedger, hasAllOf, missingOf, outstandingOf } from './materials';

export interface ConstructionSite {
  readonly id: EntityId;
  readonly def: BuildableId;
  /** The anchor of the footprint this will become — see `entities/building.ts`. */
  readonly pos: TilePos;
  /** Carried through construction so the finished building faces the way it was placed. */
  readonly rotation: Rotation;
  /** Materials delivered so far, indexed by ItemDefId. */
  readonly delivered: number[];
  /** Construction effort accumulated once materials are complete. */
  workDone: number;
}

export function createSite(
  id: EntityId,
  def: BuildableId,
  pos: TilePos,
  rotation: Rotation = 0,
): ConstructionSite {
  return {
    id,
    def,
    pos,
    rotation,
    delivered: emptyLedger(),
    workDone: 0,
  };
}

/** The cells this site occupies — the footprint of whatever it is becoming. */
export function siteCells(site: ConstructionSite): TilePos[] {
  return cellsOf(site.pos, footprintOfBuildable(site.def), site.rotation);
}

// The three questions below are the *same* three a workbench asks about its ingredients,
// so they delegate to `materials.ts` rather than duplicating the arithmetic. See
// docs/design/07-production.md.

/** How much more of `item` this site still wants. Zero when satisfied. */
export function outstanding(site: ConstructionSite, item: ItemDefId): number {
  return outstandingOf(site.delivered, buildableDef(site.def).cost, item);
}

/** True once every material has arrived and only labour remains. */
export function hasAllMaterials(site: ConstructionSite): boolean {
  return hasAllOf(site.delivered, buildableDef(site.def).cost);
}

/** Whatever is still missing, for the giver to go looking for. */
export function missingMaterials(site: ConstructionSite): ItemDefId[] {
  return missingOf(site.delivered, buildableDef(site.def).cost);
}

/** 0–1 across the whole job, materials and labour together. Used by the renderer. */
export function buildProgress(site: ConstructionSite): number {
  const def = buildableDef(site.def);
  const wanted = def.cost.reduce((sum, cost) => sum + cost.count, 0);
  const arrived = def.cost.reduce((sum, cost) => sum + Math.min(cost.count, site.delivered[cost.def]), 0);

  const materialShare = wanted === 0 ? 1 : arrived / wanted;
  const workShare = def.work === 0 ? 1 : Math.min(1, site.workDone / def.work);
  // Materials are half the visible progress, labour the other half.
  return materialShare * 0.5 + workShare * 0.5;
}
