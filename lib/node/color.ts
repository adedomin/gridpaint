import { NAMED_COLORS } from "./name_colors.js";

function splitCSSColorFun(str: string): number[] {
  function* scan(str: string): Generator<number, undefined, undefined> {
    start: for (let i = 0; i < str.length; ++i) {
      let chr = str.charCodeAt(i);
      if (chr > 47 && chr < 59) {
        for (let j = i; j < str.length; ++j) {
          let chr = str.charCodeAt(j);
          if (!(chr > 47 && chr < 59) && !(chr === 46 || chr == 37)) {
            yield parseFloat(str.slice(i, j));
            i = j + 1;
            continue start;
          } else if (chr == 37) { // parse CSS percent colors (alpha usually).
            let num = parseFloat(str.slice(i, j));
            yield num / 100;
            i = j + 1;
            continue start;
          }
        }
        yield parseFloat(str.slice(i));
        break start;
      }
    }
  }
  return [...scan(str)];
}

const HSL_EXTRACT = {
  R: 0,
  G: 8,
  B: 4,
} as const;
type HslExtract = (typeof HSL_EXTRACT)[keyof typeof HSL_EXTRACT];

// SEE: https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB_alternative
function HSLtoRGBPart(h: number, s: number, l: number, n: HslExtract): number {
  const k = (n + h / 30 ) % 12;
  const a = s * Math.min(l, 1 - l);
  return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
}

/**
 * A low quality CSS color parser.
 * only supports legacy style rgb(), rgba(), hsl() and hex formatted CSS colors.
 * 
 * ISSUE: Does not support exotic units like: turn, deg.
 *        Does not support /.
 *        Definitely does not support from syntax and nested colors.
 *        Does not support LAB, OKLAB, HWB and other modern color functions.
 */
export function cssColorValueToUint32(str: string): number {
  const num = new ArrayBuffer(4);
  const num_view = new DataView(num);
  if (!str) return 0x000000;
  if (str.startsWith("#")) {
    if (str.length === 4 || str.length == 5) {
      // #RGB
      const red = parseInt(str[1], 16);
      num_view.setUint8(0, (red << 4) | red); // red
      const green = parseInt(str[2], 16);
      num_view.setUint8(1, (green << 4) | green); // green
      const blue = parseInt(str[3], 16);
      num_view.setUint8(2, (blue << 4) | blue); // blue
      // #RGBA
      if (str.length === 5) {
        const alpha = parseInt(str[4], 16);
        num_view.setUint8(3, (alpha << 4) | alpha);
      } else {
        num_view.setUint8(3, 0xFF | 0); // alpha
      }
    } else if (str.length === 7) {
      // #RRGGBB
      num_view.setUint32(0, (parseInt(str.slice(1), 16) << 8) | 0xFF , false);
    } else if (str.length === 9) {
      // #RRGGBBAA
      num_view.setUint32(0, parseInt(str.slice(1), 16) | 0, false);
    }
  } else if (str.startsWith("rgb")) {
    const [r, g, b, a] = splitCSSColorFun(str);
    num_view.setUint8(0, r | 0);
    num_view.setUint8(1, g | 0);
    num_view.setUint8(2, b | 0);
    if (a !== undefined) {
      num_view.setUint8(3, Math.floor(a * 0xFF) | 0);
    } else {
      num_view.setUint8(3, 0xFF | 0);
    }
  } else if (str.startsWith('hsl')) {
    // SEE: https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB_alternative
    const [h, s, l, a] = splitCSSColorFun(str);
    const f = HSLtoRGBPart.bind(undefined, h, s, l);
    num_view.setUint8(0, f(HSL_EXTRACT.R) | 0);
    num_view.setUint8(1, f(HSL_EXTRACT.G) | 0);
    num_view.setUint8(2, f(HSL_EXTRACT.B) | 0);
    if (a !== undefined) {
      num_view.setUint8(3, Math.floor(a * 0xFF) | 0);
    } else {
      num_view.setUint8(3, 0xFF | 0);
    }
  } else if (Object.hasOwnProperty.call(NAMED_COLORS, str)) {
    return NAMED_COLORS[(str as keyof typeof NAMED_COLORS)];
  } else {
    throw new Error("unknown style format: " + str);
  }
  return num_view.getUint32(0, false);
}
