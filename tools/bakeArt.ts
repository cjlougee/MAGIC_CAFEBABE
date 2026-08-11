/**
 * `npm run art` — every sprite, measured and drawn to disk in one command.
 *
 * This is the milestone's largest single saving. Judging a sprite used to mean: edit,
 * start a dev server, drive a browser to a review page, take a screenshot, squint. Five
 * round trips before an opinion, and in at least one session the screenshot leg simply
 * did not work. Now it is one command and one image on disk — no server, no browser, no
 * display, no race.
 *
 * It writes three things:
 *
 *  - `art/contact-sheet.png` — every sprite at every rotation, 3×, over an outline of the
 *    footprint cells it claims. The thing you actually look at.
 *  - `art/sprites/*.png` — one file each, at 1×, for diffing and for dropping into an
 *    issue.
 *  - `art/report.json` — every measurement the harness takes, so a regression can be
 *    read as a number rather than inferred from a picture.
 *
 * Contract violations are printed and set a non-zero exit code, so this is a check as
 * well as a review surface. `npm run check` still owns the authoritative gate; this is
 * the one you run while your hands are on the art.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spriteManifest, type SpriteEntry } from '../src/render/art/manifest';
import { footprintGround, footprintMask } from '../src/render/art/raster/footprintMask';
import { selfIntersections } from '../src/render/art/raster/geometry';
import {
  countMask,
  distinctColours,
  inkMask,
  maskBounds,
  outside,
  visibleCounts,
} from '../src/render/art/raster/measure';
import { rasterize, type Raster } from '../src/render/art/raster/raster';
import { Palette } from '../src/render/art/palette';
import { encodePng } from './png';
import { drawText, GLYPH_H } from './tinyFont';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'art');

const SCALE = 3;
const PAD = 8;
const LABEL_H = GLYPH_H * 2 + 6;
const HEADING_H = GLYPH_H * 2 + 10;
const GAP = 10;

const SHEET_BG = 0x243038;
const CELL_BG = 0x1b242a;
const OUTLINE = Palette.relic;

interface Measured {
  readonly sprite: SpriteEntry;
  readonly raster: Raster;
  readonly report: Record<string, unknown>;
  readonly problems: string[];
}

function measure(sprite: SpriteEntry): Measured {
  const list = sprite.draw();
  const raster = rasterize(list, sprite.width, sprite.height);

  const ink = inkMask(raster);
  const inkPx = countMask(ink);
  const box = maskBounds(ink, sprite.width);
  const counts = visibleCounts(raster, list.length);
  // Named, not just counted. "6 marks under the floor" sends the reader counting draw
  // calls; "bed leg 2 right, bed leg 2 left, ..." answers the question on the spot.
  const hidden = counts
    .map((visible, index) => ({ visible, label: list[index].label }))
    .filter(({ visible }) => visible < sprite.contract.minVisibleInk)
    .map(({ label }) => label);

  let overhang = 0;
  if (sprite.footprint && sprite.contract.containment === 'footprint') {
    const allowed = footprintMask(
      sprite.width,
      sprite.height,
      sprite.footprint.w,
      sprite.footprint.h,
      sprite.rise,
    );
    overhang = outside(ink, allowed) / Math.max(1, inkPx);
  }

  const problems: string[] = [];
  const faults = sprite.vector ? selfIntersections(sprite.vector()) : [];
  if (faults.length) {
    problems.push(`polygon ${faults[0].mark} crosses itself (edges ${faults[0].edges.join('/')})`);
  }
  const budget = sprite.contract.mayOverhang ?? 0;
  if (overhang > budget) {
    problems.push(
      `${(overhang * 100).toFixed(1)}% of ink outside the footprint, budget ${(budget * 100).toFixed(0)}%`,
    );
  }
  const declaredHidden = sprite.contract.mayHide?.count ?? 0;
  if (hidden.length !== declaredHidden) {
    problems.push(
      `${hidden.length} marks under the ${sprite.contract.minVisibleInk}px floor ` +
        `(${hidden.join(', ')}), declared ${declaredHidden}`,
    );
  }
  for (const mark of list) {
    const b = mark.coverage.bounds;
    if (b.x < 0 || b.y < 0 || b.x + b.width > sprite.width || b.y + b.height > sprite.height) {
      problems.push(`"${mark.label}" escapes the ${sprite.width}x${sprite.height} frame`);
      break;
    }
  }

  return {
    sprite,
    raster,
    problems,
    report: {
      key: sprite.key,
      frame: [sprite.width, sprite.height],
      rise: sprite.rise,
      footprint: sprite.footprint ?? null,
      marks: list.length,
      inkPx,
      coverage: +(inkPx / (sprite.width * sprite.height)).toFixed(3),
      inkBox: box && [box.x0, box.y0, box.x1, box.y1],
      tones: distinctColours(raster).size,
      thinnestMark: Math.min(...counts),
      hiddenMarks: hidden,
      thinnestMarkLabel: list[counts.indexOf(Math.min(...counts))]?.label ?? null,
      overhang: +overhang.toFixed(4),
      problems,
    },
  };
}

// ── Sheet composition ───────────────────────────────────────────────────────────

interface Canvas {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function canvas(width: number, height: number, background: number): Canvas {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (background >> 16) & 0xff;
    rgba[i * 4 + 1] = (background >> 8) & 0xff;
    rgba[i * 4 + 2] = background & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width, height };
}

function fillRect(c: Canvas, x: number, y: number, w: number, h: number, colour: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
      const p = (py * c.width + px) * 4;
      c.rgba[p] = (colour >> 16) & 0xff;
      c.rgba[p + 1] = (colour >> 8) & 0xff;
      c.rgba[p + 2] = colour & 0xff;
      c.rgba[p + 3] = 255;
    }
  }
}

/** Nearest-neighbour blit, source-over. Nearest because the art is pixel art. */
function blit(c: Canvas, src: Raster, x: number, y: number, scale: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const s = (sy * src.width + sx) * 4;
      const a = src.rgba[s + 3] / 255;
      if (a === 0) continue;

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x + sx * scale + dx;
          const py = y + sy * scale + dy;
          if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
          const p = (py * c.width + px) * 4;
          for (let ch = 0; ch < 3; ch++) {
            c.rgba[p + ch] = src.rgba[s + ch] * a + c.rgba[p + ch] * (1 - a);
          }
        }
      }
    }
  }
}

