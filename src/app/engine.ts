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
import { TICKS_PER_HOUR } from '../sim/core/constants';
import type { BuildableId } from '../sim/defs/buildables';
import type { ItemDefId } from '../sim/defs/items';
import type { RecipeId } from '../sim/defs/recipes';
import type { WorkTypeId } from '../sim/defs/workTypes';
import { Simulation } from '../sim/simulation';
import { GameLoop, type GameSpeed } from './gameLoop';
import { readSave, suggestedName, writeSave, type SaveStats } from './saveStorage';
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
      onSelectBench: (id) => this.selectBench(id),
      onCancelTool: () => this.setTool('select'),
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

    /*
     * The camera belongs to the right button, in every mode.
     *
     * Tying panning to left-drag-in-select-mode meant the same gesture did different
     * things depending on invisible state: reach for the camera with a tool active and
     * you painted a wall instead. Making the right button *always* mean "move the view"
     * removes the mode from the most common action in the game. Left-drag is then
     * unambiguously "apply the current tool", and a quick right-click — released before
     * travelling far enough to count as a drag — stays free for context actions.
     *
     * Middle-drag pans too, for anyone who expects it.
     */
    const renderer = await GameRenderer.create(
      host,
      sim.world,
      (event) => event.button === 2 || event.button === 1,
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
    // The cursor is the only persistent signal of which gesture the left button carries.
    this.renderer.setCursor(tool === 'select' ? 'default' : 'crosshair');
    this.store.update({ tool });
  }

  /** Picking a blueprint also switches to the build tool — one click, not two. */
  setBuildable(buildable: BuildableId): void {
    this.toolRef.current = 'build';
    this.input.setBuildable(buildable);
    this.renderer.setCursor('crosshair');
    this.store.update({ tool: 'build', buildable });
  }

  /** Selection is view state, so it is published to the UI but never sent to the sim. */
  select(id: EntityId | null): void {
    this.selectedId = id;
    this.store.update({ selectedPawnId: id });
  }

  /**
   * Opens a workbench's bills, or closes whatever was open.
   *
   * Unlike the pawn selection there is no local copy: nothing in the engine or the input
   * layer asks which bench is open, so the store is the only place it needs to live.
   */
  selectBench(id: EntityId | null): void {
    this.store.update({ selectedBenchId: id });
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

  // Bills. Each republishes the snapshot immediately rather than waiting for the next
  // 10Hz tick, so a click on "+" moves the number now — and so they still work while
  // the game is paused, which is when a player is most likely to be setting quotas.
  addBill(bench: EntityId, recipe: RecipeId): void {
    this.dispatch({ type: 'bill', action: 'add', bench, recipe });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  removeBill(bench: EntityId, recipe: RecipeId): void {
    this.dispatch({ type: 'bill', action: 'remove', bench, recipe });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  setBillCount(bench: EntityId, recipe: RecipeId, untilCount: number): void {
    this.dispatch({ type: 'bill', action: 'setCount', bench, recipe, untilCount });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  // ── Debug ────────────────────────────────────────────────────────────────
  // Cheats, routed through the command queue like every other change so that the
  // debug path is the same path the game uses. Each republishes the snapshot, since
  // these are normally pressed while paused and would otherwise appear to do nothing.

  debugSetHour(hour: number): void {
    this.dispatch({ type: 'debug', action: 'setHour', hour });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  debugGive(item: ItemDefId, count: number): void {
    this.dispatch({ type: 'debug', action: 'giveItems', item, count });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  debugFinishBlueprints(): void {
    this.dispatch({ type: 'debug', action: 'finishBlueprints' });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /**
   * Camera zoom, not routed through the command queue — it changes nothing in the
   * simulation, and pushing render state through the sim would be the firewall running
   * backwards.
   */
  get cameraZoom(): number {
    return this.renderer.camera.zoom;
  }

  debugSetZoom(zoom: number): void {
    this.renderer.camera.setZoom(zoom);
  }

  /**
   * Actually simulates `hours`, rather than moving the clock.
   *
   * The difference matters: `debugSetHour` skips to nightfall with nothing having
   * happened, while this lets the colony eat, build and wander its way there. Runs
   * synchronously — 2,500 ticks costs a few milliseconds headless.
   */
  debugAdvanceHours(hours: number): void {
    this.sim.run(TICKS_PER_HOUR * hours);
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  setInstantBuild(instant: boolean): void {
    this.input.setInstantBuild(instant);
    this.store.update({ instantBuild: instant });
  }

  /** Day and headcount, for naming and listing saves. */
  saveStats(): SaveStats {
    const snapshot = this.sim.snapshot();
    return {
      day: snapshot.day + 1,
      colonists: snapshot.pawns.filter((pawn) => !pawn.dead).length,
    };
  }

  /**
   * Writes the colony to a slot. Returns false if storage refused it.
   *
   * Passing an existing id overwrites that slot; a fresh one from `newSlotId()` creates
   * a new save. The engine doesn't decide which — the menu does.
   */
  saveGame(id: string, name: string): boolean {
    return writeSave(id, name.trim() || suggestedName(this.saveStats()), this.sim.save(), this.saveStats());
  }

  /** Restores a colony. Returns false if the slot was missing or unreadable. */
  loadGame(id: string): boolean {
    const save = readSave(id);
    if (!save) return false;

    this.sim.load(save);
    // Everything the UI was pointing at belonged to the previous world — including any
    // open bench panel, whose id now means a different building or nothing at all.
    this.select(null);
    this.selectBench(null);
    this.setTool('select');
    this.renderer.onWorldReplaced();
    this.renderer.focusOn(this.sim.world.landingSite.x, this.sim.world.landingSite.y);
    this.store.update({ snapshot: this.sim.snapshot() });
    return true;
  }

  /** Rebuilds the world from a new seed, through the command queue like any change. */
  regenerate(seed: number): void {
    this.dispatch({ type: 'regenerate', seed });
    // The old colonists no longer exist, so a held selection would dangle. Nor do the
    // old buildings, so the bench panel goes with them.
    this.select(null);
    this.selectBench(null);
    this.setTool('select');
    this.renderer.onWorldReplaced();
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
