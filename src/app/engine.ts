/**
 * Wires the three halves of the program together: simulation, renderer, loop.
 *
 * This is the only place they meet. React knows about Engine; it knows nothing about
 * Pixi or World.
 */

import { GameRenderer } from '../render/gameRenderer';
import { Simulation } from '../sim/simulation';
import { GameLoop, type GameSpeed } from './gameLoop';
import type { UiStore } from './uiStore';

/** How often UI state is republished. 10Hz is imperceptible for a clock readout. */
const SNAPSHOT_INTERVAL_MS = 100;

export class Engine {
  readonly loop: GameLoop;
  private snapshotTimerMs = 0;

  private constructor(
    readonly sim: Simulation,
    readonly renderer: GameRenderer,
    private readonly store: UiStore,
  ) {
    this.loop = new GameLoop(
      () => this.sim.tick(),
      (dtMs) => this.onDraw(dtMs),
      (stats) => this.store.update({ fps: Math.round(stats.fps) }),
    );
  }

  static async create(host: HTMLElement, seed: number, store: UiStore): Promise<Engine> {
    const sim = new Simulation({ seed });
    const renderer = await GameRenderer.create(host, sim.world);
    const engine = new Engine(sim, renderer, store);

    store.update({ ready: true, snapshot: sim.snapshot(), speed: engine.loop.speed });
    return engine;
  }

  setSpeed(speed: GameSpeed): void {
    this.loop.speed = speed;
    this.store.update({ speed });
  }

  /** Rebuilds the world from a new seed, through the command queue like any change. */
  regenerate(seed: number): void {
    this.sim.dispatch({ type: 'regenerate', seed });
    // Paused means no tick is coming to drain the queue, so drain it explicitly
    // rather than stealing a tick and desyncing the clock.
    if (this.loop.speed === 0) this.sim.flushCommands();
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  private onDraw(dtMs: number): void {
    this.renderer.render(this.sim.world, dtMs);

    this.snapshotTimerMs += dtMs;
    if (this.snapshotTimerMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotTimerMs = 0;
      this.store.update({ snapshot: this.sim.snapshot() });
    }
  }

  destroy(): void {
    this.loop.stop();
    this.renderer.destroy();
  }
}
