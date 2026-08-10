/**
 * Needs: the clocks, and the jobs they force.
 *
 * A need job **outranks every work type**, unconditionally. It does not enter the
 * priority grid and cannot be switched off. Without that, a colonist with Haul at
 * priority 1 would starve to death beside a stockpile, and the player would rightly
 * call it a bug rather than a lesson about priorities.
 */

import type { EntityId } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import { itemDef } from '../defs/items';
import { Need, needDef, NEED_DEFS, REST_PER_SLEEPING_TICK, STARVATION_DAMAGE_PER_TICK } from '../defs/needs';
import { thoughtDef } from '../defs/thoughts';
import { isBed, type Building } from '../entities/building';
import { isOnGround, type Item } from '../entities/item';
import type { Pawn } from '../entities/pawn';
import { footprintOfBuilding, headCellOf } from '../world/footprint';
import type { World } from '../world/world';
import type { Job } from './job';
import { addThought } from './mood';

/** Night hours, when colonists prefer to sleep even if not yet exhausted. */
const NIGHT_FROM = 22;
const NIGHT_UNTIL = 6;

/** Rest level below which night-time makes a colonist turn in. */
const NIGHT_REST_THRESHOLD = 0.75;

export function tickNeeds(pawn: Pawn): void {
  if (pawn.dead) return;

  if (pawn.asleep) {
    pawn.needs[Need.Rest] = Math.min(1, pawn.needs[Need.Rest] + REST_PER_SLEEPING_TICK);
  } else {
    pawn.needs[Need.Rest] = Math.max(0, pawn.needs[Need.Rest] - needDef(Need.Rest).fallPerTick);
  }

  pawn.needs[Need.Hunger] = Math.max(
    0,
    pawn.needs[Need.Hunger] - needDef(Need.Hunger).fallPerTick,
  );

  // Starvation is the only thing that can kill so far, and it is deliberately slow:
  // hitting zero hunger should be an alarm the player can still act on.
  if (pawn.needs[Need.Hunger] <= 0) {
    pawn.health = Math.max(0, pawn.health - STARVATION_DAMAGE_PER_TICK);
    if (pawn.health <= 0) pawn.dead = true;
  }
}

function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
}

/**
 * The best reachable, unclaimed food — and among equals, the nearest.
 *
 * Quality outranks distance, or a colony would cook diligently and then eat berries
 * because the berries were closer, and the whole point of a kitchen would be invisible.
 * Ranked by what the food does to mood, so the ordering is item data rather than a list
 * of names this function has to keep up with.
 */
function findFood(world: World, pawn: Pawn): Item | null {
  let best: Item | null = null;
  let bestQuality = -Infinity;
  let bestDistance = Infinity;

  for (const item of world.items.values()) {
    if (!isOnGround(item) || !item.pos) continue;
    const food = itemDef(item.def).food;
    if (!food) continue;
    if (!world.reservations.canReserveEntity(item.id, pawn.id)) continue;

    const quality = thoughtDef(food.thought).mood;
    if (quality < bestQuality) continue;

    const distance = Math.abs(item.pos.x - pawn.pos.x) + Math.abs(item.pos.y - pawn.pos.y);
    if (quality === bestQuality && distance >= bestDistance) continue;
    if (!world.reachability.canReach(pawn.pos, item.pos)) continue;

    bestQuality = quality;
    bestDistance = distance;
    best = item;
  }

  return best;
}

/** Where a colonist lies on this bed — its facing end. */
function bedHeadCell(bed: Building): TilePos {
  return headCellOf(bed.pos, footprintOfBuilding(bed.def), bed.rotation);
}

/** Nearest reachable bed nobody else has claimed or owns. */
function findBed(world: World, pawn: Pawn): Building | null {
  let best: Building | null = null;
  let bestDistance = Infinity;

  for (const building of world.buildings.values()) {
    if (!isBed(building)) continue;
    if (building.owner !== null && building.owner !== pawn.id) continue;
    if (!world.reservations.canReserveEntity(building.id, pawn.id)) continue;

    const distance =
      Math.abs(building.pos.x - pawn.pos.x) + Math.abs(building.pos.y - pawn.pos.y);
    if (distance >= bestDistance) continue;
    if (!world.reachability.canReach(pawn.pos, building.pos)) continue;

    bestDistance = distance;
    best = building;
  }

  return best;
}

/**
 * The job this colonist needs to do before any work, or null.
 *
 * Hunger is checked before rest: a starving colonist who lies down to sleep dies in
 * their bed, which is both bad play and a bad story.
 */
export function findNeedJob(world: World, pawn: Pawn): Job | null {
  if (pawn.needs[Need.Hunger] < needDef(Need.Hunger).seekBelow) {
    const food = findFood(world, pawn);
    if (food) return { kind: 'eat', item: food.id };
    // No food anywhere: fall through and let them keep working. Standing still and
    // starving helps nobody, and the alert will tell the player what's wrong.
  }

  const rest = pawn.needs[Need.Rest];
  const hour = Math.floor(((world.tick % 60000) / 2500) % 24);
  const wantsSleep = rest < needDef(Need.Rest).seekBelow || (isNight(hour) && rest < NIGHT_REST_THRESHOLD);

  if (wantsSleep) {
    const bed = findBed(world, pawn);
    return {
      kind: 'sleep',
      bed: bed ? bed.id : null,
      // The head end, not the anchor: on a 2x1 bed those differ for two of the four
      // rotations, and lying at the foot is the sort of thing nobody notices until the
      // sleeping pose lands on top of it.
      // Sleeping rough is worse than a bed, but far better than not sleeping.
      spot: bed ? bedHeadCell(bed) : ({ ...pawn.pos } as TilePos),
    };
  }

  return null;
}

/** How full a colonist eats to before stopping. */
const EAT_UNTIL = 0.95;

/**
 * Eats a meal, not a mouthful.
 *
 * Consuming a single unit per job looked fine in tests and was obviously wrong the
 * moment it was watched: one berry restores 14%, so a colonist crossing the 35%
 * threshold ate once, rose to 49%, and was hungry again shortly after — an endless
 * shuttle between the stockpile and whatever they were meant to be doing. Eating until
 * satisfied turns that into one trip.
 */
export function consumeFood(world: World, pawn: Pawn, item: Item): void {
  const food = itemDef(item.def).food;
  if (!food) return;

  let eaten = 0;
  while (pawn.needs[Need.Hunger] < EAT_UNTIL && item.count > 0) {
    pawn.needs[Need.Hunger] = Math.min(1, pawn.needs[Need.Hunger] + food.nutrition);
    item.count -= 1;
    eaten++;
  }

  if (item.count <= 0) world.items.remove(item.id, world.map);
  // The memory belongs to whatever was actually eaten, so adding a food never means
  // remembering to add a branch here.
  if (eaten > 0) addThought(pawn, food.thought);
}

/** Needs that are low enough for the player to be told about. */
export function warningNeeds(pawn: Pawn): EntityId[] {
  const low: number[] = [];
  for (const def of NEED_DEFS) {
    if (pawn.needs[def.id] < def.warnBelow) low.push(def.id);
  }
  return low;
}

export const GROUND_SLEEP_LEVEL = GROUND_LEVEL;
