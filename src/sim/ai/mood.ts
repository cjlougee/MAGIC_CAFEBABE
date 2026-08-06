/**
 * Mood, and why.
 *
 * Mood is never assigned. It is always recomputed as `base + the sum of stated
 * reasons`, so the inspector can answer "why is Ash miserable?" with a list instead of
 * a number. Any change that can't be expressed as a thought doesn't belong here — that
 * rule is what keeps the system legible as it grows.
 */

import { Need } from '../defs/needs';
import {
  BASE_MOOD,
  BREAK_CHANCE_PER_THINK,
  BREAK_DURATION_TICKS,
  BREAK_THRESHOLD,
  Thought,
  thoughtDef,
  type ThoughtId,
} from '../defs/thoughts';
import type { Pawn } from '../entities/pawn';
import type { World } from '../world/world';

/** Hunger below this reads as "hungry"; at zero it becomes "starving". */
const HUNGRY_BELOW = 0.28;
const EXHAUSTED_BELOW = 0.16;

/**
 * Situational thoughts, derived fresh from current state.
 *
 * Not stored, because they must vanish the instant the condition does — a colonist who
 * has just eaten should stop being unhappy about hunger on the same tick.
 */
export function situationalThoughts(pawn: Pawn): ThoughtId[] {
  const active: ThoughtId[] = [];

  if (pawn.needs[Need.Hunger] <= 0) active.push(Thought.Starving);
  else if (pawn.needs[Need.Hunger] < HUNGRY_BELOW) active.push(Thought.Hungry);

  if (pawn.needs[Need.Rest] < EXHAUSTED_BELOW) active.push(Thought.Exhausted);

  return active;
}

/** Every reason this colonist feels how they do, memories and situation together. */
export function activeThoughts(pawn: Pawn): ThoughtId[] {
  return [...pawn.memories.map((memory) => memory.def), ...situationalThoughts(pawn)];
}

export function moodOf(pawn: Pawn): number {
  let mood = BASE_MOOD;
  for (const id of activeThoughts(pawn)) mood += thoughtDef(id).mood;
  return Math.max(0, Math.min(1, mood));
}

/**
 * Records a memory.
 *
 * Repeating a thought refreshes it rather than stacking, so eating four times in a row
 * doesn't quadruple the penalty. Stack limits per thought can come later if any thought
 * ever wants them.
 */
export function addThought(pawn: Pawn, id: ThoughtId): void {
  if (thoughtDef(id).situational) return;

  const existing = pawn.memories.find((memory) => memory.def === id);
  if (existing) {
    existing.age = 0;
    return;
  }
  pawn.memories.push({ def: id, age: 0 });
}

/** Ages memories and drops the ones that have faded. */
export function tickMood(pawn: Pawn): void {
  if (pawn.memories.length === 0) return;

  let write = 0;
  for (let read = 0; read < pawn.memories.length; read++) {
    const memory = pawn.memories[read];
    memory.age++;
    if (memory.age < thoughtDef(memory.def).durationTicks) {
      pawn.memories[write++] = memory;
    }
  }
  pawn.memories.length = write;
}

/**
 * Decides whether a miserable colonist stops coping.
 *
 * Rolled on think ticks rather than every tick, and probabilistic rather than a hard
 * threshold — a colonist who dips under the line for a moment shouldn't reliably snap,
 * and two identical bad days shouldn't produce identical stories.
 *
 * Draws from the world RNG, so it stays deterministic.
 */
export function maybeBreak(world: World, pawn: Pawn): boolean {
  if (pawn.breakTicks > 0 || pawn.dead) return false;
  if (moodOf(pawn) >= BREAK_THRESHOLD) return false;
  if (!world.rng.chance(BREAK_CHANCE_PER_THINK)) return false;

  pawn.breakTicks = BREAK_DURATION_TICKS;
  return true;
}

export function tickBreak(pawn: Pawn): void {
  if (pawn.breakTicks > 0) pawn.breakTicks--;
}
