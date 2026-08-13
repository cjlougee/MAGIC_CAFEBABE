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
       * **The game's own draw, not Pixi's.**
       *
       * `requestAnimationFrame` is throttled to nothing in a backgrounded tab — which is
       * exactly the case this harness exists to survive, since a screenshot already fails
       * there. So the game loop stops, and with it the pass that repopulates the layers
       * from the world.
       *
       * The first version called `renderer.render(stage)` here and thought that enough. It
       * is not: that rasterizes whatever the stage already holds, and after a world swap
       * with no loop running the stage holds nothing. Measured — it produced 1280×720 of
       * flat background and reported success. `drawNow()` runs the same path the loop runs,
       * so the layers are rebuilt from the world before anything is read back.
       */
      engine.drawNow();

      /*
       * Pixi's `extract`, **not** `canvas.toBlob` on the live canvas.
       *
       * `toBlob` reads the compositor's copy of a WebGL canvas, so a hidden tab — which
       * composites nothing — hands back a blank rectangle. Measured: with the tab merely
       * behind another one, `toBlob` produced 1280×720 of pure background and the capture
       * reported success. That is the worst possible failure for this harness, because the
       * whole point is to work when a screenshot cannot, and a blank picture is
       * indistinguishable from a scenario that built nothing.
       *
       * `extract` renders into a texture we own and reads it back with `readPixels`, which
       * needs no compositor. It costs one extra render and buys the thing this was for.
       */
      const canvas = application.renderer.extract.canvas({
        target: application.stage,
        /*
         * **The frame is stated, not inferred** — the same rule `ArtProvider` states for
         * every sprite, and it bites here for the same reason. Left to infer, `extract`
         * takes the stage's own bounds, and a backgrounded tab collapses those to nothing:
         * measured, it handed back a 1×1 canvas and called it a capture.
         */
        frame: application.screen,
      }) as HTMLCanvasElement;

      assertNotBlank(canvas);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('extract produced no image');

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

/**
 * Refuses to write a picture of nothing.
 *
 * The first version of this capture silently produced a blank rectangle whenever the tab
 * was not the front one, and reported success — so the honest failure was a black PNG that
 * looks exactly like a scenario which built an empty world. A harness that fails loudly is
 * worth more than one that is usually right, because the quiet failure costs a debugging
 * session aimed at the wrong thing.
 *
 * Sampled on a grid rather than pixel by pixel: a 1280×720 frame is a million pixels and
 * this runs on every capture. Any real scene varies across a hundred samples; a cleared
 * buffer cannot.
 */
function assertNotBlank(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  const { width, height } = canvas;
  const samples = 10;
  const seen = new Set<number>();

  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = Math.floor(((sx + 0.5) / samples) * width);
      const y = Math.floor(((sy + 0.5) / samples) * height);
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      seen.add((r << 24) | (g << 16) | (b << 8) | a);
    }
  }

  if (seen.size <= 1) {
    throw new Error(
      `capture produced ${width}x${height} of a single flat colour — the renderer drew ` +
        `nothing. If this tab is in the background, the extract path has regressed to ` +
        `reading the compositor instead of a framebuffer.`,
    );
  }
}
