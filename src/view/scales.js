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
 *                                     range of its principal curvatures (Euler's formula), with 0
 *   kg        κg [1/m]                full: ±κ_max, the largest |principal curvature| of the mandrel
 *                                     (a path that does not slip has |κg| ≤ μ κn ≤ κ_max for μ ≤ 1)
 *   pressure  p = T κn [N/m]          full: T × the principal-curvature range
 * "data" spans the values of the deposited bias yarns (tie samples and axial yarns excluded).
 *
 * Two kinds of scale:
 *  - sequential (α, slip, p): range [min, max] with its centre as midpoint — except that a signed
 *    quantity whose range contains both signs uses 0 as midpoint, so the colour still tells the sign;
 *  - CURVATURE MAPS (κn, κg on the yarns; K, H on the mandrel): the blue–green–red convention of
 *    geo-framework — green is always 0 (min ≤ 0 ≤ max) and each sign is scaled separately by its
 *    own extent. If only one sign occurs, that side alone is used (the colour bar shows half the
 *    ramp). Unlike geo-framework no percentile cut-off is applied, but an extent never shrinks below
 *    2 % of the largest possible magnitude, so numerical noise around 0 is not stretched to full
 *    blue / red.
 * Mandrel colourings (K, H): "auto" = the range of the values on this mandrel (as above),
 * "custom" = min / mid / max with mid at the green.
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
    curvature: true,
    value: (y, i) => y.kn[i],
    full: (ctx) => zeroPivotRange(ctx.knMin, ctx.knMax, 0),
  },
  kg: {
    label: "Geodesic curvature κg",
    unit: "1/m",
    signed: true,
    curvature: true,
    value: (y, i) => y.kg[i],
    full: (ctx) => zeroPivotRange(-ctx.kAbsMax, ctx.kAbsMax, 0),
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
 * Curvature-map range (geo-framework convention): min = min(lo, 0), mid = 0, max = max(hi, 0), where
 * a side that occurs is at least `floor` wide. If neither side occurs (all values 0) the range is
 * ±floor (±1 if floor is 0), so everything is drawn green.
 * @param {number} lo @param {number} hi @param {number} floor ≥ 0 @returns {Range}
 */
export function zeroPivotRange(lo, hi, floor) {
  const min = lo < 0 ? Math.min(lo, -floor) : 0;
  const max = hi > 0 ? Math.max(hi, floor) : 0;
  if (min === 0 && max === 0) {
    const f = floor > 0 ? floor : 1;
    return { min: -f, mid: 0, max: f };
  }
  return { min, mid: 0, max };
}

/** Largest magnitude of a range. */
const magnitude = (r) => Math.max(Math.abs(r.min), Math.abs(r.max));

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
  if (def.curvature) return zeroPivotRange(data.min, data.max, 0.02 * magnitude(full));
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
 * Effective range of a mandrel colouring (curvature map, green at mid).
 * @param {ScaleSpec} spec @param {{min:number, max:number}} values over the mandrel
 * @returns {Range}
 */
export function mandrelRange(spec, values) {
  if (spec.mode === "custom") return { min: spec.min, mid: spec.mid, max: spec.max };
  return zeroPivotRange(values.min, values.max, 0.02 * magnitude(values));
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
 * Keeps the custom bounds ordered after bound `moved` changed; the other bounds give way. Returns a
 * new spec, snapped to the slider grid.
 *  - strictMid = true  (sequential scales): lo ≤ min < mid < max ≤ hi, one step apart;
 *  - strictMid = false (curvature maps):    lo ≤ min ≤ mid ≤ max ≤ hi with max − min ≥ one step, so
 *    mid (the green) may coincide with an end — e.g. min = mid = 0 for a one-signed curvature.
 * @param {{min:number, mid:number, max:number}} s @param {"min"|"mid"|"max"} moved
 * @param {{lo:number, hi:number, step:number}} b @param {boolean} [strictMid=true]
 */
export function orderBounds(s, moved, b, strictMid = true) {
  const g = b.step, gm = strictMid ? g : 0, c = (v) => Math.min(b.hi, Math.max(b.lo, v));
  let { min, mid, max } = { min: c(s.min), mid: c(s.mid), max: c(s.max) };
  if (moved === "min") {
    min = Math.min(min, b.hi - Math.max(2 * gm, g));
    mid = Math.min(Math.max(mid, min + gm), b.hi - gm);
    max = Math.max(max, mid + gm, min + g);
  } else if (moved === "max") {
    max = Math.max(max, b.lo + Math.max(2 * gm, g));
    mid = Math.max(Math.min(mid, max - gm), b.lo + gm);
    min = Math.min(min, mid - gm, max - g);
  } else {
    mid = Math.min(Math.max(mid, b.lo + gm), b.hi - gm);
    min = Math.min(min, mid - gm);
    max = Math.max(max, mid + gm);
    if (max - min < g) {
      // Only possible when mid may touch the ends: open the range on the side that has room.
      if (min + g <= b.hi) max = min + g;
      else min = max - g;
    }
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
