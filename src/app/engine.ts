/**
 * Wires the four parts of the program together: simulation, renderer, input, loop.
 *
 * This is the only place they meet. React knows about Engine; it knows nothing about
 * Pixi or World.
 */

import { WorldInput } from '../input/worldInput';
import { GameRenderer } from '../render/gameRenderer';
import type { EntityId } from '../sim/core/entityStore';
import type { TilePos } from '../sim/core/position';
import { Simulation } from '../sim/simulation';
import { GameLoop, type GameSpeed } from './gameLoop';
import type { UiStore } from './uiStore';

/** How often UI state is republished. 10Hz is imperceptible for a clock readout. */
const SNAPSHOT_INTERVAL_MS = 100;

export class Engine {
  readonly loop: GameLoop;

  private readonly input: WorldInput;
  private selectedId: EntityId | null = null;
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

    this.input = new WorldInput(this.renderer.canvas, this.renderer.camera, {
      onSelect: (id) => this.select(id),
      onMoveOrder: (pawnId, target) => this.orderMove(pawnId, target),
      getSelected: () => this.selectedId,
      getWorld: () => this.sim.world,
      getViewSize: () => this.renderer.viewSize,
    });
    this.input.attach();
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

  /** Selection is view state, so it is published to the UI but never sent to the sim. */
  select(id: EntityId | null): void {
    this.selectedId = id;
    this.store.update({ selectedPawnId: id });
  }

  /** Selects a colonist and brings them on screen. Used by the HUD's colonist strip. */
  focusPawn(id: EntityId): void {
    const pawn = this.sim.world.pawns.get(id);
    if (!pawn) return;
    this.select(id);
    this.renderer.focusOn(pawn.pos.x, pawn.pos.y);
  }

  orderMove(pawnId: EntityId, target: TilePos): void {
    this.sim.dispatch({ type: 'moveTo', pawnId, target });
    // Paused means no tick is coming to drain the queue, so drain it explicitly —
    // otherwise issuing orders while paused would appear to do nothing.
    if (this.loop.speed === 0) this.sim.flushCommands();
  }

  /** Rebuilds the world from a new seed, through the command queue like any change. */
  regenerate(seed: number): void {
    this.sim.dispatch({ type: 'regenerate', seed });
    if (this.loop.speed === 0) this.sim.flushCommands();
    // The old colonists no longer exist, so a held selection would dangle.
    this.select(null);
    this.renderer.focusOn(this.sim.world.landingSite.x, this.sim.world.landingSite.y);
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  private onDraw(dtMs: number): void {
    this.renderer.render(this.sim.world, dtMs, this.selectedId);

    this.snapshotTimerMs += dtMs;
    if (this.snapshotTimerMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotTimerMs = 0;
      this.store.update({ snapshot: this.sim.snapshot() });
    }
  }

  destroy(): void {
    this.loop.stop();
    this.input.detach();
    this.renderer.destroy();
  }
}
