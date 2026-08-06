/**
 * Wires the four parts of the program together: simulation, renderer, input, loop.
 *
 * This is the only place they meet. React knows about Engine; it knows nothing about
 * Pixi or World.
 */

import { WorldInput, type Tool } from '../input/worldInput';
import { GameRenderer } from '../render/gameRenderer';
import type { Command } from '../sim/core/commands';
import type { EntityId } from '../sim/core/entityStore';
import type { BuildableId } from '../sim/defs/buildables';
import type { WorkTypeId } from '../sim/defs/workTypes';
import { Simulation } from '../sim/simulation';
import { GameLoop, type GameSpeed } from './gameLoop';
import type { UiStore } from './uiStore';

/** How often UI state is republished. 10Hz is imperceptible for a clock readout. */
const SNAPSHOT_INTERVAL_MS = 100;

/**
 * Shared so the camera controller can ask which tool is active before the Engine that
 * owns it exists — the renderer has to be constructed first, and it needs the answer.
 */
interface ToolRef {
  current: Tool;
}

export class Engine {
  readonly loop: GameLoop;

  private readonly input: WorldInput;
  private selectedId: EntityId | null = null;
  private snapshotTimerMs = 0;

  private constructor(
    readonly sim: Simulation,
    readonly renderer: GameRenderer,
    private readonly store: UiStore,
    private readonly toolRef: ToolRef,
  ) {
    this.loop = new GameLoop(
      () => this.sim.tick(),
      (dtMs) => this.onDraw(dtMs),
      (stats) => this.store.update({ fps: Math.round(stats.fps) }),
    );

    this.input = new WorldInput(this.renderer.canvas, this.renderer.camera, {
      onSelect: (id) => this.select(id),
      dispatch: (command) => this.dispatch(command),
      getSelected: () => this.selectedId,
      getWorld: () => this.sim.world,
      getViewSize: () => this.renderer.viewSize,
    });
    this.input.attach();
  }

  static async create(host: HTMLElement, seed: number, store: UiStore): Promise<Engine> {
    const sim = new Simulation({ seed });
    const toolRef: ToolRef = { current: 'select' };

    // Left-drag belongs to area tools; the camera only claims it in select mode. Middle
    // button always pans, so there is a way to move the view without leaving the tool.
    const renderer = await GameRenderer.create(
      host,
      sim.world,
      (event) => event.button === 1 || toolRef.current === 'select',
    );

    const engine = new Engine(sim, renderer, store, toolRef);
    store.update({ ready: true, snapshot: sim.snapshot(), speed: engine.loop.speed });
    return engine;
  }

  /**
   * Sends a command to the simulation.
   *
   * While paused no tick arrives to drain the queue, so a paused player's actions would
   * appear to do nothing. Flushing keeps the game usable as a planning mode.
   */
  dispatch(command: Command): void {
    this.sim.dispatch(command);
    if (this.loop.speed === 0) this.sim.flushCommands();
  }

  setSpeed(speed: GameSpeed): void {
    this.loop.speed = speed;
    this.store.update({ speed });
  }

  setTool(tool: Tool): void {
    this.toolRef.current = tool;
    this.input.setTool(tool);
    this.store.update({ tool });
  }

  /** Picking a blueprint also switches to the build tool — one click, not two. */
  setBuildable(buildable: BuildableId): void {
    this.toolRef.current = 'build';
    this.input.setBuildable(buildable);
    this.store.update({ tool: 'build', buildable });
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

  setWorkPriority(pawnId: EntityId, workType: WorkTypeId, priority: number): void {
    this.dispatch({ type: 'setWorkPriority', pawnId, workType, priority });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /** Rebuilds the world from a new seed, through the command queue like any change. */
  regenerate(seed: number): void {
    this.dispatch({ type: 'regenerate', seed });
    // The old colonists no longer exist, so a held selection would dangle.
    this.select(null);
    this.setTool('select');
    this.renderer.focusOn(this.sim.world.landingSite.x, this.sim.world.landingSite.y);
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  private onDraw(dtMs: number): void {
    this.renderer.render(this.sim.world, dtMs, this.selectedId, this.input.preview);

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
