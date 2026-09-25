/**
 * @file numeric.js — small, dependency-free numerical toolbox used by the core.
 *
 * Contents
 *  - brent(f, a, b)            : bracketed scalar root finder (Brent–Dekker), robust + superlinear.
 *  - firstSignChange(f, ...)   : marches forward from s = 0 to bracket the FIRST root of f with
 *                                f(0) < 0 (used for "where does the free yarn touch the surface next").
 *  - goldenMin(f, a, b)        : golden-section minimisation on an interval (unimodal assumption).
 *  - rk4Step(f, t, y, h)       : one classical Runge–Kutta step for y' = f(t, y), y an array.
 *  - naturalCubicSpline(x, y)  : C² interpolating spline with natural end conditions (y'' = 0),
 *                                returning value, first and second derivative.
 *  - smootherstep(x)           : Perlin's C² step 6x⁵−15x⁴+10x³ with its first two derivatives.
 *
 * All functions are pure and work on plain numbers / arrays.
 */

/**
 * Brent–Dekker root finding on a bracketing interval [a, b] with f(a)·f(b) ≤ 0.
 * Combines bisection (guaranteed convergence) with secant / inverse quadratic interpolation.
 *
 * @param {(x:number)=>number} f
 * @param {number} a
 * @param {number} b
 * @param {{xtol?:number, ftol?:number, maxIter?:number, fa?:number, fb?:number}} [opts]
 *   xtol: absolute tolerance on x; ftol: stop when |f(x)| ≤ ftol; fa/fb: known f(a), f(b).
 * @returns {{x:number, fx:number, iterations:number, converged:boolean}}
 */
export function brent(f, a, b, opts = {}) {
  const xtol = opts.xtol ?? 1e-12;
  const ftol = opts.ftol ?? 0;
  const maxIter = opts.maxIter ?? 100;
  let fa = opts.fa ?? f(a);
  let fb = opts.fb ?? f(b);
  if (fa === 0) return { x: a, fx: 0, iterations: 0, converged: true };
  if (fb === 0) return { x: b, fx: 0, iterations: 0, converged: true };
  if (fa * fb > 0) throw new Error("brent: root is not bracketed");

  // Ensure |f(b)| ≤ |f(a)|: b is the best estimate so far.
  if (Math.abs(fa) < Math.abs(fb)) [a, b, fa, fb] = [b, a, fb, fa];
  let c = a, fc = fa, d = b - a, mflag = true;

  for (let i = 1; i <= maxIter; i++) {
    let s;
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation.
      s = (a * fb * fc) / ((fa - fb) * (fa - fc)) +
        (b * fa * fc) / ((fb - fa) * (fb - fc)) +
        (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      // Secant step.
      s = b - (fb * (b - a)) / (fb - fa);
    }
    const lo = (3 * a + b) / 4;
    const outside = (s - lo) * (s - b) > 0; // s not between (3a+b)/4 and b
    if (
      outside ||
      (mflag && Math.abs(s - b) >= Math.abs(b - c) / 2) ||
      (!mflag && Math.abs(s - b) >= Math.abs(c - d) / 2) ||
      (mflag && Math.abs(b - c) < xtol) ||
      (!mflag && Math.abs(c - d) < xtol)
    ) {
      s = (a + b) / 2; // bisection
      mflag = true;
    } else {
      mflag = false;
    }
    const fs = f(s);
    d = c;
    c = b;
    fc = fb;
    if (fa * fs < 0) {
      b = s;
      fb = fs;
    } else {
      a = s;
      fa = fs;
    }
    if (Math.abs(fa) < Math.abs(fb)) [a, b, fa, fb] = [b, a, fb, fa];
    if (Math.abs(fb) <= ftol || Math.abs(b - a) <= xtol) {
      return { x: b, fx: fb, iterations: i, converged: true };
    }
  }
  return { x: b, fx: fb, iterations: maxIter, converged: false };
}

/**
 * Brackets the first sign change of f on (0, sMax] given f(0) < 0, by marching with a step that
 * starts at `ds0` and grows geometrically by `growth`. Returns the bracket [a, b] with f(a) < 0 ≤ f(b),
 * or null if no sign change was found up to sMax.
 *
 * Marching (rather than pure doubling) matters when f is not monotone — e.g. where the yarn would
 * bridge a concave region — so that the FIRST contact point is found, not a later one.
 *
 * @param {(s:number)=>number} f
 * @param {number} f0     f(0) (must be < 0)
 * @param {number} ds0    initial step (> 0)
 * @param {number} sMax   search limit
 * @param {number} [growth=1.5]
 * @returns {{a:number, fa:number, b:number, fb:number} | null}
 */
export function firstSignChange(f, f0, ds0, sMax, growth = 1.5) {
  let a = 0, fa = f0, ds = ds0;
  while (a < sMax) {
    const b = Math.min(a + ds, sMax);
    const fb = f(b);
    if (fb >= 0) return { a, fa, b, fb };
    a = b;
    fa = fb;
    ds *= growth;
  }
  return null;
}

/**
 * Golden-section search for the minimum of a unimodal function on [a, b].
 * @param {(x:number)=>number} f
 * @param {number} a
 * @param {number} b
 * @param {number} [tol=1e-9] absolute x-tolerance
 * @returns {{x:number, fx:number}}
 */
