/**
 * How many cells a structure stands on.
 *
 * Everything used to assume one building occupied exactly one cell — placement legality,
 * blocking, sealing, which cell a pawn walks to, save shape, deconstruct. A desk is not
 * one tile, so the assumption had to go, and it had to go from *one* place: this module
 * is the only thing in the codebase that turns a def plus a rotation into a set of cells.
 * If a second place ever computes it, the two will disagree the first time the rotation
 * convention changes, and the symptom will be a building that blocks cells it isn't
 * drawn on.
 *
 * **Cells are derived, never saved.** The anchor and the rotation are saved; the
 * footprint follows from the def. A stored copy could disagree with what it came from
 * and nothing could say which was right.
 */

import { GROUND_LEVEL, type TilePos } from '../core/position';
import { buildableDef, type BuildableId } from '../defs/buildables';
import { buildingDef, SINGLE_CELL, type BuildingId, type Footprint } from '../defs/buildings';
import { DIRECTIONS } from '../pathfind/neighbours';

export type { Footprint } from '../defs/buildings';
export { SINGLE_CELL } from '../defs/buildings';

/**
 * Quarter turns clockwise from the orientation the def is written in.
 *
 * Rotations **0 and 2 cover the same cells** and differ only in facing — which end of a
 * bed the pillow is at. 1 and 3 likewise. That is what lets four facings be drawn from
 * two footprint orientations.
 */
export type Rotation = 0 | 1 | 2 | 3;

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 1) % 4) as Rotation;
}

/** The footprint as it sits on the map once rotated. Odd turns swap the axes. */
export function sizeOf(footprint: Footprint, rotation: Rotation): Footprint {
  return rotation % 2 === 0
    ? { w: footprint.w, h: footprint.h }
    : { w: footprint.h, h: footprint.w };
}

export function isSingleCell(footprint: Footprint): boolean {
  return footprint.w === 1 && footprint.h === 1;
}

export function footprintOfBuilding(def: BuildingId): Footprint {
  return buildingDef(def).footprint;
}

/**
 * What a blueprint will stand on.
 *
 * Terrain results are always one cell: a floor changes the cell itself, and a multi-tile
 * floor is just several floors. Only buildings carry a footprint.
 */
export function footprintOfBuildable(def: BuildableId): Footprint {
  const result = buildableDef(def).result;
  return result.kind === 'building' ? footprintOfBuilding(result.building) : SINGLE_CELL;
}

/**
 * Whether turning this blueprint changes anything the player can see.
 *
 * Not the same question as "is it more than one cell". A door is one cell in every
 * rotation and still has to line up with the wall run it interrupts; a 2×2 hearth is four
 * cells and looks identical from every side.
 */
export function isOrientable(def: BuildableId): boolean {
  const result = buildableDef(def).result;
  return result.kind === 'building' && buildingDef(result.building).orientable;
}

/**
 * Every cell a structure anchored here would stand on.
 *
 * `anchor` is the **minimum x and y** of the rotated footprint, so the cells are simply
 * the rectangle extending right and down from it. The cell the player clicks becomes the
 * anchor, which is why the drag preview has to draw the whole footprint — otherwise a
 * 2×2 appears to be going somewhere it isn't.
 */
export function cellsOf(anchor: TilePos, footprint: Footprint, rotation: Rotation): TilePos[] {
  const { w, h } = sizeOf(footprint, rotation);
  const cells: TilePos[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      cells.push({ x: anchor.x + dx, y: anchor.y + dy, z: anchor.z });
    }
  }
  return cells;
}

/**
 * The cell at the *facing* end of a footprint — where a colonist lies on a bed.
 *
 * This is the whole difference between rotations 0 and 2, which cover identical cells.
 * Without it the two would be indistinguishable in every way the simulation can observe,
 * and "rotate the bed" would be a control that does nothing.
 */
