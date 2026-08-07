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
import type { RecipeId } from '../defs/recipes';

export type JobKind =
  | 'mine'
  | 'haul'
  | 'harvest'
  | 'eat'
  | 'sleep'
  | 'wander'
  | 'deliver'
  | 'construct'
  | 'deconstruct'
  | 'stockBench'
  | 'craft';

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

/**
 * Carrying materials to a blueprint. This is **Haul** work, not Construct — the player
 * schedules "who carries things", and delivering to a site is carrying things.
 */
export interface DeliverJob {
  readonly kind: 'deliver';
  readonly site: EntityId;
  readonly item: EntityId;
}

export interface ConstructJob {
  readonly kind: 'construct';
  readonly site: EntityId;
}

/**
 * Taking a finished structure back down.
 *
 * Addressed by **cell**, not by building id, because the same job removes a wall (an
 * entity) or a floor (terrain), and only the cell describes both. The driver looks up
 * what is actually there each tick, so the job cannot go stale against the world.
 */
export interface DeconstructJob {
  readonly kind: 'deconstruct';
  readonly cell: TilePos;
}

/**
 * Fetching one ingredient stack to a workbench.
 *
 * The same shape as `deliver`, and pointedly *not* the same work type. Delivering to a
 * blueprint is Haul because the plan is public; stocking a bench is Cook because the
 * bill is the kitchen's own business. See docs/design/07-production.md.
 */
export interface StockBenchJob {
  readonly kind: 'stockBench';
  readonly bench: EntityId;
  readonly item: EntityId;
}

/** Working a bench that already has everything one of its bills needs. */
export interface CraftJob {
  readonly kind: 'craft';
  readonly bench: EntityId;
  readonly recipe: RecipeId;
}

export type Job =
  | MineJob
  | HaulJob
  | HarvestJob
  | EatJob
  | SleepJob
  | WanderJob
  | DeliverJob
  | ConstructJob
  | DeconstructJob
  | StockBenchJob
  | CraftJob;

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
