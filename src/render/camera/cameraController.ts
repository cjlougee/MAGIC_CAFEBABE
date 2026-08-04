/**
 * Camera input: drag to pan, wheel to zoom, WASD/arrows to scroll.
 *
 * Camera state is pure presentation — it never becomes a Command, because where the
 * player is looking is not part of the simulation and must not affect it.
 */

import type { Camera } from './camera';

const KEY_PAN_TILES_PER_SECOND = 18;
const ZOOM_STEP = 1.12;

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export class CameraController {
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly held = new Set<string>();

  constructor(
    private readonly camera: Camera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
  }

  /** Applies held-key panning. Called once per rendered frame. */
  update(dtMs: number, mapWidth: number, mapHeight: number): void {
    let dx = 0;
    let dy = 0;
    for (const code of this.held) {
      const dir = PAN_KEYS[code];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }

    if (dx !== 0 || dy !== 0) {
      // Divided by zoom so panning covers the same on-screen distance at any zoom.
      const distance = (KEY_PAN_TILES_PER_SECOND * dtMs) / 1000 / this.camera.zoom;
      this.camera.x += dx * distance;
      this.camera.y += dy * distance;
    }

    this.camera.clampTo(mapWidth, mapHeight);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.camera.panByScreen(event.clientX - this.lastX, event.clientY - this.lastY);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const rect = this.canvas.getBoundingClientRect();
    this.camera.zoomAt(
      factor,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!PAN_KEYS[event.code]) return;
    // Don't steal arrow keys while the player is typing in a field.
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  /** Releasing keys on blur stops the camera drifting forever after an alt-tab. */
  private onBlur = (): void => {
    this.held.clear();
    this.dragging = false;
  };
}
