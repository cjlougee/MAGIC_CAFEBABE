/**
 * Drives simulation and rendering from one clock.
 *
 * Simulation advances in fixed steps; rendering happens once per animation frame.
 * Decoupling them is what makes the game frame-rate independent — the same seed run
 * on a 144Hz monitor and a 30Hz one produces identical worlds.
 */

import { MS_PER_TICK } from '../sim/core/constants';

export type GameSpeed = 0 | 1 | 2 | 3;

/**
 * Ceiling on catch-up work in a single frame. Without it, a long stall (alt-tab, a
 * breakpoint, a GC pause) queues thousands of ticks, which takes even longer to
 * process, which queues more — the classic death spiral. We drop the excess instead:
 * losing game time is far better than locking the browser.
 */
const MAX_TICKS_PER_FRAME = 30;

export interface LoopStats {
  readonly fps: number;
}

export class GameLoop {
  speed: GameSpeed = 1;

  private handle = 0;
  private running = false;
  private lastFrameTime = 0;
  private accumulatorMs = 0;
  private fps = 0;

  constructor(
    private readonly step: () => void,
    private readonly draw: (dtMs: number) => void,
    private readonly onStats: (stats: LoopStats) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.accumulatorMs = 0;
    this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    // Clamping the raw delta stops a single long stall from producing a huge
    // accumulator before MAX_TICKS_PER_FRAME even gets a chance to help.
    const dtMs = Math.min(now - this.lastFrameTime, 250);
    this.lastFrameTime = now;

    if (dtMs > 0) {
      const instantFps = 1000 / dtMs;
      // Smoothed, otherwise the readout is unreadable noise.
      this.fps = this.fps === 0 ? instantFps : this.fps * 0.9 + instantFps * 0.1;
    }

    if (this.speed > 0) {
      this.accumulatorMs += dtMs * this.speed;
      let ticks = 0;
      while (this.accumulatorMs >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
        this.step();
        this.accumulatorMs -= MS_PER_TICK;
        ticks++;
      }
      if (ticks >= MAX_TICKS_PER_FRAME) this.accumulatorMs = 0;
    } else {
      this.accumulatorMs = 0;
    }

    this.draw(dtMs);
    this.onStats({ fps: this.fps });

    this.handle = requestAnimationFrame(this.frame);
  };
}
