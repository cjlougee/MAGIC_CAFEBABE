/**
 * A named place on the map.
 *
 * Deliberately thin: where it is, how big, what kind, and what it is called. It holds no
 * contents and no discovery state — there is no vision system to set one and nothing to
 * loot until M10, and a flag nothing writes is machinery pretending to be a feature.
 *
 * The **name is the load-bearing field**. It is generated once during worldgen and then
 * saved, which is what makes the place a particular rather than a re-rolled instance.
 * Regenerating it on load would produce a world where the vault you told someone about
 * is called something else next session.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';
import { poiDef, type PoiId } from '../defs/pois';

export interface PointOfInterest {
  readonly id: EntityId;
  readonly def: PoiId;
  /** Generated once at worldgen, then persisted. Never recomputed. */
  readonly name: string;
  /** Centre of the compound. */
  readonly pos: TilePos;
  /** Half-extent in tiles, so the footprint is `pos ± radius`. */
  readonly radius: number;
}

export function createPointOfInterest(
  id: EntityId,
  def: PoiId,
  name: string,
  pos: TilePos,
  radius: number,
): PointOfInterest {
  return { id, def, name, pos, radius };
}

/** "Kessler Relay — listening post", for the UI. */
export function describePoi(poi: PointOfInterest): string {
  return `${poi.name} — ${poiDef(poi.def).kind.toLowerCase()}`;
}