export function goldenMin(f, a, b, tol = 1e-9) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a);
  let f1 = f(x1), f2 = f(x2);
  while (Math.abs(b - a) > tol) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    }
  }
  const x = (a + b) / 2;
  return { x, fx: f(x) };
}

/**
 * One classical 4th-order Runge–Kutta step for the system y' = f(t, y).
 * @param {(t:number, y:number[])=>number[]} f
 * @param {number} t
 * @param {number[]} y
 * @param {number} h
 * @returns {number[]} y(t + h)
 */
export function rk4Step(f, t, y, h) {
  const n = y.length;
  const tmp = new Array(n);
  const k1 = f(t, y);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
  const k2 = f(t + 0.5 * h, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
  const k3 = f(t + 0.5 * h, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
  const k4 = f(t + h, tmp);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

/**
 * Natural cubic spline through (x_i, y_i), x strictly increasing, n ≥ 2 points.
 * The interpolant is C² with y'' = 0 at both ends. Outside [x_0, x_{n−1}] it is extended
 * LINEARLY (C¹ continuation, y'' = 0), which keeps profile evaluation well-defined near the ends.
 *
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{evaluate:(x:number)=>{y:number, dy:number, d2y:number}, m:number[]}}
 *   m: second derivatives at the knots (exposed for tests).
 */
export function naturalCubicSpline(xs, ys) {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new Error("naturalCubicSpline: need ≥ 2 matching points");
  for (let i = 1; i < n; i++) {
    if (!(xs[i] > xs[i - 1])) throw new Error("naturalCubicSpline: x must be strictly increasing");
  }
  // Solve the tridiagonal system for knot second derivatives m_i (Thomas algorithm).
  const m = new Array(n).fill(0);
  if (n > 2) {
    const h = (i) => xs[i + 1] - xs[i];
    const sub = [], diag = [], sup = [], rhs = [];
    for (let i = 1; i < n - 1; i++) {
      sub.push(h(i - 1));
      diag.push(2 * (h(i - 1) + h(i)));
      sup.push(h(i));
      rhs.push(6 * ((ys[i + 1] - ys[i]) / h(i) - (ys[i] - ys[i - 1]) / h(i - 1)));
    }
    const k = diag.length;
    for (let i = 1; i < k; i++) {
      const w = sub[i] / diag[i - 1];
      diag[i] -= w * sup[i - 1];
      rhs[i] -= w * rhs[i - 1];
    }
    const sol = new Array(k);
    sol[k - 1] = rhs[k - 1] / diag[k - 1];
    for (let i = k - 2; i >= 0; i--) sol[i] = (rhs[i] - sup[i] * sol[i + 1]) / diag[i];
    for (let i = 0; i < k; i++) m[i + 1] = sol[i];
  }

  /** Value and derivatives of segment i at x. */
  const seg = (i, x) => {
    const h = xs[i + 1] - xs[i];
    const A = (xs[i + 1] - x) / h, B = (x - xs[i]) / h;
    const y = A * ys[i] + B * ys[i + 1] +
      ((A ** 3 - A) * m[i] + (B ** 3 - B) * m[i + 1]) * h * h / 6;
    const dy = (ys[i + 1] - ys[i]) / h +
      ((1 - 3 * A * A) * m[i] + (3 * B * B - 1) * m[i + 1]) * h / 6;
    const d2y = A * m[i] + B * m[i + 1];
    return { y, dy, d2y };
  };

  const evaluate = (x) => {
    if (x <= xs[0]) {
      const e = seg(0, xs[0]);
      return { y: e.y + e.dy * (x - xs[0]), dy: e.dy, d2y: x === xs[0] ? e.d2y : 0 };
    }
    if (x >= xs[n - 1]) {
      const e = seg(n - 2, xs[n - 1]);
      return { y: e.y + e.dy * (x - xs[n - 1]), dy: e.dy, d2y: x === xs[n - 1] ? e.d2y : 0 };
    }
    // Binary search for the segment containing x.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    return seg(lo, x);
  };
  return { evaluate, m };
}

/**
 * Perlin's smootherstep S(x) = 6x⁵ − 15x⁴ + 10x³ clamped to [0, 1], with S'(x) and S''(x).
 * S, S', S'' are continuous everywhere (S' = S'' = 0 at x = 0 and x = 1), i.e. S is C².
 * @param {number} x
 * @returns {{s:number, ds:number, d2s:number}}
 */
export function smootherstep(x) {
  if (x <= 0) return { s: 0, ds: 0, d2s: 0 };
  if (x >= 1) return { s: 1, ds: 0, d2s: 0 };
  const x2 = x * x, x3 = x2 * x;
  return {
    s: x3 * (10 + x * (-15 + 6 * x)),
    ds: 30 * x2 * (1 - x) * (1 - x),
    d2s: 60 * x * (1 - x) * (1 - 2 * x),
  };
}

/** Clamp x to [lo, hi]. */
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Wrap an angle to (−π, π]. */
export function wrapPi(a) {
  const t = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return t === -Math.PI ? Math.PI : t;
}

/** Wrap an angle to [0, 2π). */
export function wrap2Pi(a) {
  const t = a - 2 * Math.PI * Math.floor(a / (2 * Math.PI));
  return t >= 2 * Math.PI ? 0 : t;
}
