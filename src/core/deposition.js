/**
 * @file deposition.js — the convergence-zone (fell-point) model: how one yarn is laid onto the
 * mandrel. This is the Kessels & Akkerman (2002) model, solved with unilateral contact.
 *
 * Model (all quantities in the MANDREL frame, see pose.js):
 *  - The free yarn is a straight segment from the guide point G(t) to the fell point F on the
 *    mandrel surface. Yarn that has been deposited sticks (no sliding after contact).
 *  - Unilateral contact: g = (G − F)·n(F) ≥ 0.
 *      g > 0  → the free yarn points away from the surface: F stays put ("pinned"; this is the
 *               start-up tie ring, or a lift-off).
 *      g → <0 → G has moved so that the straight yarn would cut into the mandrel: the yarn wraps
 *               and F advances ALONG THE FREE-YARN DIRECTION t on the surface until g = 0 again
 *               (free yarn tangent at F).
 *    Continuous form: Ḟ = λ t,  λ = −(Ġ·n)/(L κₙ),  L = |G − F|,  κₙ = normal curvature along t
 *    (convex-positive). Differentiating t = (G − F)/L gives closed forms for the deposited curve
 *    (Darboux frame t, n, b = n × t):
 *        κ_g = (Ġ·b)/(λ L),   κₙ = −(Ġ·n)/(λ L),   ⇒   κ_g/κₙ = −(Ġ·b)/(Ġ·n)   (slip ratio).
 *  - Numerics (per time step, G ← G(t_{n+1})): second-order Heun scheme in the (z, θ) chart:
 *        predictor: from F_n move along d_n = t(F_n, G_n) until g(·; G_{n+1}) = 0  → F*
 *        corrector: from F_n move along ½(d_n + t(F*, G_{n+1})) until g = 0         → F_{n+1}
 *    Each "move until g = 0" is a bracketed root search (first sign change of g along the path,
 *    then Brent) — position based, so it never divides by κₙ.
 *  - Non-convex regions (κₙ ≤ 0 along t) and obstacles: the root search looks for the FIRST
 *    point ahead where the free yarn touches tangentially; the stretch in between is stored as a
 *    suspended straight chord (flag BRIDGE). Independently, the whole free yarn is checked for
 *    interference with the mandrel (e.g. a bulge rising into it); if it cuts the surface, the yarn
 *    catches there: the fell point jumps to the contact point (flags BRIDGE | CONTACT).
 * Validity: the idealisation assumes κₙ > 0 along the yarn and no friction before contact.
 */

import { brent, firstSignChange, goldenMin } from "./numeric.js";
import { dot, lerp, norm, sub } from "./vec.js";
import { FLAG } from "./yarnPath.js";

/** @typedef {import("./vec.js").Vec3} Vec3 */
/** @typedef {import("./surface.js").SurfaceOfRevolution} SurfaceOfRevolution */
/** @typedef {import("./surface.js").SurfaceFrame} SurfaceFrame */

/** Solver tolerances and limits (SI units). */
export const DEFAULT_SOLVER_OPTIONS = Object.freeze({
  pinTol: 1e-12, // g(0) ≥ −pinTol → yarn does not press on the surface → pinned [m]
  gTol: 1e-9, // |g| at an accepted root [m]
  maxIter: 40, // Brent iterations
  convexKr: 1e-3, // κₙ·r below this → treat the direction as non-convex (bridging search)
  bridgeStep: 2.5e-4, // initial marching step of the bridging search [m of arc]
  maxSearch: 0.3, // longest distance searched for the next contact point [m]
  segmentSamples: 20, // samples of the free yarn used in the interference test
  clearanceTol: 1e-7, // penetration deeper than this counts as interference [m]
  nearExclude: 1e-4, // the first 0.1 mm of the free yarn is excluded from the interference test [m]
  maxContactIterations: 4,
});

/**
 * @typedef {Object} DepositSample  A new sample for YarnPath.push (see yarnPath.js).
 * @property {Vec3} p @property {number} zp @property {number} th @property {Vec3} t @property {Vec3} n
 * @property {Vec3} b @property {number} alpha @property {number} kn @property {number} kg
 * @property {number} slip @property {number} free @property {number} time @property {number} flags
 */

export class FellPointSolver {
  /**
   * @param {SurfaceOfRevolution} surface mandrel surface (mandrel frame)
   * @param {{z:number, th:number}} start  initial fell point (the tie point) in surface parameters
   * @param {Partial<typeof DEFAULT_SOLVER_OPTIONS>} [options]
   */
  constructor(surface, start, options = {}) {
    this.surface = surface;
    this.opt = { ...DEFAULT_SOLVER_OPTIONS, ...options };
    this.z = start.z;
    this.th = start.th;
    /** "pinned" | "wrapping" | "ended" */
    this.mode = "pinned";
    /** Unit-speed chart direction (dz/ds, dθ/ds) of the free yarn at F (valid while wrapping). */
    this.dir = null;
    this.liftoffPending = false;
    this.endReason = "";
  }

