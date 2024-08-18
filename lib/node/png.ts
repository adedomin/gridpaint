import type { GridPaint as gp } from '../../index.js';
import { cssColorValueToUint32 } from './color.js';
import { crc32 } from './crc32.js';

import { deflateSync, constants } from 'node:zlib';
import { Buffer } from 'node:buffer';
// .PNG....
const MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
// ....IEND....
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);


function chunkNameToInt(str: string): number {
  return Array
    .from(str, (chr, i) => chr.charCodeAt(0) << ((3-i) * 8))
    .reduce((acc, num) => acc | num, 0);
}

const PngTypes = {
  IHDR: chunkNameToInt("IHDR"),
  PLTE: chunkNameToInt("PLTE"),
  tRNS: chunkNameToInt("tRNS"),
  IDAT: chunkNameToInt("IDAT"),
  IEND: chunkNameToInt("IEND"),
} as const;
type PngType = (typeof PngTypes)[keyof typeof PngTypes];

function encodePngChunk(type: PngType, data: Buffer): Buffer {
  const buf = Buffer.alloc(8 /* length + header name */);
  buf.writeUInt32BE(data.length, 0);
  buf.writeUInt32BE(type, 4);
  // calc CRC, note that length is not a part of the CRC
  const crc = crc32(Buffer.concat([buf.subarray(4), data]));
  console.log(crc);
  const crcB = Buffer.alloc(4);
  crcB.writeUint32BE(crc);
  return Buffer.concat([buf, data, crcB]);
}

const COLOR_PALETTE = 0x3;
const COLOR_RGBA = 0x6;
const WIDTH_OFF = 0;
const HEIGHT_OFF = 4;
const BITDEPTH_OFF = 8;
const COLORTYPE_OFF = 9;
function makeIHDR(w: number, h: number, paletteLen: number): Buffer  {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(w, WIDTH_OFF);
  buf.writeUInt32BE(h, HEIGHT_OFF);
  buf.writeUInt8(8, BITDEPTH_OFF);
  if (paletteLen > 0xFF) {
    buf.writeUInt8(COLOR_RGBA, COLORTYPE_OFF);
  } else {
    buf.writeUInt8(COLOR_PALETTE, COLORTYPE_OFF);
  }
  return encodePngChunk(PngTypes.IHDR, buf);
}

function makePallete(palette: number[]): Buffer {
  const buf = Buffer.alloc(palette.length * 3 /* 24bit color */ + 1 /* we trim this byte off */);
  let i = 0;
  for (let color of palette) {
    // we will shingle these bad boys on so we avoid 16 + 8 setters.
    buf.writeUInt32BE(color, i);
    i += 3; // palette colors are 24bit RGB.
  }
  const buf_trunc = buf.subarray(0, buf.length - 1);
  const plte = encodePngChunk(PngTypes.PLTE, buf_trunc);
  
  const buf2 = Buffer.alloc(palette.length);
  i = 0;
  for (let color of palette) {
    buf2.writeUInt8(color & 0xFF, i);
    i += 1; // transparencies are only the 8bit alpha channel
  }
  const trns = encodePngChunk(PngTypes.tRNS, buf2);

  return Buffer.concat([plte, trns]);
}

function idx1Dto2D(x: number, y: number, width: number): number {
  return x + y * width;
}

function makeIDAT(
  palette: number[],
  image: number[][],
  cw: number, ch: number
): Buffer {
  const w = image[0]?.length;
  const h = image?.length;
  if (w == undefined || h == undefined) {
    return deflateSync(Buffer.alloc(0));
  }

  let tw = w * cw;
  let th = h * ch;
  const buf = palette.length > 0xFF ? Buffer.alloc(tw * th * 4) : Buffer.alloc(tw * th);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const color_idx = image[y][x];
      const color = palette[color_idx];

      const ystart = y * ch;
      const xstart = x * cw;
      for (let py = ystart; py < (ystart + ch); ++py) {
        for (let px = xstart; px < (xstart + cw); ++px) {
          if (palette.length > 0xFF) {
            buf.writeUInt32BE(color, idx1Dto2D(px, py, w * cw) * 4);
          } else {
            buf.writeUInt8(color_idx, idx1Dto2D(px, py, w * cw));
          }
        }
      }
    }
  }
  const bufz = deflateSync(buf, {
    level: constants.Z_BEST_COMPRESSION,
  });
  return encodePngChunk(PngTypes.IDAT, bufz);
}

export function makePng(gp: gp): Buffer {
  const palette = gp.palette.slice().map(cssColorValueToUint32);
  const ihdr = new Uint8Array(makeIHDR(gp.width * gp.cellWidth, gp.height * gp.cellHeight, palette.length));
  if (palette.length > 0xFF) {
    const idat = makeIDAT(
      palette, gp.painting,
      gp.cellWidth, gp.cellHeight
    );
    return Buffer.concat([MAGIC, ihdr, idat, IEND]);
  } else {
    const plte_trns = makePallete(palette);
    const idat = makeIDAT(
      palette, gp.painting,
      gp.cellWidth, gp.cellHeight
    );
    return Buffer.concat([MAGIC, ihdr, plte_trns, idat, IEND]);
  }
}
