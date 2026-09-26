/**
 * @file colormaps.js — colour scales for the 3D view and the plots (pure functions, no three.js).
 *
 * Every colour does one job (see the data-viz method used for this project):
 *  - identity (categorical): the two yarn families and the reference curves, in a fixed slot order
 *    validated for the dark surface (#1a1a19): blue, orange, aqua, yellow;
 *  - magnitude (sequential): indigo → violet → magenta, dark → light, at maximum chroma. Yarns
 *    are drawn over a neutral silver mandrel whose rendered lightness spans almost the whole range
 *    (OKLab L ≈ 0.32–0.98), so only chroma can separate them from it. The ramp was chosen by
 *    measuring OKLab ΔE between tone-mapped ramp colours and rendered mandrel pixels: at every
 *    point of the ramp, 90 % of the mandrel area differs by ΔE ≥ 24 (the previous light-blue ramp
 *    fell to ΔE 4). The analogous hue shift (a permitted multi-hue sequential exception) avoids the
 *    orange / aqua / yellow / red that already mean "+" family, "−" family, geodesic and status;
 *  - polarity (diverging): blue ↔ red around a neutral gray midpoint, interpolated in OKLab so
 *    that lightness changes monotonically along each arm;
 *  - state (status): fixed good / warning / serious / critical colours, always shown with a label.
 * Colours are returned as sRGB triples in [0, 1]; the 3D view converts them to linear RGB.
 */

/** Categorical slots (dark mode) — order is fixed, never cycled. */
export const SERIES = Object.freeze({
  quasiStatic: "#3987e5", // slot 1 blue
  plus: "#d95926", // slot 2 orange — "+" family
  minus: "#199e70", // slot 3 aqua   — "−" family
  geodesic: "#c98500", // slot 4 yellow
});

/** Neutral inks. */
export const INK = Object.freeze({
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  surface: "#1a1a19",
});

/** Axial yarns (not a plotted series) use the secondary ink. */
export const AXIAL_COLOR = "#c3c2b7";

/** Status colours (reserved meaning; always paired with a label). */
export const STATUS = Object.freeze({
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
});

/**
 * Sequential ramp, dark → light: OKLCH L 0.38 → 0.70, hue 270° → 335°, chroma at 95 % of the sRGB
 * gamut limit (7 stops, interpolated in OKLab). See the header for how it was chosen.
 */
const SEQ = ["#2111bd", "#4815d1", "#6c18e1", "#911bec", "#b61eef", "#dc21ed", "#fb3edf"];

/** Diverging poles and neutral midpoint. */
const DIV_NEG = "#2a78d6", DIV_MID = "#c9c8c2", DIV_POS = "#e34948";

/** "#rrggbb" → sRGB triple in [0, 1]. */
export function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** sRGB triple in [0, 1] → "#rrggbb". */
export function rgbToHex(c) {
  return "#" +
    c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join(
      "",
    );
}

/** sRGB component → linear. */
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear component → sRGB. */
export const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB triple → OKLab (Björn Ottosson). */
export function rgbToOklab(c) {
  const [r, g, b] = c.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → sRGB triple (clamped to [0, 1]). */
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((x) => Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, x))))));
}

/** Interpolates two hex colours in OKLab. */
export function mixOklab(hexA, hexB, t) {
  const A = rgbToOklab(hexToRgb(hexA)), B = rgbToOklab(hexToRgb(hexB));
  return oklabToRgb([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]);
}

/** Piecewise-linear sampling of a hex ramp at t ∈ [0, 1] (interpolated in OKLab). */
function sampleRamp(ramp, t) {
  if (!Number.isFinite(t)) return hexToRgb("#898781"); // undefined values → neutral gray
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return mixOklab(ramp[i], ramp[i + 1], x - i);
}

/** Sequential scale: t ∈ [0, 1] → sRGB (dark indigo → light magenta). */
export const sequential = (t) => sampleRamp(SEQ, t);

/** Diverging scale: t ∈ [−1, 1] → sRGB (blue ← gray → red). */
export function diverging(t) {
  if (!Number.isFinite(t)) return hexToRgb("#898781");
  const u = Math.min(1, Math.max(-1, t));
  return u < 0 ? mixOklab(DIV_MID, DIV_NEG, -u) : mixOklab(DIV_MID, DIV_POS, u);
}

/** CSS linear-gradient for a colour bar of the given scale kind. */
export function rampCss(kind) {
  const n = 12, stops = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = kind === "diverging" ? diverging(2 * t - 1) : sequential(t);
    stops.push(`${rgbToHex(c)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
