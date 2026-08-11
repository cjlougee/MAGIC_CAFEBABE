/**
 * A 3×5 bitmap font, for labelling the contact sheet.
 *
 * An unlabelled sheet of forty sprites is a puzzle, not a review: the whole point is
 * being able to say "the hearth at rotation 2" rather than "the fourth one on the third
 * row". Thirty-odd glyphs of three-by-five is the cheapest possible way to put the name
 * next to the thing, and it needs no font file, no measurement pass, and no dependency.
 */

const GLYPHS: Record<string, string> = {
  A: '111101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110',
  E: '111100111100111', F: '111100111100100', G: '111100101101111', H: '101101111101101',
  I: '111010010010111', J: '001001001101111', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '111101101101111', P: '111101111100100',
  Q: '111101101111001', R: '111101110101101', S: '111100111001111', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111',
  ' ': '000000000000000', '-': '000000111000000', ':': '000010000010000', '.': '000000000000010',
  '·': '000000010000000', '×': '000101010101000', '/': '001001010100100',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** One blank column between letters, so words do not run together at 1×. */
export const GLYPH_ADVANCE = GLYPH_W + 1;

export function textWidth(text: string, scale = 1): number {
  return text.length * GLYPH_ADVANCE * scale;
}

/**
 * Stamps a string into an RGBA buffer at (x, y), top-left of the first glyph.
 *
 * Clipped rather than wrapped: a label that runs off the sheet is a layout mistake worth
 * seeing as a truncated word, not one worth hiding by reflowing.
 */
export function drawText(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  colour: number,
  scale = 1,
): void {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;

  for (let i = 0; i < text.length; i++) {
    const bits = GLYPHS[text[i].toUpperCase()] ?? GLYPHS[' '];
    const originX = x + i * GLYPH_ADVANCE * scale;

    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits[row * GLYPH_W + col] !== '1') continue;

        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = originX + col * scale + sx;
            const py = y + row * scale + sy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const p = (py * width + px) * 4;
            rgba[p] = r;
            rgba[p + 1] = g;
            rgba[p + 2] = b;
            rgba[p + 3] = 255;
          }
        }
      }
    }
  }
}
