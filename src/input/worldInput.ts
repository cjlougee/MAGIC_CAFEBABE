/**
 * Turning clicks into intent.
 *
 * Left-click selects a colonist; right-click orders the selected one to walk. Selection
 * is *view* state and never enters the simulation — where the player's attention is
 * isn't part of the world. Movement orders do enter, as Commands, like every other
 * mutation.
 *
 * This is the first piece of the hybrid control model's direct-control half. In M2 the
 * same right-click becomes "preempt whatever you were doing and do this instead".
 */

import type { EntityId } from '../sim/core/entityStore';
import { GROUND_LEVEL, type TilePos } from '../sim/core/position';
import type { World } from '../sim/world/world';
import type { Camera } from '../render/camera/camera';

/**
 * Pointer travel, in pixels, above which a press counts as a camera drag rather than
 * a click. Without it, every pan ends by selecting or deselecting something.
 */
const CLICK_SLOP = 5;

/** How close to a pawn's tile a click must land to pick it, in tiles. */
const PICK_RADIUS = 0.9;

export interface WorldInputHandlers {
  readonly onSelect: (id: EntityId | null) => void;
  readonly onMoveOrder: (pawnId: EntityId, target: TilePos) => void;
  readonly getSelected: () => EntityId | null;
  readonly getWorld: () => World;
  readonly getViewSize: () => { width: number; height: number };
}

export class WorldInput {
  private downX = 0;
  private downY = 0;
  private downButton = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly handlers: WorldInputHandlers,
  ) {}

  attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (event: Event): void => {
    // Right-click is a game command here, not a browser menu.
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downButton = event.button;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== this.downButton) return;
    const travel = Math.hypot(event.clientX - this.downX, event.clientY - this.downY);
    this.downButton = -1;
    if (travel > CLICK_SLOP) return; // The player was panning, not clicking.

    const tile = this.tileUnder(event);
    if (event.button === 0) this.select(tile);
    else if (event.button === 2) this.order(tile);
  };

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

    this.handlers.onMoveOrder(selected, target);
  }
}
