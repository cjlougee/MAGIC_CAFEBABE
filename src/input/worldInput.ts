/**
 * Turning clicks into intent.
 *
 * Two modes of interaction, matching the two halves of the control model. With the
 * **select** tool the player commands individuals directly — click a colonist,
 * right-click to send them somewhere. With an **area** tool they express standing
 * intent — mark rock for mining, paint a stockpile — and the colony decides who does it
 * and when.
 *
 * Selection and the in-progress drag are *view* state and never enter the simulation.
 * Nothing is designated until the button comes up; until then the rectangle is a
 * preview and the world knows nothing about it.
 */

import type { Camera } from '../render/camera/camera';
import type { DragPreview, PreviewTool } from '../render/layers/overlayLayer';
import { Buildable, type BuildableId } from '../sim/defs/buildables';
import {
  footprintOfBuildable,
  isSingleCell,
  nextRotation,
  type Rotation,
} from '../sim/world/footprint';
import type { EntityId } from '../sim/core/entityStore';
import { normaliseRect, type Command, type TileRectangle } from '../sim/core/commands';
import { GROUND_LEVEL, type TilePos } from '../sim/core/position';
import { isWorkbench } from '../sim/entities/building';
import { buildingAt } from '../sim/world/lookup';
import type { World } from '../sim/world/world';

export type Tool = 'select' | 'mine' | 'deconstruct' | 'stockpile' | 'erase' | 'build';

/** The workbench standing on a cell, if there is one. */
function benchAt(world: World, cell: TilePos): EntityId | null {
  const index = world.map.idx(cell.x, cell.y, cell.z);
  const building = buildingAt(world, index);
  if (!building || !isWorkbench(building)) return null;
  return building.id;
}

/**
 * Pointer travel, in pixels, above which a press counts as a drag rather than a click.
 * Without it, every camera pan ends by selecting or deselecting something.
 */
const CLICK_SLOP = 5;

/** How close to a pawn's tile a click must land to pick it, in tiles. */
const PICK_RADIUS = 0.9;

/**
 * How a click should change the party, read off the keyboard modifiers.
 *
 * Ctrl toggles and shift takes a range, matching every file manager the player has ever
 * used. Ctrl wins when both are held, because "add exactly this one" is the more precise
 * intent and the one you meant if you went to the trouble of holding both.
 */
export type SelectMode = 'replace' | 'toggle' | 'range';

