/**
 * The job scheduler: choosing work, running it, and ending it cleanly.
 *
 * **This file owns enforcement rule 3.** `interrupt()` must end the current job,
 * release every reservation it held, and hand the pawn back — from any state, at any
 * point in any toil. Combat lands in Slice 3 and squad command in Slice 5, and both are
 * built on exactly this: a direct order that cleanly supersedes autonomous work.
 *
 * `endJob()` is the single exit. Completion, failure, and preemption all route through
 * it, so cleanup cannot be forgotten on one path and remembered on another — which is
 * how reservations leak and targets become permanently untouchable.
 */

import type { Pawn } from '../entities/pawn';
import { clearPath } from '../entities/pawn';
import { PRIORITY_DISABLED, PRIORITY_HIGHEST, PRIORITY_LOWEST } from '../defs/workTypes';
import type { World } from '../world/world';
import { createActiveJob, type Job, type JobOutcome } from './job';
import { driverFor } from './jobDrivers';
import { WORK_GIVERS } from './workGivers';

/**
 * Ticks between a pawn's attempts to find work.
 *
 * Scanning every pawn every tick would run the giver sweep 60 times a second per
 * colonist for no benefit — work does not appear that fast. Staggering by id spreads
 * the cost so no single tick pays for the whole colony, which is what keeps frame times
 * flat as the colony grows.
 */
export const THINK_INTERVAL = 30;

export function isThinkTick(world: World, pawn: Pawn): boolean {
  return world.tick % THINK_INTERVAL === pawn.id % THINK_INTERVAL;
}

/**
 * Picks the best available job.
 *
 * Priority bands are walked most-urgent first, and within a band the givers are tried
 * in declaration order. A pawn with Mine=1 and Haul=3 exhausts every mining job before
 * considering a haul, which is the behaviour the grid promises the player.
 */
export function findJob(world: World, pawn: Pawn): Job | null {
  for (let priority = PRIORITY_HIGHEST; priority <= PRIORITY_LOWEST; priority++) {
    for (const giver of WORK_GIVERS) {
      const assigned = pawn.priorities[giver.workType] ?? PRIORITY_DISABLED;
      if (assigned !== priority) continue;

      const job = giver.tryGiveJob(world, pawn);
      if (job) return job;
    }
  }
  return null;
}

export function startJob(pawn: Pawn, job: Job): void {
  // A new job never inherits the previous one's route.
  clearPath(pawn);
  pawn.job = createActiveJob(job);
}

/**
 * Ends the current job and returns the pawn to the idle pool.
 *
 * Releases reservations first, then puts down anything being carried. Dropping matters:
 * a pawn interrupted mid-haul is holding real items, and silently discarding them would
 * quietly leak resources out of the economy every time the player gave an order.
 */
export function endJob(world: World, pawn: Pawn, _outcome: JobOutcome): void {
  world.reservations.releaseAll(pawn.id);

  if (pawn.carryingItemId !== null) {
    const item = world.items.get(pawn.carryingItemId);
    if (item) world.items.placeAt(item, world.map, pawn.pos);
    pawn.carryingItemId = null;
  }

  pawn.job = null;
  clearPath(pawn);
}

/**
 * Hard preemption — enforcement rule 3.
 *
 * Safe to call on an idle pawn, and safe to call from the middle of any toil. The
 * `reason` is unused today but kept in the signature because combat will want to know
 * whether a pawn was drafted, downed, or fleeing.
 */
export function interrupt(world: World, pawn: Pawn, _reason: string): void {
  if (pawn.job) {
    endJob(world, pawn, 'interrupted');
    return;
  }
  clearPath(pawn);
}

/** Advances the pawn's current job by one toil tick. */
export function tickJob(world: World, pawn: Pawn): void {
  const active = pawn.job;
  if (!active) return;

  const toils = driverFor(active.job.kind);
  const toil = toils[active.toilIndex];
  if (!toil) {
    endJob(world, pawn, 'completed');
    return;
  }

  const result = toil.tick({ world, pawn, job: active.job, active });
  active.ticksInToil++;

  if (result === 'failed') {
    endJob(world, pawn, 'failed');
    return;
  }

  if (result === 'done') {
    active.toilIndex++;
    active.ticksInToil = 0;
    active.workDone = 0;
    active.attempts = 0;
    if (active.toilIndex >= toils.length) endJob(world, pawn, 'completed');
  }
}

/** Finds work for an idle pawn. Called only on that pawn's think tick. */
export function tickPawnAI(world: World, pawn: Pawn): void {
  if (pawn.job) return;
  const job = findJob(world, pawn);
  if (job) startJob(pawn, job);
}
