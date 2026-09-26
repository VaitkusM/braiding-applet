/**
 * @file scales.js — value ranges of the scalar colourings (pure functions, no three.js / DOM).
 *
 * A colour scale maps a value v to a ramp position t = pivotScale(v, min, mid, max) (colormaps.js):
 * [min, mid] → [0, ½], [mid, max] → [½, 1]. Its range {min, mid, max} comes from a SCALE SPEC
 *   { mode: "data" | "custom" | "full" (yarns) or "auto" | "custom" (mandrel), min, mid, max }.
 *
 * Yarn colourings (values in display units):
 *   alpha     |α| [°]                 full: 0 … 90
 *   slip      |κg/κn| / μ [× μ]       full: 0 … 1 (values above 1 slip and are drawn in status red)
 *   kn        κn [1/m]                full: all normal curvatures the mandrel can produce, i.e. the
 *                                     range of its principal curvatures (Euler's formula)
 *   kg        κg [1/m]                full: ±κ_max, the largest |principal curvature| of the mandrel
 *                                     (a path that does not slip has |κg| ≤ μ κn ≤ κ_max for μ ≤ 1)
 *   pressure  p = T κn [N/m]          full: T × the κn range
 * "data" spans the values of the deposited bias yarns (tie samples and axial yarns excluded).
 * For signed quantities (κn, κg, p) whose range contains both signs, the midpoint is 0, so the
 * colour still tells the sign; otherwise it is the centre of the range.
 *
 * Mandrel colourings (K, H) use the diverging ramp; "auto" is symmetric about 0 (±max |value| on
 * this mandrel), "custom" takes min / mid / max with mid at the neutral colour.
 */

const DEG = 180 / Math.PI;

/**
 * @typedef {{min:number, mid:number, max:number}} Range
 * @typedef {{mode:string, min?:number, mid?:number, max?:number}} ScaleSpec
 * @typedef {{mu:number, tension:number, knMin:number, knMax:number, kAbsMax:number}} ScaleContext
 *   knMin/knMax: range of the principal curvatures over the mandrel; kAbsMax: max |principal|.
 */

/** Yarn colourings with a continuous scale. */
export const YARN_SCALES = Object.freeze({
  alpha: {
    label: "Braid angle |α| from the meridian",
    unit: "°",
    signed: false,
    /** @param {import("../core/yarnPath.js").YarnPath} y @param {number} i */
    value: (y, i) => Math.abs(y.alpha[i]) * DEG,
    full: () => ({ min: 0, mid: 45, max: 90 }),
  },
  slip: {
    label: "Slip ratio |κg/κn| relative to μ",
    unit: "× μ",
    signed: false,
    value: (y, i, ctx) => (ctx.mu > 0 ? Math.abs(y.slip[i]) / ctx.mu : NaN),
    full: () => ({ min: 0, mid: 0.5, max: 1 }),
    cap: 1, // values above slip (status colour); the scale never extends beyond
  },
  kn: {
    label: "Normal curvature κn (convex > 0)",
    unit: "1/m",
    signed: true,
    value: (y, i) => y.kn[i],
    full: (ctx) => signedRange(ctx.knMin, ctx.knMax),
  },
  kg: {
    label: "Geodesic curvature κg",
    unit: "1/m",
    signed: true,
    value: (y, i) => y.kg[i],
    full: (ctx) => signedRange(-ctx.kAbsMax, ctx.kAbsMax),
  },
  pressure: {
    label: "Contact pressure p = T κn",
    unit: "N/m",
    signed: true,
    value: (y, i, ctx) => ctx.tension * y.kn[i],
    full: (ctx) => signedRange(ctx.tension * ctx.knMin, ctx.tension * ctx.knMax),
  },
});

/** Scale modes offered for yarn colourings. */
export const YARN_SCALE_MODES = Object.freeze({
  data: "Range of this run (auto)",
  custom: "Custom range (min / mid / max)",
  full: "Full range",
});

/** Scale modes offered for mandrel colourings. */
export const MANDREL_SCALE_MODES = Object.freeze({
  auto: "Range of this mandrel (auto)",
  custom: "Custom range (min / mid / max)",
});

/**
 * Range with midpoint 0 if it contains both signs, otherwise its centre; degenerate ranges are
 * widened so that min < max.
 * @param {number} lo @param {number} hi @returns {Range}
 */
export function signedRange(lo, hi) {
  if (!(hi > lo)) {
    const w = Math.max(Math.abs(lo), 1) * 1e-3;
    lo -= w;
    hi += w;
  }
  return { min: lo, mid: lo < 0 && hi > 0 ? 0 : 0.5 * (lo + hi), max: hi };
}

/**
 * Effective range of a yarn colouring.
 * @param {keyof YARN_SCALES} key
 * @param {ScaleSpec} spec
 * @param {{min:number, max:number}} data  running min/max of the colouring's values (may be empty)
 * @param {ScaleContext} ctx
 * @returns {Range}
 */
