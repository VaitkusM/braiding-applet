/** Colour-scale sanity: monotone lightness (sequential, each diverging arm), neutral midpoint. */
import {
  diverging,
  hexToRgb,
  mixOklab,
  rgbToHex,
  rgbToOklab,
  sequential,
} from "../src/view/colormaps.js";
import { assert, assertClose } from "./assert.js";

const L = (rgb) => rgbToOklab(rgb)[0];
const C = (rgb) => Math.hypot(rgbToOklab(rgb)[1], rgbToOklab(rgb)[2]);

Deno.test("colormaps: sequential lightness increases monotonically", () => {
  let prev = -1;
  for (let i = 0; i <= 50; i++) {
    const l = L(sequential(i / 50));
    assert(l > prev, `monotone at ${i}`);
    prev = l;
  }
});

Deno.test("colormaps: diverging arms are monotone and the midpoint is neutral", () => {
  assert(C(diverging(0)) < 0.02, "gray midpoint (low chroma)");
  for (const sign of [1, -1]) {
    let prev = Infinity;
    for (let i = 0; i <= 25; i++) {
      const l = L(diverging((sign * i) / 25));
      assert(l < prev + 1e-12, `arm ${sign} monotone at ${i}`);
      prev = l;
    }
  }
});

Deno.test("colormaps: OKLab round trip and hex helpers", () => {
  for (const hex of ["#3987e5", "#d95926", "#199e70", "#c98500", "#000000", "#ffffff"]) {
    assert(rgbToHex(mixOklab(hex, hex, 0.3)) === hex, `round trip ${hex}`);
  }
  assertClose(hexToRgb("#ff8000")[1], 128 / 255, 1e-12);
});

Deno.test("colormaps: every sequential colour is strongly chromatic (visible on the neutral mandrel)", () => {
  // The mandrel renders as a neutral gray over almost the whole lightness range, so yarn colours
  // must be separated from it by chroma (OKLab C), at every point of the ramp.
  for (let i = 0; i <= 50; i++) {
    const [, a, b] = rgbToOklab(sequential(i / 50));
    const chroma = Math.hypot(a, b);
    assert(chroma > 0.15, `chroma ${chroma.toFixed(3)} at t = ${i / 50}`);
  }
});
