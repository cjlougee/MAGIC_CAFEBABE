/**
 * Scenarios — a game state described in code, so it can be looked at in two calls.
 *
 * Verifying one rendering fix recently cost about twenty tool calls, six of them spent
 * persuading colonists to prefer a bed over a bedroll. None of that was under test. It
 * was the price of *reaching* a state in which the thing under test was on screen, paid
 * again every time anyone wanted to look. A scenario is that setup written down once.
 *
 * **The rule the whole harness stands on: a scenario forces outcomes through the game's
 * own mutators, and skips only the AI that would have chosen them.** Skipping the
 * decision is the point — whether a colonist wants that bed, whether they walk there,
 * whether it is late enough. Skipping the *state transition* is forbidden. A scenario
 * that reached its state by a route the game cannot take would show a picture of
 * something that cannot happen, and we would trust it. That is not hypothetical: a review
 * surface that computed placement its own way disagreed with the real renderer and
 * shipped a bug.
 *
 * In practice: structures go in through the `build` command with `instant`, never by
 * stamping tile grids; a colonist sleeps via `fallAsleep`, never by assigning
 * `pawn.asleep`. See `builder.ts`, which is where every verb answers for itself.
 */

import type { ScenarioBuilder } from './builder';
import { beds } from './beds';
import { rooms } from './rooms';

/**
 * Where to point the camera once the world is built.
 *
 * Two forms, because scenarios want two different things. `fit: 'contents'` frames
 * whatever the scenario placed and is what nearly all of them want — the alternative is
 * a scenario stating its coordinates twice and the second copy going stale. `at` is for
 * the case where the interesting part is *not* what was placed: a view down a corridor,
 * or ground deliberately left empty.
 */
export type Frame =
  | { readonly fit: 'contents'; readonly zoom?: number; readonly pad?: number }
  | { readonly at: { readonly x: number; readonly y: number }; readonly zoom: number };

export interface Scenario {
  /** Kebab-case, and the handle everything else refers to it by. */
  readonly name: string;
  /** What this is a picture *of*, in one line. Read by whoever finds the image later. */
  readonly about: string;
  readonly build: (s: ScenarioBuilder) => void;
  /** Omitted means the caller frames it however it likes. */
  readonly frame?: Frame;
}

/**
 * Every scenario, by name.
 *
 * A Map rather than an object literal because it can refuse a duplicate. Two scenarios
 * sharing a name would leave one of them permanently unreachable, and the failure would
 * look like "my change did nothing" rather than like a collision.
 */
export const SCENARIOS: ReadonlyMap<string, Scenario> = register([...beds, ...rooms]);

export function scenarioNames(): string[] {
  return [...SCENARIOS.keys()];
}

function register(scenarios: readonly Scenario[]): Map<string, Scenario> {
  const byName = new Map<string, Scenario>();
  for (const scenario of scenarios) {
    if (byName.has(scenario.name)) {
      throw new Error(`two scenarios are called "${scenario.name}"`);
    }
    byName.set(scenario.name, scenario);
  }
  return byName;
}

export { buildScenario, runScenario, type ScenarioBuilder } from './builder';
export { HOURS, SCENARIO_SEED, type HourName } from './fixtures';