  /** Current fell point frame. */
  frame() {
    return this.surface.frame(this.z, this.th);
  }

  /**
   * Chart direction (dz/ds, dθ/ds), unit speed, of the free yarn at the surface frame f pointing
   * towards G (projected onto the tangent plane).
   * @param {SurfaceFrame} f @param {Vec3} G @returns {[number, number]}
   */
  chartDirectionTowards(f, G) {
    const { t } = this.surface.darboux(f, sub(G, f.p));
    return this.surface.tangentToParam(f, t);
  }

  /** Contact function g = (G − S(z, θ))·n(z, θ) [m]. */
  gap(z, th, G) {
    const f = this.surface.frame(z, th);
    return dot(sub(G, f.p), f.n);
  }

  /**
   * Finds the first point along the chart line (z0 + s·D₀, θ0 + s·D₁), s > 0, where
   * sign·g changes from negative to non-negative, given sign·g(0) = f0 < 0.
   * @returns {{s:number, z:number, th:number, bridged:boolean} | null}
   */
  rootAlong(z0, th0, D, G, f0, sign = 1) {
    const o = this.opt;
    const fAt = (s) => sign * this.gap(z0 + s * D[0], th0 + s * D[1], G);
    // Slope of g along the line at s = 0: g'(0) = (G − S)·dn/ds, dn/ds = k_m (v·m) m + k_p (v·e) e.
    const f = this.surface.frame(z0, th0);
    const v = this.surface.paramToVector(f, D[0], D[1]);
    const pr = this.surface.principal(z0);
    const w = sub(G, f.p);
    const slope = sign * (pr.k_m * dot(v, f.m) * dot(w, f.m) + pr.k_p * dot(v, f.e) * dot(w, f.e));
    const kn = this.surface.normalCurvature(f, v);
    const convex = kn * f.r >= o.convexKr && slope > 0;
    const bracket = convex
      ? firstSignChange(fAt, f0, 1.5 * (-f0 / slope), o.maxSearch, 2)
      : firstSignChange(fAt, f0, o.bridgeStep, o.maxSearch, 1.25);
    if (!bracket) return null;
    const r = brent(fAt, bracket.a, bracket.b, {
      fa: bracket.fa,
      fb: bracket.fb,
      xtol: 1e-13,
      ftol: o.gTol,
      maxIter: o.maxIter,
    });
    return { s: r.x, z: z0 + r.x * D[0], th: th0 + r.x * D[1], bridged: !convex };
  }

  /**
   * Interference test of the free yarn P → G with the mandrel (excluding the first `nearExclude`).
   * Samples are denser near P (quadratic spacing); an interior minimum below 1 mm is refined by
   * golden-section search.
   * @returns {{u:number, depth:number} | null} u ∈ (0,1] along P→G of the deepest penetration
   */
  interference(P, G) {
    const o = this.opt, s = this.surface;
    const L = norm(sub(G, P));
    if (L <= o.nearExclude) return null;
    const u0 = o.nearExclude / L, K = o.segmentSamples;
    const us = [], cs = [];
    for (let k = 0; k <= K; k++) {
      const u = u0 + (1 - u0) * (k / K) ** 2;
      us.push(u);
      cs.push(s.clearance(lerp(P, G, u)));
    }
    let kMin = 0;
    for (let k = 1; k <= K; k++) if (cs[k] < cs[kMin]) kMin = k;
    let u = us[kMin], c = cs[kMin];
    if (kMin > 0 && kMin < K && c < 1e-3) {
      const g = goldenMin((x) => s.clearance(lerp(P, G, x)), us[kMin - 1], us[kMin + 1], 1e-9);
      if (g.fx < c) [u, c] = [g.x, g.fx];
    }
    return c < -o.clearanceTol ? { u, depth: -c } : null;
  }

  /**
   * Evaluates the deposited-curve geometry at the current fell point for guide point G with
   * relative velocity Ġ (closed forms, valid while wrapping continuously).
   * @returns {DepositSample}
   */
  makeSample(G, Gdot, time, flags) {
    const s = this.surface;
    const f = this.frame();
    const d = sub(G, f.p);
    const { t, n, b } = s.darboux(f, d);
    const kn = s.normalCurvature(f, t);
    const Gn = dot(Gdot, n), Gb = dot(Gdot, b);
    const continuous = (flags & (FLAG.BRIDGE | FLAG.TIE)) === 0;
    const slip = continuous && Gn < 0 && kn > 0 ? -Gb / Gn : NaN;
    return {
      p: f.p,
      zp: this.z,
      th: this.th,
      t,
      n,
      b,
      alpha: s.braidAngle(f, t),
      kn,
      kg: slip * kn,
      slip,
      free: norm(d),
      time,
      flags,
    };
  }

  /**
   * Tie sample: the initial fell point, before any wrapping.
   * @param {Vec3} G guide point @param {number} time
   */
  tieSample(G, time) {
    return this.makeSample(G, [0, 0, 0], time, FLAG.TIE);
  }