export function headCellOf(anchor: TilePos, footprint: Footprint, rotation: Rotation): TilePos {
  if (rotation < 2) return { ...anchor };
  const { w, h } = sizeOf(footprint, rotation);
  return { x: anchor.x + w - 1, y: anchor.y + h - 1, z: anchor.z };
}

/**
 * The anchor for a footprint turning about the cell the player is pointing at.
 *
 * **The inverse of `headCellOf`**, and that is the whole idea: the cell under the cursor is
 * the *facing* cell, and rotating swings the rest of the structure around it.
 *
 * Without this, turning a 2×1 appeared to oscillate rather than rotate. The anchor is the
 * minimum corner, so rotations 0 and 2 cover identical cells — press E four times and the
 * far cell went east, south, east, south, while the sprite flipped underneath. Every
 * individual part of that is correct and the gesture still reads as broken, because a
 * player turning something expects the thing to keep going the same way round.
 *
 * Pivoting on the facing cell gives east, south, west, north — one continuous turn — and
 * costs the simulation nothing: the stored anchor is still the minimum corner, still what
 * `cellsOf` extends from, and no save changes meaning. This is a fact about *where the
 * cursor is*, which is why it lives at the input's edge and not in the entity.
 */
export function anchorFor(pivot: TilePos, footprint: Footprint, rotation: Rotation): TilePos {
  if (rotation < 2) return { ...pivot };
  const { w, h } = sizeOf(footprint, rotation);
  return { x: pivot.x - (w - 1), y: pivot.y - (h - 1), z: pivot.z };
}

/**
 * Whether a structure anchored here stands on this cell.
 *
 * Arithmetic rather than building a list, because `buildingAt` calls this once per
 * building on every lookup and those lookups sit inside loops that already walk the map.
 */
export function coversCell(
  anchor: TilePos,
  footprint: Footprint,
  rotation: Rotation,
  x: number,
  y: number,
  z: number = GROUND_LEVEL,
): boolean {
  if (z !== anchor.z) return false;
  const { w, h } = sizeOf(footprint, rotation);
  return x >= anchor.x && x < anchor.x + w && y >= anchor.y && y < anchor.y + h;
}

/**
 * Cells orthogonally or diagonally touching the footprint, excluding the footprint.
 *
 * Shares `DIRECTIONS` with A* and reachability rather than declaring a second list.
 * The order decides which cell wins a distance tie, so a private copy would be a silent
 * determinism fork the first time either was reordered.
 *
 * What "walk next to it" means once a structure is bigger than a cell. The exclusion
 * matters even for passable structures: a colonist delivering materials must stand
 * *beside* a site, never on it, or finishing the wall can seal them inside it.
 */
export function cellsAdjacentTo(cells: readonly TilePos[]): TilePos[] {
  const inFootprint = new Set<string>();
  for (const cell of cells) inFootprint.add(key(cell.x, cell.y, cell.z));

  const seen = new Set<string>();
  const adjacent: TilePos[] = [];

  for (const cell of cells) {
    for (const [dx, dy] of DIRECTIONS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const id = key(x, y, cell.z);
      if (inFootprint.has(id) || seen.has(id)) continue;
      seen.add(id);
      adjacent.push({ x, y, z: cell.z });
    }
  }

  return adjacent;
}

/**
 * True when `from` is standing next to the footprint — and not on it.
 *
 * Standing *inside* the footprint disqualifies, which only becomes a distinction once a
 * structure spans several cells: a pawn on one end of a 2×1 bed is genuinely adjacent to
 * the other end, and a naive any-cell test would call that "beside it" and let a
 * deliverer park on the site it is about to be sealed into.
 */
export function isAdjacentToFootprint(from: TilePos, cells: readonly TilePos[]): boolean {
  let beside = false;

  for (const cell of cells) {
    if (cell.z !== from.z) continue;
    const dx = Math.abs(cell.x - from.x);
    const dy = Math.abs(cell.y - from.y);
    if (dx === 0 && dy === 0) return false;
    if (dx <= 1 && dy <= 1) beside = true;
  }

  return beside;
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}