function selectMode(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectMode {
  // metaKey so Command behaves as Ctrl on a Mac.
  if (event.ctrlKey || event.metaKey) return 'toggle';
  if (event.shiftKey) return 'range';
  return 'replace';
}

export interface WorldInputHandlers {
  readonly onSelect: (id: EntityId | null, mode: SelectMode) => void;
  /** Everyone inside a drag rectangle. Replaces the party unless `additive`. */
  readonly onSelectMany: (ids: readonly EntityId[], additive: boolean) => void;
  /**
   * A workbench was clicked, or the selection cleared.
   *
   * Separate from `onSelect` because pawns and buildings live in different entity
   * stores, so a single id could not say which of the two it meant.
   */
  readonly onSelectBench: (id: EntityId | null) => void;
  /** Returns to the select tool. Raised by a quick right-click while a tool is active. */
  readonly onCancelTool: () => void;
  /**
   * The player asked the party to go somewhere.
   *
   * Raised rather than dispatched here so ordering has exactly one path: the engine
   * both sends the command and drops the marker that acknowledges it, and the two can
   * never come apart.
   */
  readonly onOrder: (target: TilePos, screen: { x: number; y: number }) => void;
  readonly dispatch: (command: Command) => void;
  readonly getSelected: () => readonly EntityId[];
  readonly getWorld: () => World;
  readonly getViewSize: () => { width: number; height: number };
}

export class WorldInput {
  private tool: Tool = 'select';
  /** Which blueprint the build tool places. Meaningless for other tools. */
  private buildable: BuildableId = Buildable.Wall;
  /** Quarter turns the next blueprint is placed at. Reset when the buildable changes. */
  private rotation: Rotation = 0;
  /** Debug: raise the finished structure instead of a blueprint. */
  private instantBuild = false;
  private downX = 0;
  private downY = 0;
  private downButton = -1;
  private dragFrom: { x: number; y: number } | null = null;
  private dragTo: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly handlers: WorldInputHandlers,
  ) {}

  get activeTool(): Tool {
    return this.tool;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelDrag();
  }

  setBuildable(buildable: BuildableId): void {
    this.buildable = buildable;
    // Reset rather than carried over: a rotation held from the last buildable is
    // invisible state, and the preview would appear to place a wall "sideways" for no
    // reason the player could see.
    this.rotation = 0;
    this.tool = 'build';
    this.cancelDrag();
  }

  /** Turns the pending blueprint a quarter turn. No effect on anything one cell square. */
  rotateBuildable(): void {
    this.rotation = nextRotation(this.rotation);
  }

  get buildRotation(): Rotation {
    return this.rotation;
  }

  /**
   * Whether the build tool drags out an area, or places one structure per click.
   *
   * A wall is dragged in runs and a hearth is not: sweeping a 2x2 across a rectangle
   * would tile it greedily and hand the player four hearths for one gesture. The sim
   * would place them quite happily — the restraint belongs here, where the preview can
   * show what will actually happen.
   */
  private get dragsAnArea(): boolean {
    return this.tool !== 'build' || isSingleCell(footprintOfBuildable(this.buildable));
  }

  setInstantBuild(instant: boolean): void {
    this.instantBuild = instant;
  }

  /** The rectangle currently being dragged, for the renderer to outline. */
  get preview(): DragPreview | null {
    if (!this.dragFrom || !this.dragTo) return null;

    // A multi-tile blueprint follows the cursor rather than sweeping an area, so the
    // rectangle collapses onto wherever the pointer currently is.
    const from = this.dragsAnArea ? this.dragFrom : this.dragTo;

    const rect = normaliseRect(from.x, from.y, this.dragTo.x, this.dragTo.y, GROUND_LEVEL);
    // The tool travels with the rectangle so the overlay can grey out cells it would
    // skip — a drag across a river should say so before the player commits. The
    // buildable goes too, because a footprint's legality is a question about several
    // cells and the preview must ask exactly the question the command will.
    return {
      ...rect,
      tool: this.tool as PreviewTool,
      buildable: this.tool === 'build' ? this.buildable : undefined,
      rotation: this.rotation,
    };
  }

  attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  cancelDrag(): void {
    this.dragFrom = null;
    this.dragTo = null;
    this.downButton = -1;
  }

  private onContextMenu = (event: Event): void => {
    // Right-click is a game command here, not a browser menu.
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downButton = event.button;

    // The select tool drags too, now that a party is a thing you can have. Left-drag
    // still means "apply the active tool" — for select, applying it is picking people.
    if (event.button === 0) {
      const tile = this.tileUnder(event);
      this.dragFrom = { x: Math.round(tile.x), y: Math.round(tile.y) };
      this.dragTo = this.dragFrom;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragFrom) return;
    const tile = this.tileUnder(event);
    this.dragTo = { x: Math.round(tile.x), y: Math.round(tile.y) };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== this.downButton) return;
    const travel = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    this.downButton = -1;

    if (this.dragFrom) {
      // A select-tool press that never travelled is a click, and click-picking has a
      // radius of tolerance that a one-cell rectangle does not. Losing that would make
      // colonists fiddly to hit for no gain.
      if (this.tool === 'select' && travel <= CLICK_SLOP) {
        this.dragFrom = null;
        this.dragTo = null;
        this.select(this.tileUnder(event), selectMode(event));
        return;
      }

      this.commitDrag(event.ctrlKey || event.metaKey);
      return;
    }

    if (travel > CLICK_SLOP) return; // The player was panning, not clicking.

    const tile = this.tileUnder(event);
    if (event.button === 0) this.select(tile, selectMode(event));
    else if (event.button === 2) this.order(tile, { x: event.clientX, y: event.clientY });
  };

  /** Turns the finished rectangle into the command the active tool implies. */
  private commitDrag(additive = false): void {
    // Read before clearing: `preview` is derived from the drag corners.
    const rect =
      this.dragFrom && this.dragTo
        ? normaliseRect(this.dragFrom.x, this.dragFrom.y, this.dragTo.x, this.dragTo.y, GROUND_LEVEL)
        : null;
    const area = this.preview;
    this.dragFrom = null;
    this.dragTo = null;

    if (this.tool === 'select') {
      if (rect) this.selectWithin(rect, additive);
      return;
    }

    if (!area) return;

    switch (this.tool) {
      case 'mine':
        this.handlers.dispatch({ type: 'designate', action: 'mine', area });
        break;
      case 'deconstruct':
        this.handlers.dispatch({ type: 'designate', action: 'deconstruct', area });
        break;
      case 'stockpile':
        this.handlers.dispatch({ type: 'zone', action: 'stockpile', area });
        break;
      case 'build':
        this.handlers.dispatch({
          type: 'build',
          buildable: this.buildable,
          area: this.dragsAnArea ? area : { ...area, x0: area.x1, y0: area.y1 },
          rotation: this.rotation,
          instant: this.instantBuild,
        });
        break;
      case 'erase':
        // One gesture clears every kind of mark, because the player is expressing
        // "undo whatever is here" rather than picking a specific system to undo.
        // Cancelling a blueprint refunds whatever was already delivered to it.
        this.handlers.dispatch({ type: 'designate', action: 'cancel', area });
        this.handlers.dispatch({ type: 'zone', action: 'clear', area });
        break;
    }
  }

  private tileUnder(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const size = this.handlers.getViewSize();
    return this.camera.screenToTile(
      event.clientX - rect.left,
      event.clientY - rect.top,
      size.width,
      size.height,
    );
  }

  private select(tile: { x: number; y: number }, mode: SelectMode): void {
    const world = this.handlers.getWorld();
    let closestId: EntityId | null = null;
    let closest = PICK_RADIUS;

    for (const pawn of world.pawns.values()) {
      if (pawn.dead) continue;
      const distance = Math.hypot(pawn.pos.x - tile.x, pawn.pos.y - tile.y);
      if (distance < closest) {
        closest = distance;
        closestId = pawn.id;
      }
    }

    // A modified click on empty ground must not wipe a party the player just built up —
    // both gestures mean "adjust what I have", and a near-miss is the common case.
    if (closestId === null && mode !== 'replace') return;

    // Clicking empty ground clears the selection, which is what makes right-click
    // orders feel safe — there is always a way to put the mouse down.
    this.handlers.onSelect(closestId, mode);

    // A colonist standing at a bench wins: they move, so they are the harder thing to
    // click, and the bench is not going anywhere.
    if (closestId !== null) {
      this.handlers.onSelectBench(null);
      return;
    }

    const cell = { x: Math.round(tile.x), y: Math.round(tile.y), z: GROUND_LEVEL };
    const bench = benchAt(world, cell);
    this.handlers.onSelectBench(bench);
  }

  /**
   * Every living colonist standing inside the dragged rectangle.
   *
   * Iterated in entity-store order, which is stable, so the party is always listed the
   * same way — and the party's order is what decides which pawn gets which cell when
   * they are sent somewhere.
   */
  private selectWithin(rect: TileRectangle, additive: boolean): void {
    const world = this.handlers.getWorld();
    const caught: EntityId[] = [];

    for (const pawn of world.pawns.values()) {
      if (pawn.dead) continue;
      if (pawn.pos.x < rect.x0 || pawn.pos.x > rect.x1) continue;
      if (pawn.pos.y < rect.y0 || pawn.pos.y > rect.y1) continue;
      caught.push(pawn.id);
    }

    // An empty drag across bare ground clears the party, matching click-on-nothing.
    this.handlers.onSelectMany(caught, additive);
    if (caught.length > 0) this.handlers.onSelectBench(null);
  }

  /**
   * A quick right-click: back out, or give an order.
   *
   * Cancelling the active tool takes priority, matching the convention every RTS shares —
   * right-click means "never mind". It also removes the main reason mode-switching felt
   * heavy: leaving a tool no longer requires travelling to the toolbar or remembering a
   * key.
   */
  private order(tile: { x: number; y: number }, screen: { x: number; y: number }): void {
    if (this.tool !== 'select') {
      this.handlers.onCancelTool();
      return;
    }

    const selected = this.handlers.getSelected();
    if (selected.length === 0) return;

    const target: TilePos = {
      x: Math.round(tile.x),
      y: Math.round(tile.y),
      z: GROUND_LEVEL,
    };

    const map = this.handlers.getWorld().map;
    if (!map.isPassable(target.x, target.y, target.z)) return;

    this.handlers.onOrder(target, screen);
  }
}
