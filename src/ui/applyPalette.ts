/**
 * Publishes the render palette as CSS custom properties.
 *
 * Canvas and DOM must not drift apart, and the cheapest way to guarantee that is to
 * have exactly one definition of every colour. palette.ts owns them; this hands them
 * to CSS as `--c-<name>`.
 */

import { Palette } from '../render/art/palette';

function toCssHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export function applyPaletteToCss(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(Palette)) {
    root.style.setProperty(`--c-${name}`, toCssHex(value));
  }
}
