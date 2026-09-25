/**
 * @file analysis.js — closed-form reference results and derived quantities.
 *
 *  - Quasi-static braid angle (fell point assumed FIXED in the machine frame):
 *        tan α_qs = ω r / ( v √(1 + r′²) )        α measured from the meridian (tangent plane).
 *    On a cylinder this is the classical tan α = ωr/v (Ko 1987). The exact on-axis identity is
 *        tan α = r (ω − β̇) / ( (v − ḣ) √(1 + r′²) )
 *    with β the lag angle between carrier and fell point and h the convergence length, so the
 *    quasi-static value is exact only when β̇ = ḣ = 0.
 *  - Quasi-static convergence length: the free yarn leaves F tangentially at angle α_qs and reaches
 *    the guide ring radius R_g; h is its axial extent. Cylinder: h = √(R_g² − r²) / tan α
 *    (van Ravenhorst & Akkerman 2016).
 *  - Du & Popper (1994) transient on a cylinder:
 *        h(t) = h∞ + (h₀ − h∞) exp(−ωr t / √(R_g² − r²)),   i.e.  ḣ = v − ωr h / √(R_g² − r²).
 *  - Cover factor (flat-strip ideal) for N carriers (N/2 per direction), yarn width w:
 *        k = N w / (4π r cos α)   (fraction of the surface one family covers),
 *        CF = 1 − (1 − k)²        (two families),     CF = 1 − (1 − k)²(1 − k_a) (triaxial),
 *        k_a = n_a w_a / (2π r)   (n_a axial yarns of width w_a).
 *    Jamming when k → 1: α_jam = arccos(N w / (4π r)); if N w/(4π r) ≥ 1 it is jammed at any angle.
 *    Real round yarns jam earlier (max CF ≈ 0.82, Zhang et al. 1997).
 *  - Yarn mechanics: normal line pressure p = T κₙ [N/m]; no slip requires |κ_g| ≤ μ κₙ
 *    (Akkerman & Villa Rodríguez 2007).
 */

/** @typedef {import("./profiles.js").Profile} Profile */

/**
 * Quasi-static braid angle α_qs [rad] at axial position z.
 * @param {Profile} profile @param {number} z [m] @param {number} omega [rad/s] @param {number} v [m/s]
 */
export function quasiStaticAngle(profile, z, omega, v) {
  const { r, dr } = profile.evaluate(z);
  return Math.atan2(omega * r, v * Math.sqrt(1 + dr * dr));
}

/**
 * Quasi-static convergence length h [m] at axial position z: axial extent of the tangent line that
 * leaves the surface at angle α_qs and reaches the ring radius R_g. NaN if R_g ≤ r.
 * @param {Profile} profile @param {number} z @param {number} omega @param {number} v
 * @param {number} ringRadius R_g [m]
 */
export function quasiStaticConvergenceLength(profile, z, omega, v, ringRadius) {
  const { r, dr } = profile.evaluate(z);
  if (!(ringRadius > r)) return NaN;
  const alpha = quasiStaticAngle(profile, z, omega, v);
  const q = Math.sqrt(1 + dr * dr);
  // F = (r, 0, z); t = cos α m + sin α e with m = (r', 0, 1)/q, e = (0, 1, 0).
  const tx = (Math.cos(alpha) * dr) / q, ty = Math.sin(alpha), tz = Math.cos(alpha) / q;
  // |F_xy + ℓ t_xy|² = R_g²  →  a ℓ² + b ℓ + c = 0, positive root.
  const a = tx * tx + ty * ty, b = 2 * r * tx, c = r * r - ringRadius * ringRadius;
  const ell = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return ell * tz;
}

/** Cylinder convergence length h = √(R_g² − r²) / tan α [m]. */
export function cylinderConvergenceLength(r, ringRadius, alpha) {
  return Math.sqrt(ringRadius * ringRadius - r * r) / Math.tan(alpha);
}

/**
 * Du & Popper (1994) convergence-length transient on a cylinder of radius r.
 * @param {number} t time since the yarns became tangent [s]
 * @param {{h0:number, r:number, ringRadius:number, omega:number, v:number}} p
 * @returns {number} h(t) [m]
 */
export function duPopperConvergenceLength(t, p) {
  const s = Math.sqrt(p.ringRadius * p.ringRadius - p.r * p.r);
  const hInf = (p.v * s) / (p.omega * p.r);
  return hInf + (p.h0 - hInf) * Math.exp((-p.omega * p.r * t) / s);
}

/**
 * Cover factor of a (bi/tri)axial braid, flat-strip ideal.
 * @param {{carriers:number, width:number, r:number, alpha:number,
 *          axialCount?:number, axialWidth?:number}} p  lengths [m], alpha [rad]
 * @returns {{k:number, ka:number, cover:number, jammed:boolean}}
 */
export function coverFactor(p) {
  const k = (p.carriers * p.width) / (4 * Math.PI * p.r * Math.cos(p.alpha));
  const ka = p.axialCount
    ? Math.min(1, (p.axialCount * (p.axialWidth ?? p.width)) / (2 * Math.PI * p.r))
    : 0;
  const kc = Math.min(1, Math.max(0, k));
  const cover = 1 - (1 - kc) ** 2 * (1 - ka);
  return { k, ka, cover, jammed: k >= 1 };
}

/**
 * Jamming braid angle for given carriers, width and radius.
 * @param {number} carriers @param {number} width [m] @param {number} r [m]
 * @returns {number} α_jam [rad]; 0 when jammed at every angle (N w / (4π r) ≥ 1)
 */
export function jammingAngle(carriers, width, r) {
  const c = (carriers * width) / (4 * Math.PI * r);
  return c >= 1 ? 0 : Math.acos(c);
}

/** Normal line pressure of a yarn with tension T [N] on normal curvature κₙ [1/m]: p = Tκₙ [N/m]. */
export const contactPressure = (tension, kn) => tension * kn;

/**
 * Take-up speed that yields a target quasi-static braid angle on a cylinder of radius r:
 * v = ω r / tan α.
 */
export const takeUpForAngle = (omega, r, alpha) => (omega * r) / Math.tan(alpha);

/**
 * Bins samples by axial position and returns per-bin statistics (used for α(z), CF(z) plots).
 * @param {ArrayLike<number>} zs @param {ArrayLike<number>} values
 * @param {number} count number of samples to use (prefix of the arrays)
 * @param {number} z0 @param {number} z1 @param {number} bins
 * @returns {{z:number[], mean:number[], min:number[], max:number[]}} NaN in empty bins
 */
export function binByZ(zs, values, count, z0, z1, bins) {
  const sum = new Float64Array(bins), n = new Uint32Array(bins);
  const mn = new Float64Array(bins).fill(Infinity), mx = new Float64Array(bins).fill(-Infinity);
  const w = (z1 - z0) / bins;
  for (let i = 0; i < count; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const b = Math.floor((zs[i] - z0) / w);
    if (b < 0 || b >= bins) continue;
    sum[b] += v;
    n[b]++;
    if (v < mn[b]) mn[b] = v;
    if (v > mx[b]) mx[b] = v;
  }
  const out = { z: [], mean: [], min: [], max: [] };
  for (let b = 0; b < bins; b++) {
    out.z.push(z0 + (b + 0.5) * w);
    out.mean.push(n[b] ? sum[b] / n[b] : NaN);
    out.min.push(n[b] ? mn[b] : NaN);
    out.max.push(n[b] ? mx[b] : NaN);
  }
  return out;
}
