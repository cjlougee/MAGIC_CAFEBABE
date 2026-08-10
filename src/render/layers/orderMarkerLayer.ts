/**
 * Where you just told somebody to go.
 *
 * Right-clicking the ground produced no acknowledgement of any kind: the order was
 * issued, the colonist eventually started walking, and in between the player had no way
 * to know whether the click had registered or missed. On a 512-tile map, with the target
 * often off the edge of the pawn's current view, "did that take?" is a question the
 * interface has to answer immediately.
 *
 * Pure view state with a lifetime — it is a receipt for an input, not a fact about the
 * world, so nothing here is saved, hashed, or known to `sim/`.
 */

import { Container, Sprite } from 'pixi.js';
import type { ArtProvider } from '../art/artProvider';
import { Palette } from '../art/palette';
import { HALF_TILE_H, HALF_TILE_W } from '../constants';
import { tileToWorld } from '../iso';

/** How long a marker lives. Long enough to notice, short enough not to litter the map. */
const LIFETIME_MS = 2000;

/** Full pulses of the tile fill over that lifetime. */
const PULSES = 3;

/** Brightest the tile fill ever gets. Never fully opaque — the ground stays readable. */
const PEAK_TILE_ALPHA = 0.5;

interface Marker {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  ageMs: number;
}

export class OrderMarkerLayer {
  readonly container = new Container();

  private readonly markers: Marker[] = [];
  private readonly fills: Sprite[] = [];

  constructor(private readonly art: ArtProvider) {
    this.container.eventMode = 'none';
    this.container.interactiveChildren = false;
  }

  /** Drops a marker. Called once per colonist ordered, so a party stamps its whole fan-out. */
  add(x: number, y: number, z: number): void {
    this.markers.push({ x, y, z, ageMs: 0 });
  }

  clear(): void {
    this.markers.length = 0;
  }

  /**
   * Advances every marker and draws it.
   *
   * `dtMs` is real elapsed time rather than ticks, deliberately: this is feedback about
   * a click, so it should run at the same speed whether the game is at 3x or paused.
   * A confirmation that freezes when you pause reads as a bug.
   */
  update(dtMs: number): void {
    for (const marker of this.markers) marker.ageMs += dtMs;
    // Reverse so removal cannot skip the element shuffled into the freed slot.
    for (let i = this.markers.length - 1; i >= 0; i--) {
      if (this.markers[i].ageMs >= LIFETIME_MS) this.markers.splice(i, 1);
    }

    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      const t = marker.ageMs / LIFETIME_MS;
      const world = tileToWorld(marker.x, marker.y, marker.z);

      /*
       * Cosine rather than a sawtooth, so the tile breathes instead of blinking.
       *
       * No separate fade-out envelope: a whole number of cycles lands back on zero by
       * itself, so the pulse ends without a cut. An envelope on top of that was worse
       * than useless — it crushed the second and third pulses to a quarter strength,
       * so what was asked for as three pulses read as one and a shrug.
       */
      const pulse = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * PULSES);
      const fill = this.fillAt(i);
      fill.position.set(world.x - HALF_TILE_W, world.y - HALF_TILE_H);
      fill.alpha = PEAK_TILE_ALPHA * pulse;
      fill.visible = true;
    }

    for (let i = this.markers.length; i < this.fills.length; i++) {
      this.fills[i].visible = false;
    }
  }

  private fillAt(index: number): Sprite {
    let sprite = this.fills[index];
    if (!sprite) {
      sprite = new Sprite(this.art.tilePulse());
      // The texture is white so one can serve any colour; the tint is what makes it cyan.
      sprite.tint = Palette.relic;
      this.container.addChild(sprite);
      this.fills[index] = sprite;
    }
    return sprite;
  }
}
