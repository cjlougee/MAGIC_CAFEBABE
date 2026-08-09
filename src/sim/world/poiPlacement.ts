/**
 * Siting the named places, and building them.
 *
 * **Noise makes texture; constraints make places.** The ruin field scatters plating and
 * bulkheads by thresholding a number, which is the right way to make weather and the
 * wrong way to make a destination — a threshold cannot express "far enough from home to
 * be a journey", "not half in a lake", or "not on top of the last one". Those are
 * constraints, so this is a search rather than a sample. See
 * `docs/decisions/0008-places.md`.
 *
 * Everything here draws from the world RNG, so a seed produces the same places in the
 * same spots with the same names, every time and on every machine.
 */

import type { EntityStore } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import type { Rng } from '../core/rng';
import { PLACE_ADJECTIVES, PLACE_NUMERALS, PLACE_WORDS } from '../defs/names';
import { POI_DEFS, type PoiDef } from '../defs/pois';
import { Terrain } from '../defs/terrain';
import { createPointOfInterest, type PointOfInterest } from '../entities/pointOfInterest';
import { ReachabilityMap } from '../pathfind/reachability';
import type { TileMap } from './tilemap';

/**
 * How far a place must be from the landing site.
 *
 * The number *is* the feature. A ruin you can see from the colony is scenery; one that
 * costs a day's walk each way is a decision about who goes and what the colony does
 * without them. On a 512 map this is far enough to be a trip and near enough to be a
 * first one.
 */
const MIN_DISTANCE_FROM_LANDING = 90;

/** Clear tiles kept between a compound's wall and anything else it must not touch. */
const SITE_MARGIN = 2;

/** Random sites tried per place. Cheap — each test is a small rectangle scan. */
const CANDIDATES = 500;

/**
 * Clear ground required immediately around a compound, in tiles.
 *
 * **This is what makes a place legible, and leaving it out very nearly shipped a
 * milestone that failed its own playable check.** Scoring by nearby wreckage pushes
 * compounds into the *densest* ruin fields — which is right for the fiction and disastrous
 * for reading the map, because a 9-tile post stamped inside a sprawl of plating and
 * bulkheads is the same colours in the same shapes and simply disappears. Watching the
 * game found it; the tests were perfectly happy.
 *
 * A real structure has a cleared perimeter and scattered wreckage does not, so the apron
 * is the thing that says "somebody built this".
 */
const APRON = 4;

/** Width of the band beyond the apron where wreckage counts as context. */
const CONTEXT_BAND = 16;

type Wall = 'north' | 'south' | 'west' | 'east';

const OPPOSITE: Record<Wall, Wall> = {
  north: 'south',
  south: 'north',
  west: 'east',
  east: 'west',
};

/** A doorway: which wall it is in, the cell to open, and the ground it opens onto. */
interface Approach {
  readonly wall: Wall;
  readonly door: TilePos;
  readonly outside: TilePos;
}

interface Constraints {
  /** Fraction of the footprint allowed to be rock before the site is rejected. */
  readonly maxRockFraction: number;
  /** Fraction of the apron allowed to be existing wreckage. Low keeps the outline visible. */
  readonly maxApronRuin: number;
  /** Distance the site must keep from the landing party. */
  readonly minLandingDistance: number;
  /** Whether nearby wreckage is required rather than merely preferred. */
  readonly requireContext: boolean;
}

/** Tried in order. Each is looser than the last, and only a guaranteed place gets past the first. */
const RELAXATIONS: readonly Constraints[] = [
  {
    maxRockFraction: 0.15,
    maxApronRuin: 0.05,
    minLandingDistance: MIN_DISTANCE_FROM_LANDING,
    requireContext: true,
  },
  {
    maxRockFraction: 0.35,
    maxApronRuin: 0.25,
    minLandingDistance: MIN_DISTANCE_FROM_LANDING,
    requireContext: false,
  },
  {
    maxRockFraction: 0.6,
    maxApronRuin: 0.6,
    minLandingDistance: MIN_DISTANCE_FROM_LANDING / 2,
    requireContext: false,
  },
];

