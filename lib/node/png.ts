import type { GridPaint as gp } from '../../index.js';
import { cssColorValueToUint32 } from './color.js';
import { crc32 } from './crc32.js';

import { deflateSync, constants } from 'node:zlib';
import { Buffer } from 'node:buffer';
// .PNG....
const MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
// ....IEND....
const IEND = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);


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

function encodePngChunk(type: PngType, data: Uint8Array): ArrayBuffer {
  let totalLen = (4 * 3) /* length + chunk name + crc */ + data.length;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  view.setUint32(0, data.length, false);
  view.setUint32(4, type, false);
  const viewx = new Uint8Array(buf);
  viewx.set(data, 8);

  // calc CRC, note that length is not a part of the CRC
  let crcOff = (4 * 2) /* length + chunk name */ + data.length;
  view.setUint32(crcOff, crc32(viewx.slice(4, crcOff)));
  return buf;
}

const COLOR_PALETTE = 0x3;
const COLOR_RGBA = 0x6;
const WIDTH_OFF = 0;
const HEIGHT_OFF = 4;
const BITDEPTH_OFF = 8;
const COLORTYPE_OFF = 9;
function makeIHDR(w: number, h: number, paletteLen: number): ArrayBuffer  {
  const buf = new ArrayBuffer(13);
  const view = new DataView(buf);
  view.setUint32(WIDTH_OFF, w, false);
  view.setUint32(HEIGHT_OFF, h, false);
  view.setUint8(BITDEPTH_OFF, 8);
  if (paletteLen > 0xFF) {
    view.setUint8(COLORTYPE_OFF, COLOR_RGBA);
  } else {
    view.setUint8(COLORTYPE_OFF, COLOR_PALETTE);
  }
  // 10, 11, 12 offsets should default to zero, which is their sane/default values.
  return encodePngChunk(PngTypes.IHDR, new Uint8Array(buf));
}

function makePallete(palette: number[]): ArrayBuffer {
  // move transparency to the front
  palette.sort((a, b) => {
    let aa = a & 0xFF;
    let ba = b & 0xFF;
    if (aa === ba) {
      if (a < b) {
        return -1;
      } else if (a === b) {
        return 0;
      } else {
        return 1;
      }
    } else if (aa < ba) {
      return -1;
    } else {
      return 1;
    }
  });

  let tRNSStop = palette.findIndex(color => (color & 0xFF) === 0xFF);
  if (tRNSStop === -1) {
    tRNSStop = palette.length;
  } 
  const totalLen = 12 /* LEN + PLTE + CRC */
    + (palette.length * 3) /* PLTE is 24bit colors (no alpha). */
    + 12 /* LEN + tRNS + CRC */
    + palette.length /* tRNS is just the 8bit Alpha channel. */
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  view.setUint32(0, palette.length, false);
  view.setUint32(4, PngTypes.PLTE, false);

  let i = 4;
  for (let color of palette) {
    // we will shingle these bad boys on so we avoid 16 + 8 setters.
    view.setUint32(i, color, false);
    i += 3; // palette colors are 24bit RGB.
  }
  view.setUint32(i, crc32(new Uint8Array(buf.slice(4, i))));
  i += 4;

  view.setUint32(i, tRNSStop, false);
  i += 4;
  let tRNSStart = i;
  view.setUint32(tRNSStart + 4, PngTypes.tRNS, false);
  i += 4;
  for (let color of palette) {
    view.setUint8(i, color & 0xFF);
    i += 1;
  }
  view.setUint32(i, crc32(new Uint8Array(buf.slice(tRNSStart, i))));
  return buf;
}

function idx1Dto2D(x: number, y: number, width: number): number {
  return x + y * width;
}

function makeIDAT(
  palette: number[],
  image: number[],
  w: number, h: number, cw: number, ch: number
): ArrayBuffer {
  let tw = w * cw;
  let th = h * ch;
  const buf = palette.length > 0xFF ? new ArrayBuffer(tw * th * 4) : new ArrayBuffer(tw * th);
  const view = new DataView(buf);
  for (let y = 0; y < h; ++y) {
    for (let x = 0; x < w; ++x) {
      const color_idx = image[idx1Dto2D(x, y, w)];
      const color = palette[color_idx];
      for (let py = y * ch; py < (py + ch); ++py) {
        for (let px = y * cw; px < (py + cw); ++px) {
          if (palette.length > 0xFF) {
            view.setUint32(idx1Dto2D(px, py, w * cw) * 4, color, false);
          } else {
            view.setUint8(idx1Dto2D(px, py, w * cw), color_idx);
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

export function makePng(gp: gp): ArrayBuffer {
  const palette = gp.palette.slice().map(cssColorValueToUint32);
  const ihdr = new Uint8Array(makeIHDR(gp.width * gp.cellWidth, gp.height * gp.cellHeight, palette.length));
  if (palette.length > 0xFF) {
    const plte_trns = new Uint8Array(makePallete(palette));
    const idat = new Uint8Array(makeIDAT(
      palette, gp.painting.flat(1),
      gp.width, gp.height,
      gp.cellWidth, gp.cellHeight
    ));
    return Buffer.concat([MAGIC, ihdr, plte_trns, idat, IEND]).buffer;
  } else {
    const idat = new Uint8Array(makeIDAT(
      palette, gp.painting.flat(1),
      gp.width, gp.height,
      gp.cellWidth, gp.cellHeight
    ));
    return Buffer.concat([MAGIC, ihdr, idat, IEND]).buffer;
  }
}
