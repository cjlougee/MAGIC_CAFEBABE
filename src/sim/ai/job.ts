/**
 * A job is **data**, not behaviour.
 *
 * That split is the whole design. A Job says *what* should happen ("mine this cell");
 * a JobDriver is a list of toils saying *how*; the pawn carries only an index into that
 * list. Because the job is plain data and the toils are looked up by kind, saving a
 * mid-job pawn means saving three numbers — no closures, no reconstructing a call
 * stack.
 */

import type { EntityId } from '../core/entityStore';
import type { TilePos } from '../core/position';

export type JobKind = 'mine' | 'haul' | 'harvest' | 'eat' | 'sleep' | 'wander';

export interface MineJob {
  readonly kind: 'mine';
  readonly cell: TilePos;
}

export interface HaulJob {
  readonly kind: 'haul';
  readonly item: EntityId;
  readonly to: TilePos;
}

export interface HarvestJob {
  readonly kind: 'harvest';
  readonly plant: EntityId;
}

/** A need job. Never enters the priority grid and cannot be switched off. */
export interface EatJob {
  readonly kind: 'eat';
  readonly item: EntityId;
}

/** `bed` is null when sleeping rough — which costs mood, but beats not sleeping. */
export interface SleepJob {
  readonly kind: 'sleep';
  readonly bed: EntityId | null;
  readonly spot: TilePos;
}

/** What a colonist does instead of coping. */
export interface WanderJob {
  readonly kind: 'wander';
  readonly to: TilePos;
}

export type Job = MineJob | HaulJob | HarvestJob | EatJob | SleepJob | WanderJob;

export interface ActiveJob {
  readonly job: Job;
  /** Index into the driver's toil list. */
  toilIndex: number;
  ticksInToil: number;
  /** Work accumulated by the current work toil. */
  workDone: number;
  /**
   * Failed path attempts in the current toil.
   *
   * A route can be planned successfully and then invalidated before the pawn arrives —
   * a wall goes up, a bridge comes down. Without a ceiling, the pawn re-plans, fails,
   * re-plans forever and the job never ends.
   */
  attempts: number;
}

export function createActiveJob(job: Job): ActiveJob {
  return { job, toilIndex: 0, ticksInToil: 0, workDone: 0, attempts: 0 };
}

export type JobOutcome = 'completed' | 'failed' | 'interrupted';
