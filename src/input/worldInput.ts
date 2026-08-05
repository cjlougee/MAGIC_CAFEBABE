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
import type { DragPreview } from '../render/layers/overlayLayer';
import type { EntityId } from '../sim/core/entityStore';
import { normaliseRect, type Command } from '../sim/core/commands';
import { GROUND_LEVEL, type TilePos } from '../sim/core/position';
import type { World } from '../sim/world/world';

export type Tool = 'select' | 'mine' | 'stockpile' | 'erase';

/**
 * Pointer travel, in pixels, above which a press counts as a drag rather than a click.
 * Without it, every camera pan ends by selecting or deselecting something.
 */
const CLICK_SLOP = 5;

/** How close to a pawn's tile a click must land to pick it, in tiles. */
const PICK_RADIUS = 0.9;

export interface WorldInputHandlers {
  readonly onSelect: (id: EntityId | null) => void;
  readonly dispatch: (command: Command) => void;
  readonly getSelected: () => EntityId | null;
  readonly getWorld: () => World;
  readonly getViewSize: () => { width: number; height: number };
}

export class WorldInput {
  private tool: Tool = 'select';
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

  /** The rectangle currently being dragged, for the renderer to outline. */
  get preview(): DragPreview | null {
    if (!this.dragFrom || !this.dragTo) return null;
    if (this.tool === 'select') return null;

    const rect = normaliseRect(
      this.dragFrom.x,
      this.dragFrom.y,
      this.dragTo.x,
      this.dragTo.y,
      GROUND_LEVEL,
    );
    // The tool travels with the rectangle so the overlay can grey out cells it would
    // skip — a drag across a river should say so before the player commits.
    return { ...rect, tool: this.tool };
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

    if (event.button === 0 && this.tool !== 'select') {
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
      this.commitDrag();
      return;
    }

    if (travel > CLICK_SLOP) return; // The player was panning, not clicking.

    const tile = this.tileUnder(event);
    if (event.button === 0) this.select(tile);
    else if (event.button === 2) this.order(tile);
  };

  /** Turns the finished rectangle into the command the active tool implies. */
  private commitDrag(): void {
    const area = this.preview;
    this.dragFrom = null;
    this.dragTo = null;
    if (!area) return;

    switch (this.tool) {
      case 'mine':
        this.handlers.dispatch({ type: 'designate', action: 'mine', area });
        break;
      case 'stockpile':
        this.handlers.dispatch({ type: 'zone', action: 'stockpile', area });
        break;
      case 'erase':
        // One gesture clears both kinds of mark, because the player is expressing
        // "undo whatever is here" rather than picking a specific system to undo.
        this.handlers.dispatch({ type: 'designate', action: 'cancel', area });
        this.handlers.dispatch({ type: 'zone', action: 'clear', area });
        break;
      case 'select':
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

  private select(tile: { x: number; y: number }): void {
    const world = this.handlers.getWorld();
    let closestId: EntityId | null = null;
    let closest = PICK_RADIUS;

    for (const pawn of world.pawns.values()) {
      const distance = Math.hypot(pawn.pos.x - tile.x, pawn.pos.y - tile.y);
      if (distance < closest) {
        closest = distance;
        closestId = pawn.id;
      }
    }

    // Clicking empty ground clears the selection, which is what makes right-click
    // orders feel safe — there is always a way to put the mouse down.
    this.handlers.onSelect(closestId);
  }

  private order(tile: { x: number; y: number }): void {
    const selected = this.handlers.getSelected();
    if (selected === null) return;

    const target: TilePos = {
      x: Math.round(tile.x),
      y: Math.round(tile.y),
      z: GROUND_LEVEL,
    };

    const map = this.handlers.getWorld().map;
    if (!map.isPassable(target.x, target.y, target.z)) return;

    this.handlers.dispatch({ type: 'moveTo', pawnId: selected, target });
  }
}
