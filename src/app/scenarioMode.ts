/**
 * The scenario harness, from the outside.
 *
 * Two calls replace about twenty:
 *
 *   await __scenario.capture('beds-all-rotations')   // load, draw, read back, write
 *   Read art/scenes/beds-all-rotations.png
 *
 * `capture()` with no name grabs whatever is already on screen, which is what makes
 * handing setup to a human cheap: they arrange something fiddly by hand — the kind of
 * thing that is four clicks for a person and twenty tool calls for anything else — and
 * the still costs one call.
 *
 * **The tab does not need to be visible.** Verified with `document.hidden` true and the
 * pane showing an entirely different tab. That is the whole point: a screenshot needs a
 * composited window and this does not.
 *
 * Dev builds only. Imported dynamically behind `import.meta.env.DEV`, so none of this and
 * none of `src/scenarios/` reaches a production bundle.
 */

import type { Engine } from './engine';
import { scenarioNames, SCENARIOS } from '../scenarios';

/**
 * The size every named scenario is rendered at, whatever the window is doing.
 *
 * A scenario's picture should be a function of the scenario. Left to follow the pane it
 * framed the same four beds differently at 966×1030 and at 1280×720, clipping one off the
 * bottom in one of them — so the answer changed with the furniture.
 *
 * 16:9 because an isometric scene is a wide, shallow diamond and that is the shape which
 * wastes least around one.
 */
const CAPTURE_FRAME = { width: 1280, height: 720 } as const;

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
      /*
       * The grab is **synchronous** and the write is not, and that split is load-bearing.
       *
       * `withFixedSize` restores the real size in a `finally`, so anything awaited inside
       * it would resume after the restore and read back a frame at the window's size —
       * which is the bug this whole change exists to remove, reintroduced one layer down.
       */
      const canvas = name
        ? engine.renderer.withFixedSize(CAPTURE_FRAME.width, CAPTURE_FRAME.height, () => {
            // Inside, because `fit: 'contents'` computes its zoom from the view size.
            engine.loadScenario(name);
            return grabFrame(engine);
          })
        : // No name means "photograph what I am looking at", and resizing the window under
          // someone who has just arranged something by hand would photograph something else.
          grabFrame(engine);

      return writeFrame(canvas, name ?? 'current');
    },
  };

  (globalThis as unknown as { __scenario: ScenarioApi }).__scenario = api;
}

/** Draws one frame and reads it back. Synchronous, so it can run pinned to a size. */
function grabFrame(engine: Engine): HTMLCanvasElement {
  const { application } = engine.renderer;

  /*
   * **The game's own draw, not Pixi's.**
   *
   * `requestAnimationFrame` is throttled to nothing in a backgrounded tab — exactly the
   * case this harness exists to survive, since a screenshot already fails there. So the
   * game loop stops, and with it the pass that repopulates the layers from the world.
   *
   * The first version called `renderer.render(stage)` and thought that enough. It is not:
   * that rasterizes whatever the stage already holds, and after a world swap with no loop
   * running the stage holds nothing. Measured — 1280×720 of flat background, reported as a
   * success. `drawNow()` runs the loop's own path, so the layers are rebuilt first.
   */
  engine.drawNow();

  /*
   * Pixi's `extract`, **not** `canvas.toBlob` on the live canvas.
   *
   * `toBlob` reads the compositor's copy of a WebGL canvas, and a hidden tab composites
   * nothing, so it hands back a blank rectangle and says nothing is wrong. `extract`
   * renders into a texture we own and reads it back with `readPixels`, which needs no
   * compositor. It costs one extra render and buys the thing this was built for.
   */
  const canvas = application.renderer.extract.canvas({
    target: application.stage,
    /*
     * **The frame is stated, not inferred** — the rule `ArtProvider` states for every
     * sprite, and it bites here for the same reason. Left to infer, `extract` takes the
     * stage's own bounds, and a backgrounded tab collapses those to nothing: measured, it
     * returned a 1×1 canvas and called it a capture.
     */
    frame: application.screen,
    /*
     * One device pixel per world pixel, so a retina screen and a plain one produce the
     * same file. Reproducibility is the point of pinning the size; letting DPI back in
     * through the side door would undo it.
     */
    resolution: 1,
  }) as HTMLCanvasElement;

  assertNotBlank(canvas);
  return canvas;
}

async function writeFrame(canvas: HTMLCanvasElement, name: string): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('extract produced no image');

  const response = await fetch(`/__capture?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`capture endpoint refused it: ${response.status} ${await response.text()}`);
  }
  return response.text();
}

/**
 * Refuses to write a picture of nothing.
 *
 * The first version silently produced a blank rectangle whenever the tab was not the front
 * one, and reported success — so the honest failure was a black PNG indistinguishable from
 * a scenario that built an empty world. A harness that fails loudly is worth more than one
 * that is usually right, because the quiet failure costs a debugging session aimed at the
 * wrong thing.
 *
 * Sampled on a grid rather than pixel by pixel: this runs on every capture and a frame is
 * a million pixels. Any real scene varies across a hundred samples; a cleared buffer cannot.
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
