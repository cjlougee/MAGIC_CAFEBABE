/**
 * View state: where we're looking and how closely.
 *
 * Held in *tile* coordinates rather than world pixels, so zoom changes don't drift the
 * centre and the simulation's coordinate space stays the single source of truth. All
 * projection maths lives in iso.ts; this class only composes it with zoom and viewport.
 */

import type { Container } from 'pixi.js';
import { MAX_ZOOM, MIN_ZOOM, VIEW_MARGIN_TILES } from '../constants';
import { tileToWorld, worldDeltaToTile, worldToTile } from '../iso';

export interface TileRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** An axis-aligned rectangle in world pixels (the projected space at zoom 1). */
export interface WorldRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export class Camera {
  /** Centre of the view, in tiles. */
  x: number;
  y: number;
  zoom: number;

  constructor(x: number, y: number, zoom: number) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }

  /** Pans by a screen-pixel delta. The world follows the cursor, so the camera opposes it. */
  panByScreen(dxScreen: number, dyScreen: number): void {
    this.moveByWorld(-dxScreen / this.zoom, -dyScreen / this.zoom);
  }

  /**
   * Moves by a delta in world pixels — i.e. in the direction it appears on screen.
   *
   * Callers think in screen directions ("scroll up"). Converting through the
   * projection here is what stops WASD from sliding diagonally along the tile axes,
   * which is what "up" would otherwise mean in an isometric view.
   */
  moveByWorld(dxWorld: number, dyWorld: number): void {
    const delta = worldDeltaToTile(dxWorld, dyWorld);
    this.x += delta.x;
    this.y += delta.y;
  }

  /**
   * Zooms while holding the tile under the cursor in place — the behaviour that makes
   * wheel-zoom feel like it's tracking your attention rather than the screen centre.
   */
  zoomAt(factor: number, screenX: number, screenY: number, viewW: number, viewH: number): void {
    const before = this.screenToTile(screenX, screenY, viewW, viewH);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const after = this.screenToTile(screenX, screenY, viewW, viewH);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /**
   * Jumps straight to a zoom level, holding the view centre.
   *
   * Only the debug panel uses this — ordinary zooming goes through `zoomAt`, which
   * tracks the cursor. It clamps to the same bounds rather than taking a shortcut past
   * them: below MIN_ZOOM the ground layer pools a sprite per visible tile over a
   * quarter-million-cell map, and a debug control that can lock up the browser is worse
   * than no debug control.
   */
  setZoom(zoom: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  /** Fractional tile coordinates under a screen point. Used for picking. */
  screenToTile(
    screenX: number,
    screenY: number,
    viewW: number,
    viewH: number,
  ): { x: number; y: number } {
    const centre = tileToWorld(this.x, this.y);
    return worldToTile(
      (screenX - viewW / 2) / this.zoom + centre.x,
      (screenY - viewH / 2) / this.zoom + centre.y,
    );
  }

  /** The viewport in world pixels. */
  visibleWorld(viewW: number, viewH: number): WorldRect {
    const centre = tileToWorld(this.x, this.y);
    const halfW = viewW / 2 / this.zoom;
    const halfH = viewH / 2 / this.zoom;
    return {
      x0: centre.x - halfW,
      y0: centre.y - halfH,
      x1: centre.x + halfW,
      y1: centre.y + halfH,
    };
  }

  /**
   * Tile-space bounding box of the viewport.
   *
   * The visible region is a *diamond* in tile space, so its bounding box necessarily
   * includes tiles that aren't on screen — roughly twice as many as are drawn. This is
   * the search space, not the draw list: TerrainLayer discards the corners with a cheap
   * per-tile rejection against visibleWorld().
   */
  visibleTiles(viewW: number, viewH: number, mapWidth: number, mapHeight: number): TileRect {
    const world = this.visibleWorld(viewW, viewH);
    const corners = [
      worldToTile(world.x0, world.y0),
      worldToTile(world.x1, world.y0),
      worldToTile(world.x0, world.y1),
      worldToTile(world.x1, world.y1),
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }

    return {
      x0: Math.max(0, Math.floor(minX) - VIEW_MARGIN_TILES),
      y0: Math.max(0, Math.floor(minY) - VIEW_MARGIN_TILES),
      x1: Math.min(mapWidth - 1, Math.ceil(maxX) + VIEW_MARGIN_TILES),
      y1: Math.min(mapHeight - 1, Math.ceil(maxY) + VIEW_MARGIN_TILES),
    };
  }

  /** Keeps the centre inside the map so the world can't be lost off-screen. */
  clampTo(mapWidth: number, mapHeight: number): void {
    this.x = Math.max(0, Math.min(mapWidth, this.x));
    this.y = Math.max(0, Math.min(mapHeight, this.y));
  }

  /**
   * Positions the world container so `this.x/y` sits at the centre of the screen.
   *
   * Rounded to whole device pixels. Tile textures sample with nearest-neighbour, so a
   * fractional offset makes every diamond land a fraction of a pixel off its
   * neighbour, and the edges show as a faint grid over the whole map. Rounding costs
   * sub-pixel smoothness while panning and buys clean tessellation, which is the right
   * trade for pixel art.
   */
  applyTo(world: Container, viewW: number, viewH: number): void {
    const centre = tileToWorld(this.x, this.y);
    world.scale.set(this.zoom);
    world.position.set(
      Math.round(viewW / 2 - centre.x * this.zoom),
      Math.round(viewH / 2 - centre.y * this.zoom),
    );
  }
}
