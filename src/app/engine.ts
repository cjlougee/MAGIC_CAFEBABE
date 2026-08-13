/**
 * Wires the four parts of the program together: simulation, renderer, input, loop.
 *
 * This is the only place they meet. React knows about Engine; it knows nothing about
 * Pixi or World.
 */

import { WorldInput, type Tool } from '../input/worldInput';
import { GameRenderer } from '../render/gameRenderer';
import { HALF_TILE_H, HALF_TILE_W, MAX_ZOOM, MIN_ZOOM } from '../render/constants';
import { SCENARIOS, scenarioNames, type Frame } from '../scenarios';
import { runScenario } from '../scenarios/builder';
import { paintMinimapTerrain } from '../render/minimap';
import type { Command } from '../sim/core/commands';
import type { EntityId } from '../sim/core/entityStore';
import { TICKS_PER_HOUR } from '../sim/core/constants';
import { GROUND_LEVEL, type TilePos } from '../sim/core/position';
import type { BuildableId } from '../sim/defs/buildables';
import type { ItemDefId } from '../sim/defs/items';
import type { RecipeId } from '../sim/defs/recipes';
import type { WorkTypeId } from '../sim/defs/workTypes';
import { Simulation } from '../sim/simulation';
import type { World } from '../sim/world/world';
import { GameLoop, type GameSpeed } from './gameLoop';
import { readSave, suggestedName, writeSave, type SaveStats } from './saveStorage';
import type { UiStore } from './uiStore';

/**
 * How a click changes the party. Named rather than a boolean, because there are three
 * behaviours now and `select(id, true, false)` says nothing to anyone.
 */
