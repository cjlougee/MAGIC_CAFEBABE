/**
 * RGBA to PNG, in about sixty lines over `node:zlib`.
 *
 * No dependency, because none is warranted: a PNG is a signature, three chunks, and a
 * CRC. Adding `sharp` or `pngjs` to write one file would put a native build step between
 * a developer and looking at the art, which is the exact cost this milestone exists to
 * remove.
 *
 * **In `tools/`, not `src/`.** `node:zlib` has no business inside code the browser
 * bundles, and keeping the boundary physical means nobody has to remember it.
 */

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Buffer {
  // Each scanline is prefixed with its filter type. Zero — "none" — because the art is
  // flat colour with hard edges, where predictive filters buy almost nothing and cost
  // clarity in a file somebody may well have to debug by hand.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    for (let i = 0; i < width * 4; i++) raw[at + 1 + i] = rgba[y * width * 4 + i];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
