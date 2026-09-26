/** Colour-scale sanity: monotone lightness (sequential, each diverging arm), neutral midpoint. */
import {
  curvatureMap,
  hexToRgb,
  mixOklab,
  pivotScale,
  rgbToHex,
  rgbToOklab,
  sequential,
} from "../src/view/colormaps.js";
import { assert, assertClose } from "./assert.js";

const L = (rgb) => rgbToOklab(rgb)[0];

Deno.test("colormaps: sequential lightness increases monotonically", () => {
  let prev = -1;
  for (let i = 0; i <= 50; i++) {
    const l = L(sequential(i / 50));
    assert(l > prev, `monotone at ${i}`);
    prev = l;
  }
});

Deno.test("colormaps: curvature map reproduces geo-framework's colorMap exactly", () => {
  // Literal port of geo-framework visualization.cc: HSV2RGB and colorMap(min, max, d).
  const HSV2RGB = ([h0, sat, val]) => {
    const c = val * sat, h = h0 / 60, x = c * (1 - Math.abs((h % 2) - 1)), m = val - c;
    const add = (v) => [m + v[0], m + v[1], m + v[2]];
    if (h <= 1) return add([c, x, 0]);
    if (h <= 2) return add([x, c, 0]);
    if (h <= 3) return add([0, c, x]);
    if (h <= 4) return add([0, x, c]);
    if (h <= 5) return add([x, 0, c]);
    if (h <= 6) return add([c, 0, x]);
    return [m, m, m];
  };
  const colorMap = (min, max, d) => {
    const red = 0, green = 120, blue = 240;
    if (d < 0) {
      const alpha = min ? Math.min(d / min, 1) : 1;
      return HSV2RGB([green * (1 - alpha) + blue * alpha, 1, 1]);
    }
    const alpha = max ? Math.min(d / max, 1) : 1;
    return HSV2RGB([green * (1 - alpha) + red * alpha, 1, 1]);
  };
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 4000; n++) {
    const min = -rnd() * 50, max = rnd() * 80, d = (rnd() - 0.4) * 140;
    const ours = curvatureMap(pivotScale(d, min, 0, max)), ref = colorMap(min, max, d);
    for (let k = 0; k < 3; k++) assertClose(ours[k], ref[k], 1e-12, `d=${d} min=${min} max=${max}`);
  }
  assert(rgbToHex(curvatureMap(0)) === "#0000ff", "most negative: blue");
  assert(rgbToHex(curvatureMap(0.5)) === "#00ff00", "zero: green");
  assert(rgbToHex(curvatureMap(1)) === "#ff0000", "most positive: red");
  assert(
    rgbToHex(curvatureMap(0.25)) === "#00ffff" && rgbToHex(curvatureMap(0.75)) === "#ffff00",
    "cyan / yellow",
  );
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

Deno.test("colormaps: pivot scale maps min/mid/max to 0/½/1, piecewise linear, clamped", () => {
  assertClose(pivotScale(30, 30, 40, 60), 0, 0);
  assertClose(pivotScale(40, 30, 40, 60), 0.5, 0);
  assertClose(pivotScale(60, 30, 40, 60), 1, 0);
  assertClose(pivotScale(35, 30, 40, 60), 0.25, 1e-15);
  assertClose(pivotScale(50, 30, 40, 60), 0.75, 1e-15);
  assertClose(pivotScale(10, 30, 40, 60), 0, 0); // clamped below
  assertClose(pivotScale(80, 30, 40, 60), 1, 0); // clamped above
  assertClose(pivotScale(45, 0, 45, 90), 0.5, 0); // symmetric mid = linear
  assertClose(pivotScale(5, 7, 7, 7), 0.5, 0); // degenerate range
  assert(Number.isNaN(pivotScale(NaN, 0, 1, 2)), "NaN passes through");
});