export type SelectMode = 'replace' | 'toggle' | 'range';

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
  private selectedIds: readonly EntityId[] = [];
  /** Where a shift-range sweeps from. The last colonist picked deliberately, not by range. */
  private selectionAnchor: EntityId | null = null;
  private snapshotTimerMs = 0;
  /** Bumped whenever the world is *replaced* rather than merely edited. */
  private worldEpoch = 0;
  private orderPingId = 0;

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
      onSelect: (id, mode) => this.select(id, mode),
      onSelectMany: (ids, additive) => this.selectMany(ids, additive),
      onSelectStructure: (id) => this.selectStructure(id),
      onCancelTool: () => this.setTool('select'),
      onOrder: (target, screen) => this.orderPartyTo(target, screen),
      dispatch: (command) => this.dispatch(command),
      getSelected: () => this.selectedIds,
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

  /**
   * Turns the pending blueprint a quarter turn.
   *
   * Nothing to publish: the ghost under the cursor is drawn by Pixi straight from the
   * input layer every frame, so the facing is already on screen where the player is
   * looking. A copy in the UI store existed only to feed a readout in the build menu,
   * and that menu is for buildable things.
   */
  rotateBuildable(step: 1 | -1 = 1): void {
    this.input.rotateBuildable(step);
  }

  /** Whether Q and E currently mean "turn this", for the hint bar to say so. */
  get canRotate(): boolean {
    return this.input.canRotate;
  }

  /**
   * Selection is view state, so it is published to the UI but never sent to the sim.
   *
   * The modifiers follow the convention every file manager shares, because that is
   * where players already know them from:
   *
   * - **plain** replaces the party and sets the anchor
   * - **ctrl** toggles one colonist in or out, and moves the anchor to them
   * - **shift** takes everyone between the anchor and this colonist
   *
   * "Between" means *roster order* — the entity store's insertion order, which is what
   * the colonist strip lists and the only ordering colonists have. A range over screen
   * position would change meaning every time somebody walked.
   */
  select(id: EntityId | null, mode: SelectMode = 'replace'): void {
    if (id === null) {
      this.selectedIds = [];
      this.selectionAnchor = null;
      this.store.update({ selectedPawnIds: this.selectedIds });
      return;
    }

    if (mode === 'range' && this.selectionAnchor !== null) {
      this.selectedIds = this.rosterRange(this.selectionAnchor, id);
      // The anchor deliberately stays put, so shift-clicking around re-sweeps from the
      // same place rather than dragging the origin along behind the cursor.
      this.store.update({ selectedPawnIds: this.selectedIds });
      return;
    }

    if (mode === 'toggle') {
      this.selectedIds = this.selectedIds.includes(id)
        ? this.selectedIds.filter((held) => held !== id)
        : [...this.selectedIds, id];
    } else {
      this.selectedIds = [id];
    }

    this.selectionAnchor = id;
    this.store.update({ selectedPawnIds: this.selectedIds });
  }

  /** Everyone caught by a drag. Replaces the party unless `additive`. */
  selectMany(ids: readonly EntityId[], additive = false): void {
    const merged = additive ? [...this.selectedIds] : [];
    for (const id of ids) {
      if (!merged.includes(id)) merged.push(id);
    }

    this.selectedIds = merged;
    this.selectionAnchor = merged.at(-1) ?? null;
    this.store.update({ selectedPawnIds: this.selectedIds });
  }

  /** Living colonists between two ids in roster order, inclusive of both ends. */
  private rosterRange(from: EntityId, to: EntityId): EntityId[] {
    const roster = [...this.sim.world.pawns.values()]
      .filter((pawn) => !pawn.dead)
      .map((pawn) => pawn.id);

    const start = roster.indexOf(from);
    const end = roster.indexOf(to);
    // The anchor may have died since it was set, which is not a reason to do nothing.
    if (start === -1 || end === -1) return [to];

    return roster.slice(Math.min(start, end), Math.max(start, end) + 1);
  }

  /** Drafts or releases the whole current party in one go. */
  setPartyDrafted(drafted: boolean): void {
    if (this.selectedIds.length === 0) return;
    this.dispatch({ type: 'setDrafted', pawnIds: [...this.selectedIds], drafted });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /** One colonist, for the per-member control in the party panel. */
  setDrafted(pawnId: EntityId, drafted: boolean): void {
    this.dispatch({ type: 'setDrafted', pawnIds: [pawnId], drafted });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /**
   * Sends the current party somewhere — the ground, or a named place.
   *
   * Returns false when nobody is selected, so the caller can say so rather than
   * appearing to do nothing.
   */
  orderPartyTo(target: { x: number; y: number }, screen?: { x: number; y: number }): boolean {
    if (this.selectedIds.length === 0) return false;

    this.dispatch({
      type: 'moveParty',
      pawnIds: [...this.selectedIds],
      target: { x: target.x, y: target.y, z: GROUND_LEVEL },
    });

    /*
     * Acknowledge the click immediately, on the tile the player actually pointed at.
     *
     * Not on the cells the party is fanned out to: those are the simulation's answer to
     * the order, they are only known a tick later, and the player asked about *here*.
     * Marking here also means an order that turns out to be impossible still shows that
     * the click landed — the failure then comes from the alert, not from silence.
     */
    this.renderer.markOrder(target.x, target.y, GROUND_LEVEL);

    // Only clicks in the world get the cursor animation. Ordering from the places list
    // is a button press, and a button already acknowledges itself.
    if (screen) {
      this.orderPingId += 1;
      this.store.update({ orderPing: { x: screen.x, y: screen.y, id: this.orderPingId } });
    }

    this.store.update({ snapshot: this.sim.snapshot() });
    return true;
  }

  /**
   * Opens a workbench's bills, or closes whatever was open.
   *
   * Unlike the pawn selection there is no local copy: nothing in the engine or the input
   * layer asks which bench is open, so the store is the only place it needs to live.
   */
  selectStructure(id: EntityId | null): void {
    this.store.update({ selectedStructureId: id });
  }

  /**
   * Selects a colonist and brings them on screen. Used by the HUD's colonist strip.
   *
   * Shift-clicking adds them to the party instead of replacing it — the roster is often
   * the only practical way to gather colonists who are scattered across a 512-tile map
   * doing their own thing, where a drag rectangle would have to cover half the world.
   */
  focusPawn(id: EntityId, mode: SelectMode = 'replace'): void {
    const pawn = this.sim.world.pawns.get(id);
    if (!pawn) return;
    this.select(id, mode);
    this.renderer.focusOn(pawn.pos.x, pawn.pos.y);
  }

  setWorkPriority(pawnId: EntityId, workType: WorkTypeId, priority: number): void {
    this.dispatch({ type: 'setWorkPriority', pawnId, workType, priority });
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /**
   * Orders one structure taken down, from its panel rather than by dragging over it.
   *
   * Goes through the ordinary `designate` command over a one-cell area, so the panel and
   * the deconstruct tool cannot end up meaning different things — the command already
   * spreads the mark across a multi-tile footprint and already refuses anything the
   * colony did not build.
   */
  markDeconstruct(x: number, y: number): void {
    this.sim.dispatch({
      type: 'designate',
      action: 'deconstruct',
      area: { x0: x, y0: y, x1: x, y1: y, z: GROUND_LEVEL },
    });
    this.sim.flushCommands();
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /** Calls the mark off again. The same path the Erase tool takes. */
  cancelDesignation(x: number, y: number): void {
    this.sim.dispatch({
      type: 'designate',
      action: 'cancel',
      area: { x0: x, y0: y, x1: x, y1: y, z: GROUND_LEVEL },
    });
    this.sim.flushCommands();
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /** Bars or unbars a door. Changes what is passable, so it goes through the tick. */
  setLocked(building: EntityId, locked: boolean): void {
    this.sim.dispatch({ type: 'setLocked', building, locked });
    this.sim.flushCommands();
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

  // ── The minimap ──────────────────────────────────────────────────────────
  //
  // Bridged through here rather than handing the UI a live TileMap. React gets the
  // pixels and the numbers it needs to draw, and no reference it could write through.

  /**
   * Changes whenever the painted result would differ, so the caller knows to repaint.
   *
   * The epoch is not decoration. `TileMap.revision` counts edits *on one instance*, and
   * loading a save or generating a new world hands over a completely different instance
   * whose counter started again — two unrelated worlds can land on the same number, and
   * the minimap would go on showing a world the player has left. Cheap to make
   * impossible; unpleasant to diagnose.
   */
  get minimapKey(): string {
    return `${this.worldEpoch}:${this.sim.world.map.revision}`;
  }

  paintMinimap(image: ImageData): void {
    paintMinimapTerrain(this.sim.world.map, image);
  }

  /**
   * The four screen corners, in tile coordinates.
   *
   * A diamond rather than a rectangle, because that is genuinely what an isometric
   * camera sees. Drawing an axis-aligned box would quietly claim the player can see
   * corners they cannot.
   */
  viewportTileCorners(): { x: number; y: number }[] {
    const { camera, canvas } = this.renderer;
    const w = canvas.width;
    const h = canvas.height;
    return [
      camera.screenToTile(0, 0, w, h),
      camera.screenToTile(w, 0, w, h),
      camera.screenToTile(w, h, w, h),
      camera.screenToTile(0, h, w, h),
    ];
  }

  /** Jumps the camera so a tile sits in the middle of the screen. */
  centreCameraOn(x: number, y: number): void {
    this.renderer.camera.x = x;
    this.renderer.camera.y = y;
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
    this.selectStructure(null);
    this.setTool('select');
    this.worldEpoch++;
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
    this.selectStructure(null);
    this.setTool('select');
    this.worldEpoch++;
    this.renderer.onWorldReplaced();
    this.renderer.focusOn(this.sim.world.landingSite.x, this.sim.world.landingSite.y);
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  /**
   * Installs a scenario's world, mirroring `regenerate` step for step.
   *
   * Every line below exists in `regenerate` for a reason that applies equally here — most
   * pointedly `worldEpoch++`, without which the minimap goes on painting a world that is
   * no longer loaded. Copied rather than shared because the two differ in exactly one
   * place: where the world comes from.
   */
  loadScenario(name: string): void {
    const scenario = SCENARIOS.get(name);
    if (!scenario) {
      throw new Error(`no scenario named "${name}" — try ${scenarioNames().join(', ')}`);
    }

    const { world, touched } = runScenario(scenario);
    this.sim.install(world);

    this.select(null);
    this.selectStructure(null);
    this.setTool('select');
    this.worldEpoch++;
    this.renderer.onWorldReplaced();

    const framing = frameFor(scenario.frame, touched, world, this.renderer.viewSize);
    this.renderer.focusOn(framing.x, framing.y);
    this.debugSetZoom(framing.zoom);
    this.store.update({ snapshot: this.sim.snapshot() });
  }

  private onDraw(dtMs: number): void {
    this.renderer.render(
      this.sim.world,
      dtMs,
      new Set(this.selectedIds),
      this.input.preview,
      this.store.getState().selectedStructureId,
    );

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

/**
 * Where to point the camera at a scenario: at whatever it placed, and close enough to see it.
 *
 * `fit: 'contents'` is the default because a scenario's subject *is* what it placed, and
 * making every scenario state its own coordinates is the kind of bookkeeping that stops
 * people writing scenarios.
 *
 * **`fit` computes the zoom rather than taking one.** The first version treated `zoom` as
 * an instruction and centred on the mean, which framed four beds by cutting two of them off
 * and putting the edge of the map in shot — a picture that answers a different question
 * from the one asked. `zoom` is now a *ceiling*: get as close as the contents allow, but no
 * closer than asked and never past what the camera permits.
 *
 * A scenario that places nothing falls back to the landing site, where `regenerate` points.
 */
function frameFor(
  frame: Frame | undefined,
  touched: readonly TilePos[],
  world: World,
  view: { width: number; height: number },
): { x: number; y: number; zoom: number } {
  if (frame && 'at' in frame) return { x: frame.at.x, y: frame.at.y, zoom: frame.zoom };
  if (touched.length === 0) {
    return { x: world.landingSite.x, y: world.landingSite.y, zoom: frame?.zoom ?? 1 };
  }

  const xs = touched.map((cell) => cell.x);
  const ys = touched.map((cell) => cell.y);
  const spanX = Math.max(...xs) - Math.min(...xs) + 1;
  const spanY = Math.max(...ys) - Math.min(...ys) + 1;

  /*
   * A tile block is a rhombus on screen, not a rectangle, so both of its screen dimensions
   * are driven by `spanX + spanY` — the same arithmetic `footprintBounds` uses on a single
   * structure's footprint, for the same reason.
   */
  const pad = frame?.pad ?? 2;
  const worldWidth = (spanX + spanY + pad * 2) * HALF_TILE_W;
  const worldHeight = (spanX + spanY + pad * 2) * HALF_TILE_H;

  const fitted = Math.min(view.width / worldWidth, view.height / worldHeight);
  const ceiling = frame?.zoom ?? MAX_ZOOM;

  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    zoom: Math.max(MIN_ZOOM, Math.min(ceiling, MAX_ZOOM, fitted)),
  };
}
