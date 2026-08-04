/**
 * Day/night wash.
 *
 * A single screen-sized multiply sprite tinted between white (noon, no effect) and a
 * cool blue (midnight). Cheap, and it does most of the work of making the world feel
 * alive — a static map with a ticking clock reads as a screenshot.
 *
 * M1 replaces the flat tint with a per-cell light grid so lamps and fires can cut
 * holes in the darkness. The interface stays the same.
 */

import { Sprite, Texture } from 'pixi.js';
import { mixColors, Palette } from '../art/palette';

/** How far toward night tint we go at full dark. Below 1 so night stays playable. */
const MAX_NIGHT_STRENGTH = 0.72;

export class LightingLayer {
  readonly sprite: Sprite;

  constructor() {
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.blendMode = 'multiply';
    this.sprite.eventMode = 'none';
  }

  /** `daylight` is 0 at full night, 1 at midday. */
  update(daylight: number, viewW: number, viewH: number): void {
    this.sprite.width = viewW;
    this.sprite.height = viewH;
    this.sprite.tint = mixColors(0xffffff, Palette.nightTint, (1 - daylight) * MAX_NIGHT_STRENGTH);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
