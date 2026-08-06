/**
 * Thoughts — why a colonist feels the way they do.
 *
 * Mood is never a number the simulation sets directly. It is always the *sum of stated
 * reasons*, which is what lets the UI answer "why is Ash miserable?" with a list rather
 * than a shrug. Every mood change must come from a thought, or the system stops being
 * legible and starts being a mystery.
 *
 * Two kinds:
 *
 *  - **Situational** — recomputed every tick from current state. "I am hungry *now*."
 *    They vanish the moment the condition does.
 *  - **Memory** — stored on the pawn with an age, and decay away. "I slept on the ground
 *    last night." These are what give a bad day consequences that outlast it.
 */

import { TICKS_PER_HOUR } from '../core/constants';

export const Thought = {
  // Memories.
  AteRawFood: 0,
  SleptInBed: 1,
  SleptOnGround: 2,
  // Situational.
  Hungry: 3,
  Starving: 4,
  Exhausted: 5,
} as const;

export type ThoughtId = (typeof Thought)[keyof typeof Thought];

export interface ThoughtDef {
  readonly id: ThoughtId;
  readonly label: string;
  /** Mood offset, on the same 0–1 scale as mood itself. */
  readonly mood: number;
  /** Ticks before a memory fades. Zero for situational thoughts. */
  readonly durationTicks: number;
  readonly situational: boolean;
}

const hours = (n: number) => TICKS_PER_HOUR * n;

/** Indexed by ThoughtId — array position must equal `id`. */
export const THOUGHT_DEFS: readonly ThoughtDef[] = [
  {
    id: Thought.AteRawFood,
    label: 'Ate raw food',
    // Small but persistent: the nudge that makes cooking worth building in Slice 2.
    mood: -0.05,
    durationTicks: hours(6),
    situational: false,
  },
  {
    id: Thought.SleptInBed,
    label: 'Slept in a bed',
    mood: +0.04,
    durationTicks: hours(10),
    situational: false,
  },
  {
    id: Thought.SleptOnGround,
    label: 'Slept on the ground',
    mood: -0.07,
    durationTicks: hours(10),
    situational: false,
  },
  { id: Thought.Hungry, label: 'Hungry', mood: -0.1, durationTicks: 0, situational: true },
  { id: Thought.Starving, label: 'Starving', mood: -0.28, durationTicks: 0, situational: true },
  { id: Thought.Exhausted, label: 'Exhausted', mood: -0.12, durationTicks: 0, situational: true },
];

export function thoughtDef(id: ThoughtId): ThoughtDef {
  return THOUGHT_DEFS[id];
}

/** Mood with nothing good or bad going on. */
export const BASE_MOOD = 0.55;

/** Below this, a colonist may stop coping. */
export const BREAK_THRESHOLD = 0.2;

/** How long a mental break lasts once it starts. */
export const BREAK_DURATION_TICKS = hours(3);

/**
 * Chance per think tick of breaking while below the threshold.
 *
 * Deliberately not a hard trigger: a colonist who dips under the line for a moment
 * shouldn't reliably snap, and the randomness means two identical bad days don't
 * produce identical stories.
 */
export const BREAK_CHANCE_PER_THINK = 0.04;