function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[rng.int(options.length)];
}

/**
 * A name for a place, in one of three shapes.
 *
 * Retried against the names already used, because two Kessler Relays on one map
 * undoes the entire point of naming them.
 */
function placeName(rng: Rng, def: PoiDef, used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const noun = pick(rng, def.nouns);
    const shape = rng.int(3);

    const name =
      shape === 0
        ? `${pick(rng, PLACE_WORDS)} ${noun}`
        : shape === 1
          ? `${noun} ${pick(rng, PLACE_NUMERALS)}`
          : `The ${pick(rng, PLACE_ADJECTIVES)} ${noun}`;

    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }

  // Every shape collided forty times running, which needs a map far denser in places
  // than anything we generate. Fall back to something unique rather than duplicate.
  const fallback = `${pick(rng, PLACE_WORDS)} ${pick(rng, def.nouns)} ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function distance(a: TilePos, b: TilePos): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isWreckage(terrain: number): boolean {
  return terrain === Terrain.RuinFloor || terrain === Terrain.RuinWall;
}

/**
 * Every wall cell that could become a door, paired with the ground outside it.
 *
 * A door is only a door if something is on the other side of it. Cutting the gaps at
 * random positions and hoping produced *Storrow Mast* on seed 7: a compound whose two
 * openings both faced rock, so the building was sealed — and worse than merely sealed,
 * because its interior is walkable, which makes it an isolated district that reachability
 * reports as unreachable forever with nothing on screen to say why.
 */
function approaches(map: TileMap, centre: TilePos, radius: number): Approach[] {
  const { x: cx, y: cy, z } = centre;
  const found: Approach[] = [];

  const consider = (wall: Wall, dx: number, dy: number, ox: number, oy: number): void => {
    if (!map.inBounds(ox, oy, z)) return;
    if (!map.isPassable(ox, oy, z)) return;
    found.push({ wall, door: { x: dx, y: dy, z }, outside: { x: ox, y: oy, z } });
  };

  for (let x = cx - radius + 1; x <= cx + radius - 1; x++) {
    consider('north', x, cy - radius, x, cy - radius - 1);
    consider('south', x, cy + radius, x, cy + radius + 1);
  }
  for (let y = cy - radius + 1; y <= cy + radius - 1; y++) {
    consider('west', cx - radius, y, cx - radius - 1, y);
    consider('east', cx + radius, y, cx + radius + 1, y);
  }

  return found;
}

/**
 * Whether a site will hold a compound, and how good it is if so.
 *
 * Returns a score, or -1 for "no". Water is an outright rejection rather than a penalty:
 * the ruin field already refuses to put wreckage in water because a structure standing
 * in a lake reads as an accident, and a *named* place doing it would read as a bug.
 */
function scoreSite(
  map: TileMap,
  centre: TilePos,
  radius: number,
  limits: Constraints,
): number {
  const reach = radius + SITE_MARGIN;
  if (centre.x - reach < 0 || centre.y - reach < 0) return -1;
  if (centre.x + reach >= map.width || centre.y + reach >= map.height) return -1;

  let cells = 0;
  let rock = 0;

  for (let y = centre.y - reach; y <= centre.y + reach; y++) {
    for (let x = centre.x - reach; x <= centre.x + reach; x++) {
      const terrain = map.terrain[map.idx(x, y, centre.z)];
      if (terrain === Terrain.DeepWater || terrain === Terrain.ShallowWater) return -1;
      if (terrain === Terrain.Rock) rock++;
      cells++;
    }
  }

  if (rock / cells > limits.maxRockFraction) return -1;

  // The apron: ground immediately around the compound, which must be mostly clear of
  // wreckage or the building has no outline and is invisible from any distance at all.
  const apronOuter = radius + APRON;
  let apronCells = 0;
  let apronRuin = 0;

  for (let y = centre.y - apronOuter; y <= centre.y + apronOuter; y++) {
    for (let x = centre.x - apronOuter; x <= centre.x + apronOuter; x++) {
      if (Math.abs(x - centre.x) <= radius && Math.abs(y - centre.y) <= radius) continue;
      if (!map.inBounds(x, y, centre.z)) continue;
      apronCells++;
      if (isWreckage(map.terrain[map.idx(x, y, centre.z)])) apronRuin++;
    }
  }

  if (apronCells > 0 && apronRuin / apronCells > limits.maxApronRuin) return -1;

  // Beyond the apron, wreckage means the old civilization built in this country, so a
  // compound here belongs to something. Preferred rather than required, except on the
  // strictest pass. Measured from the apron's edge outward so it scales with the
  // compound rather than vanishing behind a big one.
  const contextOuter = apronOuter + CONTEXT_BAND;
  let context = 0;

  for (let y = centre.y - contextOuter; y <= centre.y + contextOuter; y++) {
    for (let x = centre.x - contextOuter; x <= centre.x + contextOuter; x++) {
      if (Math.abs(x - centre.x) <= apronOuter && Math.abs(y - centre.y) <= apronOuter) continue;
      if (!map.inBounds(x, y, centre.z)) continue;
      if (isWreckage(map.terrain[map.idx(x, y, centre.z)])) context++;
    }
  }

  if (limits.requireContext && context === 0) return -1;
  return context + 1;
}

/**
 * Raises a walled compound: bulkhead perimeter, plating inside, and a way in.
 *
 * The doorways are not decoration. A sealed ring would be an enclosure nothing can enter
 * and, worse, an isolated pocket of walkable ground that reachability would dutifully
 * report as its own district forever.
 */
function stampCompound(
  map: TileMap,
  centre: TilePos,
  radius: number,
  doors: readonly Approach[],
  rng: Rng,
): void {
  const { x: cx, y: cy, z } = centre;

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const onEdge = x === cx - radius || x === cx + radius || y === cy - radius || y === cy + radius;
      map.setTerrainAt(map.idx(x, y, z), onEdge ? Terrain.RuinWall : Terrain.RuinFloor);
    }
  }

  /*
   * An internal wall with its own gap, so the inside is a building rather than a yard.
   *
   * Offset from the middle rather than through it, for two reasons. It looks better — a
   * symmetrical split reads as a pattern and patterns read as generated. And `pos` is the
   * centre cell, which is the place's address: the minimap marker points at it and M9's
   * travel order will path to it, so it has to be standable. A cross-wall laid exactly on
   * `cy` made the middle of the compound solid rock, and the only symptom was a colonist
   * who would not go there.
   *
   * Small posts get no internal wall at all; there is no room for one that leaves a room.
   */
  if (radius >= 5) {
    const offset = rng.range(2, radius - 1);
    const split = cy + (rng.chance(0.5) ? -offset : offset);

    for (let x = cx - radius + 1; x <= cx + radius - 1; x++) {
      map.setTerrainAt(map.idx(x, split, z), Terrain.RuinWall);
    }
    const innerDoor = cx - radius + 1 + rng.int(radius * 2 - 1);
    map.setTerrainAt(map.idx(innerDoor, split, z), Terrain.RuinFloor);
  }

  // The ways in, cut last so nothing above closes them again. These were chosen during
  // the search from wall cells that actually face open ground.
  for (const approach of doors) {
    map.setTerrainAt(map.idx(approach.door.x, approach.door.y, z), Terrain.RuinFloor);
  }
}

/**
 * Up to two doors, on facing walls where the ground allows it.
 *
 * Two ways in on *opposite* sides gives the compound a through-route, so it reads as
 * somewhere people passed through rather than a box with a hole. Falls back to any other
 * wall, and then to a single door, because the ground outside decides what is possible —
 * the whole reason these are chosen from a candidate list and not cut at random.
 */
function chooseDoors(candidates: readonly Approach[], rng: Rng): Approach[] {
  const first = candidates[rng.int(candidates.length)];

  const facing = candidates.filter((other) => other.wall === OPPOSITE[first.wall]);
  const elsewhere = candidates.filter((other) => other.wall !== first.wall);
  const second = facing.length > 0 ? facing : elsewhere;

  return second.length > 0 ? [first, second[rng.int(second.length)]] : [first];
}

interface Site {
  readonly centre: TilePos;
  readonly doors: readonly Approach[];
}

function trySite(
  map: TileMap,
  rng: Rng,
  radius: number,
  landingSite: TilePos,
  placed: readonly PointOfInterest[],
  limits: Constraints,
  connected: (cell: TilePos) => boolean,
): Site | null {
  let best: Site | null = null;
  let bestScore = 0;

  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    const candidate: TilePos = {
      x: rng.int(map.width),
      y: rng.int(map.height),
      z: GROUND_LEVEL,
    };

    if (distance(candidate, landingSite) < limits.minLandingDistance) continue;

    // Places must not overlap or crowd each other; two compounds sharing a wall would
    // read as one confused building rather than two finds.
    let crowded = false;
    for (const other of placed) {
      // Far enough apart that neither sits in the other's apron, so each keeps its own
      // clear outline and reads as a separate find.
      if (distance(candidate, other.pos) < radius + other.radius + APRON * 3) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;

    const score = scoreSite(map, candidate, radius, limits);
    if (score <= bestScore) continue;

    // Last, because it is the dearest test and only a candidate that would win is worth
    // paying for. A place has to have a way in *from the colony* — an approach onto
    // ground nobody can get to is the same as no approach at all.
    const usable = approaches(map, candidate, radius).filter((option) =>
      connected(option.outside),
    );
    if (usable.length === 0) continue;

    bestScore = score;
    best = { centre: candidate, doors: chooseDoors(usable, rng) };
  }

  return best;
}

/**
 * Sites and builds every place in the world.
 *
 * Runs after the landing site is chosen — the distance constraint needs it — and before
 * plants are scattered, so nothing grows inside a compound that is about to be stamped
 * over it.
 */
export function placePointsOfInterest(
  map: TileMap,
  pois: EntityStore<PointOfInterest>,
  rng: Rng,
  landingSite: TilePos,
): void {
  const used = new Set<string>();
  const placed: PointOfInterest[] = [];

  /*
   * Built once, before anything is stamped, and deliberately not refreshed between
   * places.
   *
   * Stamping a walled ring into open ground cannot disconnect the ground around it —
   * you walk around a building — and the interior reaches the outside through a door
   * that was chosen from already-connected ground. So the answers this gives stay true
   * for the cells it is asked about. Rebuilding it per place would cost a full re-flood
   * each time for nothing, and worldgen would slow by an order of magnitude.
   */
  const reach = new ReachabilityMap(map);
  const connected = (cell: TilePos): boolean => reach.canReach(landingSite, cell);

  // Largest first. A vault needs the rarest kind of ground, so letting the small posts
  // claim the good country first is how a world ends up without its guaranteed place.
  const order = [...POI_DEFS].sort((a, b) => b.maxSpan - a.maxSpan);

  for (const def of order) {
    for (let n = 0; n < def.count; n++) {
      const span = rng.range(def.minSpan, def.maxSpan + 1);
      const radius = Math.floor(span / 2);

      let site: Site | null = null;
      for (const limits of RELAXATIONS) {
        site = trySite(map, rng, radius, landingSite, placed, limits, connected);
        if (site) break;
        // Only a place the world is promised keeps trying on looser terms. An optional
        // listening post that cannot find good ground simply does not exist this seed,
        // which is better than one wedged somewhere implausible.
        if (!def.guaranteed) break;
      }

      if (!site) continue;

      const chosen = site;
      stampCompound(map, chosen.centre, radius, chosen.doors, rng);
      const poi = pois.add((id) =>
        createPointOfInterest(id, def.id, placeName(rng, def, used), chosen.centre, radius),
      );
      placed.push(poi);
    }
  }
}
