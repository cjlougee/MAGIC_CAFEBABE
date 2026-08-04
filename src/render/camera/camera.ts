/**
 * View state: where we're looking and how closely.
 *
 * Held in tile coordinates rather than pixels, so zoom changes don't drift the centre
 * and the simulation's coordinate space stays the single source of truth.
 */

import type { Container } from 'pixi.js';
import { MAX_ZOOM, MIN_ZOOM, TILE_SIZE, VIEW_MARGIN_TILES } from '../constants';

export interface TileRect {
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

  get pixelsPerTile(): number {
    return TILE_SIZE * this.zoom;
  }

  /** Pans by a screen-pixel delta, converting through the current zoom. */
  panByScreen(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.pixelsPerTile;
    this.y -= dyScreen / this.pixelsPerTile;
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

  screenToTile(
    screenX: number,
    screenY: number,
    viewW: number,
    viewH: number,
  ): { x: number; y: number } {
    const scale = this.pixelsPerTile;
    return {
      x: this.x + (screenX - viewW / 2) / scale,
      y: this.y + (screenY - viewH / 2) / scale,
    };
  }

  /** Keeps the centre inside the map so the world can't be lost off-screen. */
  clampTo(mapWidth: number, mapHeight: number): void {
    this.x = Math.max(0, Math.min(mapWidth, this.x));
    this.y = Math.max(0, Math.min(mapHeight, this.y));
  }

  /** Tiles currently visible, plus a margin. Drives culling. */
  visibleTiles(viewW: number, viewH: number, mapWidth: number, mapHeight: number): TileRect {
    const scale = this.pixelsPerTile;
    const halfW = viewW / 2 / scale;
    const halfH = viewH / 2 / scale;

    return {
      x0: Math.max(0, Math.floor(this.x - halfW) - VIEW_MARGIN_TILES),
      y0: Math.max(0, Math.floor(this.y - halfH) - VIEW_MARGIN_TILES),
      x1: Math.min(mapWidth - 1, Math.ceil(this.x + halfW) + VIEW_MARGIN_TILES),
      y1: Math.min(mapHeight - 1, Math.ceil(this.y + halfH) + VIEW_MARGIN_TILES),
    };
  }

  /** Positions the world container so `this.x/y` sits at the centre of the screen. */
  applyTo(world: Container, viewW: number, viewH: number): void {
    const scale = this.pixelsPerTile;
    world.scale.set(scale / TILE_SIZE);
    world.position.set(viewW / 2 - this.x * scale, viewH / 2 - this.y * scale);
  }
}
