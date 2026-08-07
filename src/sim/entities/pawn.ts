/**
 * A colonist.
 *
 * Movement model follows RimWorld's: `pos` is the tile the pawn *occupies* and is
 * authoritative for everything else in the simulation (reservations, job targets, line
 * of sight). Sliding between tiles is tracked separately as a tick countdown into
 * `moveTarget`. Keeping occupancy discrete is what lets other systems ask "who is on
 * this cell" without ever dealing with fractions.
 *
 * Appearance is stored as **indices, not colours**. sim/ must not know what a pawn
 * looks like; render/ maps these onto the palette. That keeps character identity in
 * saved state while leaving art direction entirely to the renderer.
 */

import type { ActiveJob } from '../ai/job';
import type { EntityId } from '../core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../core/position';
import { startingNeeds } from '../defs/needs';
import type { ThoughtId } from '../defs/thoughts';
import { defaultPriorities } from '../defs/workTypes';

/** Ticks per unit of move cost, as hundredths. 130 puts open ground at 13 ticks/tile. */
const MOVE_TICKS_PER_COST = 130;

export interface PawnAppearance {
  readonly skinTone: number;
  readonly hairStyle: number;
  readonly hairColour: number;
  readonly apparelColour: number;
}

export interface Pawn {
  readonly id: EntityId;
  readonly name: string;
  readonly appearance: PawnAppearance;

  /** The tile this pawn occupies. Discrete, always. */
  pos: TilePos;

  /** Adjacent tile being moved into, or null when standing still. */
  moveTarget: TilePos | null;
  moveTicksTotal: number;
  moveTicksElapsed: number;

  /** Remaining route, excluding the current tile. Empty when idle. */
  path: TilePos[];
  pathIndex: number;

  /** What this colonist is doing, or null when idle. */
  job: ActiveJob | null;
  /** The single stack being carried. Pawns have one pair of hands. */
  carryingItemId: EntityId | null;
  /**
   * Work-type priority, indexed by WorkTypeId. 0 disables; 1 is most urgent.
   *
   * Per-pawn rather than global, because "who does what" is the main lever the player
   * has over an autonomous colony.
   */
  priorities: number[];

  /** Indexed by NeedId. 1 is satisfied, 0 is desperate. */
  needs: number[];
  /** Fading reasons this colonist feels how they do. Situational thoughts aren't stored. */
  memories: Memory[];
  /** 1 is unhurt, 0 is dead. Starvation is the only thing that touches it so far. */
  health: number;
  dead: boolean;
  /** Ticks remaining in a mental break. Zero means coping. */
  breakTicks: number;
  /** True while asleep, so needs and rendering can treat them differently. */
  asleep: boolean;
}

export interface Memory {
  readonly def: ThoughtId;
  /** Ticks since it happened. Compared against the thought's duration. */
  age: number;
}

export function createPawn(
  id: EntityId,
  name: string,
  pos: TilePos,
  appearance: PawnAppearance,
): Pawn {
  return {
    id,
    name,
    appearance,
    pos,
    moveTarget: null,
    moveTicksTotal: 0,
    moveTicksElapsed: 0,
    path: [],
    pathIndex: 0,
    job: null,
    carryingItemId: null,
    priorities: defaultPriorities(),
    needs: startingNeeds(),
    memories: [],
    health: 1,
    dead: false,
    breakTicks: 0,
    asleep: false,
  };
}

export function ticksToEnter(moveCost: number): number {
  return Math.max(1, ((moveCost * MOVE_TICKS_PER_COST) / 100) | 0);
}

export function isMoving(pawn: Pawn): boolean {
  return pawn.moveTarget !== null || pawn.pathIndex < pawn.path.length;
}

const ACTIVITY_LABELS: Record<string, string> = {
  mine: 'mining',
  haul: 'hauling',
  harvest: 'harvesting',
  eat: 'eating',
  sleep: 'sleeping',
  wander: 'wandering',
  deliver: 'hauling materials',
  construct: 'building',
  deconstruct: 'deconstructing',
};

/** Short label for the UI. Not for logic — nothing should branch on a display string. */
export function pawnActivity(pawn: Pawn): string {
  if (pawn.dead) return 'dead';
  if (pawn.asleep) return 'asleep';
  if (pawn.breakTicks > 0) return 'breaking down';
  if (pawn.job) return ACTIVITY_LABELS[pawn.job.job.kind] ?? pawn.job.job.kind;
  return isMoving(pawn) ? 'walking' : 'idle';
}

/** Abandons the current route. Does not interrupt the step already in progress. */
export function clearPath(pawn: Pawn): void {
  pawn.path = [];
  pawn.pathIndex = 0;
}

/**
 * Fractional position for drawing, interpolated across the step in progress.
 *
 * Lives here rather than in render/ because it is derived from simulation state and
 * must stay consistent with it — but nothing in sim/ reads it.
 */
export function pawnVisualPos(pawn: Pawn): { x: number; y: number; z: number } {
  const target = pawn.moveTarget;
  if (!target || pawn.moveTicksTotal <= 0) {
    return { x: pawn.pos.x, y: pawn.pos.y, z: pawn.pos.z ?? GROUND_LEVEL };
  }

  const t = pawn.moveTicksElapsed / pawn.moveTicksTotal;
  return {
    x: pawn.pos.x + (target.x - pawn.pos.x) * t,
    y: pawn.pos.y + (target.y - pawn.pos.y) * t,
    z: pawn.pos.z ?? GROUND_LEVEL,
  };
}