  /**
   * Advances the fell point after the guide point moved to G (relative velocity Ġ, both mandrel
   * frame) at time `time`. Returns the samples deposited during this step (possibly none).
   * @param {Vec3} G @param {Vec3} Gdot @param {number} time
   * @returns {{samples: DepositSample[], turn: number, ds: number}}
   *   turn: angle between the free-yarn directions at the start and end of the step [rad]
   *   ds:   distance travelled by the fell point [m]
   */
  advance(G, Gdot, time) {
    const out = { samples: [], turn: 0, ds: 0 };
    if (this.mode === "ended") return out;
    const s = this.surface;
    const f0 = this.frame();
    const g0 = dot(sub(G, f0.p), f0.n);

    if (g0 >= -this.opt.pinTol) {
      // The yarn does not press on the surface at F: nothing is deposited here …
      if (this.mode === "wrapping") {
        this.mode = "pinned";
        this.liftoffPending = true;
      }
      // … unless the free yarn catches on the mandrel elsewhere (e.g. a bulge).
      const hit = this.interference(f0.p, G);
      if (hit) this.contactJump(f0.p, G, Gdot, time, hit, out);
      return out;
    }

    // ── Wrapping step (Heun) ──────────────────────────────────────────────────────────────────
    const dN = this.mode === "wrapping" && this.dir ? this.dir : this.chartDirectionTowards(f0, G);
    const pred = this.rootAlong(this.z, this.th, dN, G, g0);
    if (!pred) return this.end("no contact point found ahead of the fell point", out);
    const dStar = this.chartDirectionTowards(s.frame(pred.z, pred.th), G);
    const D = [0.5 * (dN[0] + dStar[0]), 0.5 * (dN[1] + dStar[1])];
    const corr = this.rootAlong(this.z, this.th, D, G, g0) ?? pred;
    if (!this.withinMandrel(corr.z)) return this.end("reached the end of the mandrel", out);

    const pOld = f0.p;
    this.z = corr.z;
    this.th = corr.th;
    const f1 = this.frame();
    // A chord lying ABOVE the surface means the yarn is suspended (non-convex stretch).
    const chordAbove = s.clearance(lerp(pOld, f1.p, 0.5)) > this.opt.clearanceTol;
    let flags = pred.bridged || corr.bridged || chordAbove ? FLAG.BRIDGE : 0;
    if (this.liftoffPending) {
      flags |= FLAG.LIFTOFF;
      this.liftoffPending = false;
    }
    this.mode = "wrapping";
    const dirOld = s.paramToVector(f0, dN[0], dN[1]);
    this.dir = this.chartDirectionTowards(f1, G);
    const dirNew = s.paramToVector(f1, this.dir[0], this.dir[1]);
    out.turn = Math.acos(
      Math.min(1, Math.max(-1, dot(dirOld, dirNew) / (norm(dirOld) * norm(dirNew)))),
    );
    out.ds = norm(sub(f1.p, pOld));
    out.samples.push(this.makeSample(G, Gdot, time, flags));

    // The new free yarn must not cut through the mandrel further ahead (obstacle check).
    const hit = this.interference(f1.p, G);
    if (hit) this.contactJump(f1.p, G, Gdot, time, hit, out);
    return out;
  }

  /**
   * The free yarn from P to G cuts the mandrel (deepest at `hit.u`): the yarn catches on the
   * obstacle. The new fell point is the tangency point near the obstacle; the stretch from P is a
   * straight suspended chord. Repeats if the new free yarn still interferes.
   */
  contactJump(P, G, Gdot, time, hit, out) {
    const s = this.surface;
    for (let iter = 0; iter < this.opt.maxContactIterations && hit; iter++) {
      const X = lerp(P, G, hit.u);
      const q = s.projectRadially(X, this.th);
      const fq = s.frame(q.z, q.th);
      const gq = dot(sub(G, fq.p), fq.n);
      const D = this.chartDirectionTowards(fq, G);
      // g < 0: G is "behind" the tangent plane → move towards G; g > 0 → move back towards P.
      const root = gq < 0
        ? this.rootAlong(q.z, q.th, D, G, gq, 1)
        : this.rootAlong(q.z, q.th, [-D[0], -D[1]], G, -gq, -1);
      const z = root ? root.z : q.z, th = root ? root.th : q.th;
      if (!this.withinMandrel(z)) return this.end("reached the end of the mandrel", out);
      this.z = z;
      this.th = th;
      this.mode = "wrapping";
      const f = this.frame();
      this.dir = this.chartDirectionTowards(f, G);
      out.ds += norm(sub(f.p, P));
      out.samples.push(this.makeSample(G, Gdot, time, FLAG.BRIDGE | FLAG.CONTACT));
      P = f.p;
      hit = this.interference(P, G);
    }
    return out;
  }

  /** Whether an axial position lies on the mandrel. */
  withinMandrel(z) {
    return z >= 0 && z <= this.surface.length;
  }

  /** Stops this yarn permanently. */
  end(reason, out) {
    this.mode = "ended";
    this.endReason = reason;
    return out;
  }
}
