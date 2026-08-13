/**
 * The scenario harness, from the outside.
 *
 * Two calls replace about twenty:
 *
 *   await __scenario.capture('beds-all-rotations')   // load, draw, read, write
 *   Read art/scenes/beds-all-rotations.png
 *
 * `capture()` with no name grabs whatever is already on screen, which is what makes
 * handing setup to a human cheap: they arrange something fiddly by hand — the kind of
 * thing that is four clicks for a person and twenty tool calls for anything else — and
 * the still costs one call.
 *
 * Dev builds only. Imported dynamically behind `import.meta.env.DEV`, so none of this and
 * none of `src/scenarios/` reaches a production bundle.
 */

import type { Engine } from './engine';
import { scenarioNames, SCENARIOS } from '../scenarios';

export interface ScenarioApi {
  /** Every scenario, with the question each one exists to answer. */
  list(): { name: string; about: string }[];
  load(name: string): void;
  /** Loads if named, captures either way. Returns the path written. */
  capture(name?: string): Promise<string>;
}

export function installScenarioApi(engine: Engine): void {
  const api: ScenarioApi = {
    list: () =>
      scenarioNames().map((name) => ({ name, about: SCENARIOS.get(name)?.about ?? '' })),

    load: (name) => engine.loadScenario(name),

    capture: async (name) => {
      if (name) engine.loadScenario(name);

      const { application } = engine.renderer;

      /*
       * Rendered synchronously, not waited for.
       *
       * `requestAnimationFrame` is throttled or suspended outright in a hidden tab — which
       * is exactly the case this harness exists to survive, since a screenshot already
       * fails there. Waiting on a frame would hang the capture precisely when it is needed
       * most. Driving the renderer directly makes the wait unnecessary; the timeout race
       * below is belt and braces for whatever else might own the loop.
       */
      application.renderer.render(application.stage);
      await Promise.race([
        new Promise((resolve) => requestAnimationFrame(resolve)),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);

      /*
       * The DOM canvas, measured rather than assumed: 18,703 bytes at 966×1030 with opaque
       * centre pixels, so this drawing buffer survives present. Pixi's `extract` would also
       * work by re-rendering into a render texture, and there is no reason to pay for it.
       */
      const canvas = application.canvas as HTMLCanvasElement;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('canvas.toBlob produced no image');

      const file = name ?? 'current';
      const response = await fetch(`/__capture?name=${encodeURIComponent(file)}`, {
        method: 'POST',
        body: blob,
      });
      if (!response.ok) {
        throw new Error(`capture endpoint refused it: ${response.status} ${await response.text()}`);
      }
      return response.text();
    },
  };

  (globalThis as unknown as { __scenario: ScenarioApi }).__scenario = api;
}