/**
 * The footprint's edge, drawn under the sprite.
 *
 * Art that escapes its footprint is the single most common thing that goes wrong, and at
 * play zoom it reads as nothing at all. Against an outline of the cells the structure
 * actually claims it is unmissable — which is what `sprites.html` proved the day it
 * existed, twice over.
 */
function outlineFootprint(c: Canvas, sprite: SpriteEntry, x: number, y: number): void {
  if (!sprite.footprint) return;
  const ground = footprintGround(
    sprite.width,
    sprite.height,
    sprite.footprint.w,
    sprite.footprint.h,
    sprite.rise,
  );

  for (let sy = 0; sy < sprite.height; sy++) {
    for (let sx = 0; sx < sprite.width; sx++) {
      if (!ground[sy * sprite.width + sx]) continue;
      // Boundary only: a filled diamond would hide the very overhang it is here to show.
      const edge =
        sx === 0 || sy === 0 || sx === sprite.width - 1 || sy === sprite.height - 1 ||
        !ground[sy * sprite.width + sx - 1] || !ground[sy * sprite.width + sx + 1] ||
        !ground[(sy - 1) * sprite.width + sx] || !ground[(sy + 1) * sprite.width + sx];
      if (edge) fillRect(c, x + sx * SCALE, y + sy * SCALE, SCALE, SCALE, OUTLINE);
    }
  }
}

function buildSheet(measured: Measured[]): Canvas {
  const groups = [...new Set(measured.map((m) => m.sprite.group))];
  const rows = groups.map((group) => measured.filter((m) => m.sprite.group === group));

  const rowWidth = (row: Measured[]) =>
    row.reduce((sum, m) => sum + m.sprite.width * SCALE + PAD * 2 + GAP, PAD);
  const rowHeight = (row: Measured[]) =>
    Math.max(...row.map((m) => m.sprite.height * SCALE + PAD * 2)) + LABEL_H + HEADING_H + GAP;

  const width = Math.max(...rows.map(rowWidth), 400);
  const height = rows.reduce((sum, row) => sum + rowHeight(row), PAD * 2);
  const sheet = canvas(width, height, SHEET_BG);

  let y = PAD;
  for (const row of rows) {
    const { sprite } = row[0];
    const size = sprite.footprint ? `${sprite.footprint.w}x${sprite.footprint.h}` : 'free';
    drawText(
      sheet.rgba, width, height,
      `${sprite.group}  ${size}  RISE ${sprite.rise}`,
      PAD, y, Palette.text, 2,
    );
    y += HEADING_H;

    const tallest = Math.max(...row.map((m) => m.sprite.height * SCALE + PAD * 2));
    let x = PAD;
    for (const m of row) {
      const cellW = m.sprite.width * SCALE + PAD * 2;
      const cellH = m.sprite.height * SCALE + PAD * 2;
      // Bottom-aligned, so a row of different heights shares a ground line and the eye
      // can compare how far each thing rises.
      const cellY = y + tallest - cellH;

      fillRect(sheet, x, cellY, cellW, cellH, CELL_BG);
      outlineFootprint(sheet, m.sprite, x + PAD, cellY + PAD);
      blit(sheet, m.raster, x + PAD, cellY + PAD, SCALE);

      // A failing sprite says so on the sheet, in the palette's own alarm colour.
      const label = m.problems.length ? `${m.sprite.label} !` : m.sprite.label;
      const colour = m.problems.length ? Palette.danger : Palette.textDim;
      drawText(sheet.rgba, width, height, label, x + PAD, y + tallest + 4, colour, 2);

      x += cellW + GAP;
    }

    y += tallest + LABEL_H + GAP;
  }

  return sheet;
}

// ── Run ─────────────────────────────────────────────────────────────────────────

const started = Date.now();
const manifest = spriteManifest();
const measured = manifest.map(measure);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'sprites'), { recursive: true });

for (const m of measured) {
  writeFileSync(
    join(OUT, 'sprites', `${m.sprite.key.replace(/:/g, '-')}.png`),
    encodePng(m.raster.rgba, m.raster.width, m.raster.height),
  );
}

const sheet = buildSheet(measured);
writeFileSync(join(OUT, 'contact-sheet.png'), encodePng(sheet.rgba, sheet.width, sheet.height));
writeFileSync(
  join(OUT, 'report.json'),
  JSON.stringify({ generated: new Date().toISOString(), sprites: measured.map((m) => m.report) }, null, 2),
);

const failing = measured.filter((m) => m.problems.length);
const ms = Date.now() - started;

console.log(`${measured.length} sprites → art/contact-sheet.png (${sheet.width}x${sheet.height}) in ${ms}ms`);
console.log(`  art/sprites/*.png, art/report.json`);

if (failing.length) {
  console.log(`\n${failing.length} sprite(s) break their contract:`);
  for (const m of failing) {
    console.log(`  ${m.sprite.key}: ${m.problems.join('; ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`  all ${measured.length} within contract`);
}