export function yarnRange(key, spec, data, ctx) {
  const def = YARN_SCALES[key];
  const full = def.full(ctx);
  if (spec.mode === "custom") return { min: spec.min, mid: spec.mid, max: spec.max };
  if (spec.mode !== "data" || !(data.max >= data.min)) return full;
  let lo = data.min, hi = data.max;
  if (def.cap !== undefined) {
    hi = Math.min(hi, def.cap);
    lo = Math.min(lo, hi);
  }
  // Never narrower than 2 % of the full range (keeps the ramp readable for near-constant data).
  const minSpan = 0.02 * (full.max - full.min);
  if (hi - lo < minSpan) {
    const c = 0.5 * (lo + hi);
    lo = c - minSpan / 2;
    hi = c + minSpan / 2;
    if (!def.signed && lo < full.min) [lo, hi] = [full.min, full.min + minSpan];
  }
  if (!def.signed) return { min: lo, mid: 0.5 * (lo + hi), max: hi };
  return signedRange(lo, hi);
}

/**
 * Effective range of a mandrel colouring (diverging, neutral at mid).
 * @param {ScaleSpec} spec @param {{min:number, max:number}} values over the mandrel
 * @returns {Range}
 */
export function mandrelRange(spec, values) {
  if (spec.mode === "custom") return { min: spec.min, mid: spec.mid, max: spec.max };
  const m = Math.max(Math.abs(values.min), Math.abs(values.max));
  const M = m > 0 ? m : 1;
  return { min: -M, mid: 0, max: M };
}

/** A "nice" slider step (1, 2 or 5 × 10^k) of about span / 200. */
export function niceStep(span) {
  const raw = Math.abs(span) / 200;
  if (!(raw > 0) || !Number.isFinite(raw)) return 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : 5) * mag;
}

/**
 * Slider bounds for a custom range: the union of the full range and the current range, rounded
 * outwards to the step.
 * @param {Range} full @param {Range} current @returns {{lo:number, hi:number, step:number}}
 */
export function sliderBounds(full, current) {
  let lo = Math.min(full.min, current.min), hi = Math.max(full.max, current.max);
  if (!(hi > lo)) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  return { lo, hi, step };
}

/** Rounds a value to the step grid (avoids float noise such as 0.30000000000000004). */
export const snap = (v, step) => Number((Math.round(v / step) * step).toPrecision(12));

/**
 * Keeps lo ≤ min < mid < max ≤ hi (at least one step apart) after bound `moved` changed; the
 * other bounds give way. Returns a new spec.
 * @param {{min:number, mid:number, max:number}} s @param {"min"|"mid"|"max"} moved
 * @param {{lo:number, hi:number, step:number}} b
 */
export function orderBounds(s, moved, b) {
  const g = b.step, c = (v) => Math.min(b.hi, Math.max(b.lo, v));
  let { min, mid, max } = { min: c(s.min), mid: c(s.mid), max: c(s.max) };
  if (moved === "min") {
    min = Math.min(min, b.hi - 2 * g);
    mid = Math.min(Math.max(mid, min + g), b.hi - g);
    max = Math.max(max, mid + g);
  } else if (moved === "max") {
    max = Math.max(max, b.lo + 2 * g);
    mid = Math.max(Math.min(mid, max - g), b.lo + g);
    min = Math.min(min, mid - g);
  } else {
    mid = Math.min(Math.max(mid, b.lo + g), b.hi - g);
    min = Math.min(min, mid - g);
    max = Math.max(max, mid + g);
  }
  return { ...s, min: snap(min, g), mid: snap(mid, g), max: snap(max, g) };
}

/** Running min/max of every yarn colouring (fed with the samples that are drawn). */
export class RangeTracker {
  constructor() {
    /** @type {Record<string, {min:number, max:number}>} */
    this.r = {};
    for (const k of Object.keys(YARN_SCALES)) this.r[k] = { min: Infinity, max: -Infinity };
  }

  /**
   * @param {import("../core/yarnPath.js").YarnPath} y @param {number} i @param {ScaleContext} ctx
   */
  add(y, i, ctx) {
    for (const [k, def] of Object.entries(YARN_SCALES)) {
      const v = def.value(y, i, ctx);
      if (!Number.isFinite(v)) continue;
      const r = this.r[k];
      if (v < r.min) r.min = v;
      if (v > r.max) r.max = v;
    }
  }

  get(k) {
    return this.r[k];
  }
}

/**
 * Principal-curvature ranges of a mandrel profile (sampled), for the "full" yarn scales.
 * @param {{length:number, evaluate:(z:number)=>{r:number, dr:number, d2r:number}}} profile
 * @param {number} [n=400]
 * @returns {{knMin:number, knMax:number, kAbsMax:number}}
 */
export function curvatureRanges(profile, n = 400) {
  let knMin = Infinity, knMax = -Infinity, kAbsMax = 0;
  for (let i = 0; i <= n; i++) {
    const { r, dr, d2r } = profile.evaluate((i / n) * profile.length);
    const q2 = 1 + dr * dr;
    const km = -d2r / (q2 * Math.sqrt(q2)), kp = 1 / (r * Math.sqrt(q2));
    knMin = Math.min(knMin, km, kp);
    knMax = Math.max(knMax, km, kp);
    kAbsMax = Math.max(kAbsMax, Math.abs(km), Math.abs(kp));
  }
  return { knMin, knMax, kAbsMax };
}
