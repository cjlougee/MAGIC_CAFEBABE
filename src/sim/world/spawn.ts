/**
 * Placing the starting colonists.
 *
 * The landing site matters more than it looks: drop the party onto a three-tile ledge
 * walled in by rock and the colony is unplayable before the player has done anything.
 * So the site is chosen by how much *connected, open* ground surrounds it, not merely
 * by whether the centre tile happens to be walkable.
 */

import type { EntityStore } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import type { Rng } from '../core/rng';
import { Building } from '../defs/buildings';
import { FIRST_NAMES, SURNAMES } from '../defs/names';
import { APPEARANCE_VARIANTS } from '../defs/pawnKind';
import { BUSH_DENSITY, Plant as PlantKind, plantDef } from '../defs/plants';
import { Terrain } from '../defs/terrain';
import { createBuilding, type Building as BuildingEntity } from '../entities/building';
import { createPawn, type Pawn, type PawnAppearance } from '../entities/pawn';
import { createPlant, type Plant } from '../entities/plant';
import type { TileMap } from '../world/tilemap';

/** Radius of the openness sample around a candidate site. */
const OPENNESS_RADIUS = 4;

/** How far from the map centre we are willing to look for somewhere decent. */
const SEARCH_RADIUS = 28;

/** Whether a cell qualifies for some purpose. Passed down so the rule is stated once. */
type CellTest = (map: TileMap, x: number, y: number, z: number) => boolean;

const isPassableCell: CellTest = (map, x, y, z) => map.isPassable(x, y, z);

/**
 * Ground the colony can actually use: walkable *and* able to hold what is set on it.
 *
 * Deliberately not `isPassable` alone. Shallow water is passable, so an open lake reads
 * as flawlessly unobstructed ground — which made the site chooser prefer the middle of a
 * lake to every meadow on the map. See docs/decisions/0004-water.md.
 */
const isUsableGround: CellTest = (map, x, y, z) =>
  map.isPassable(x, y, z) && map.isStorable(x, y, z);

function opennessAt(map: TileMap, x: number, y: number, z: number, accept: CellTest): number {
  let open = 0;
  for (let dy = -OPENNESS_RADIUS; dy <= OPENNESS_RADIUS; dy++) {
    for (let dx = -OPENNESS_RADIUS; dx <= OPENNESS_RADIUS; dx++) {
      if (accept(map, x + dx, y + dy, z)) open++;
    }
  }
  return open;
}

/**
 * Scans outward in a deterministic order and keeps the best score, so the same seed
 * always lands in the same place. Returns a negative score when nothing qualified.
 */
function bestSiteBy(
  map: TileMap,
  z: number,
  accept: CellTest,
): { site: TilePos; score: number } {
  const centreX = Math.floor(map.width / 2);
  const centreY = Math.floor(map.height / 2);

  let best: TilePos = { x: centreX, y: centreY, z };
  let bestScore = -1;

  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const x = centreX + dx;
      const y = centreY + dy;
      if (!accept(map, x, y, z)) continue;

      // Nudge toward the centre so ties don't drift to a map edge.
      const distance = Math.abs(dx) + Math.abs(dy);
      const score = opennessAt(map, x, y, z, accept) * 4 - distance;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, z };
      }
    }
  }

  return { site: best, score: bestScore };
}

/**
 * The best patch of dry, open ground near the map centre.
 *
 * The site matters more than it looks in *both* directions: land the party on a ledge
 * walled in by rock and the colony is unplayable, but land them in a lake and they have
 * nowhere to set down the bedrolls they carried, so everyone sleeps rough forever with a
 * permanent mood penalty and nothing on screen to explain it.
 */
export function findLandingSite(map: TileMap, z: number = GROUND_LEVEL): TilePos {
  const dry = bestSiteBy(map, z, isUsableGround);
  if (dry.score >= 0) return dry.site;

  // No dry ground within reach at all — degenerate, but a wet landing still beats
  // returning the map centre without having looked at what is there.
  return bestSiteBy(map, z, isPassableCell).site;
}

/**
 * Cells nearest a site that pass `accept`, in rings, so colonists land clustered but
 * not stacked.
 *
 * The test is applied *during* the search, never to its result. Taking the nearest N
 * passable cells and filtering afterwards quietly returns fewer than were asked for
 * instead of looking further out — which is how a party landing beside a pond lost the
 * bedrolls it arrived with.
 */
function nearbyCells(
  map: TileMap,
  site: TilePos,
  count: number,
  accept: CellTest,
): TilePos[] {
  const z = site.z ?? GROUND_LEVEL;
  const found: TilePos[] = [];

  for (let radius = 0; radius <= OPENNESS_RADIUS * 2 && found.length < count; radius++) {
    for (let dy = -radius; dy <= radius && found.length < count; dy++) {
      for (let dx = -radius; dx <= radius && found.length < count; dx++) {
        // Ring only — the interior was covered by a smaller radius.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = site.x + dx;
        const y = site.y + dy;
        if (accept(map, x, y, z)) found.push({ x, y, z });
      }
    }
  }

  return found;
}

function rollAppearance(rng: Rng): PawnAppearance {
  return {
    skinTone: rng.int(APPEARANCE_VARIANTS.skinTones),
    hairStyle: rng.int(APPEARANCE_VARIANTS.hairStyles),
    hairColour: rng.int(APPEARANCE_VARIANTS.hairColours),
    apparelColour: rng.int(APPEARANCE_VARIANTS.apparelColours),
  };
}

export function spawnColonists(
  map: TileMap,
  pawns: EntityStore<Pawn>,
  rng: Rng,
  count: number,
): TilePos {
  const site = findLandingSite(map);
  // Colonists only need somewhere to stand, so wading is allowed here — it is putting
  // things *down* that needs dry ground.
  const cells = nearbyCells(map, site, count, isPassableCell);
  const used = new Set<string>();

  for (let i = 0; i < count; i++) {
    // If the map is so hostile there aren't even `count` open cells, stack the
    // remainder on the site rather than failing to start.
    const cell = cells[i] ?? site;
    pawns.add((id) => createPawn(id, rollName(rng, used), cell, rollAppearance(rng)));
  }

  return site;
}

/**
 * A name nobody in the party already has.
 *
 * Two colonists called "Fen Stave" makes the roster unreadable and every story about
 * them ambiguous. Bounded retries so an unlucky seed can't spin.
 */
function rollName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
}

/** Bedrolls the party brought with them, laid out around the landing site. */
export function placeBedrolls(
  map: TileMap,
  buildings: EntityStore<BuildingEntity>,
  site: TilePos,
  count: number,
): void {
  const cells = nearbyCells(map, site, count, (m, x, y, z) => m.isStorable(x, y, z));

  for (let i = 0; i < count && i < cells.length; i++) {
    buildings.add((id) => createBuilding(id, Building.Bedroll, cells[i]));
  }
}

/**
 * Scatters berry bushes across vegetated ground.
 *
 * Growth starts randomised rather than at zero, so the colony doesn't face a synchronised
 * famine followed by a synchronised glut — food arriving in a steady trickle is what
 * makes it a supply rather than an event.
 */
export function scatterPlants(map: TileMap, plants: EntityStore<Plant>, rng: Rng): void {
  const ripeAt = plantDef(PlantKind.BerryBush).growTicks;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getTerrain(x, y) !== Terrain.Grass) continue;
      if (!rng.chance(BUSH_DENSITY)) continue;

      const growth = rng.int(ripeAt);
      plants.add((id) => createPlant(id, PlantKind.BerryBush, { x, y, z: GROUND_LEVEL }, growth));
    }
  }
}
