/**
 * @file simulation.js — orchestrates machine, mandrel and yarn deposition over time.
 *
 * One Simulation = one braiding run with fixed parameters (change a parameter → build a new one).
 *   t = 0   : every yarn is tied to the mandrel on the "tie ring" z_M = tieZ, directly below its
 *             guide point; the tie ring is initialConvergence (h₀) downstream of the guide ring.
 *   t > 0   : carriers rotate, the mandrel is taken up; each yarn is advanced by its FellPointSolver
 *             (deposition.js) in sub-steps; crossings and undulation are updated (crossings.js).
 *   end     : when the fell points reach the trailing end of the mandrel (or no yarn is active).
 *
 * Symmetry. For a centred, untilted mandrel the whole process is invariant under rotation by Δ
 * about the axis: "+" yarn j is "+" yarn 0 rotated by jΔ, likewise for "−". Then only two
 * representative yarns are solved and the others are exact rotated copies (N/2 × cheaper). Off-axis
 * every yarn is solved individually. Views never need to know which case applies.
 *
 * Step control. Δt = scale · min(Δφ_max/ω, Δs_max/v_F), v_F = √(ω²r_max² + v²(1 + r′²_max)) (an upper
 * bound of the fell-point speed); `scale` shrinks when a step turns the yarn direction by more than
 * turnMax or moves a fell point by much more than Δs_max, and recovers slowly otherwise.
 *
 * Public read-only state for views/UI: see the fields documented in the constructor.
 */

import { makeProfile } from "./profiles.js";
import { SurfaceOfRevolution } from "./surface.js";
import { MandrelPose } from "./pose.js";
import { CircularBraider } from "./machine.js";
import { FellPointSolver } from "./deposition.js";
import { FLAG, YarnPath } from "./yarnPath.js";
import { CrossingTracker } from "./crossings.js";
import { coverFactor } from "./analysis.js";

/** @typedef {import("./vec.js").Vec3} Vec3 */

/**
 * @typedef {Object} SimConfig  All values in SI units.
 * @property {number} carriers           N (even, 2m | N)
 * @property {number} m                  braid pattern m (1 diamond, 2 regular, 3 Hercules)
 * @property {number} omega              carrier revolution rate ω [rad/s]
 * @property {number} takeUp             take-up speed v [m/s]
 * @property {number} ringRadius         guide-ring radius R_g [m]
 * @property {number} [trackRadius]      visual horn-gear track radius [m]
 * @property {import("./profiles.js").ProfileSpec} profile
 * @property {number} offsetX            mandrel axis offset in the ring plane [m]
 * @property {number} offsetY            [m]
 * @property {number} tilt               mandrel tilt about the machine x axis [rad]
 * @property {number} tieZ               mandrel coordinate of the tie ring [m]
 * @property {number} initialConvergence h₀: tie ring distance downstream of the ring plane [m]
 * @property {boolean} triaxial          add one axial yarn per horn gear
 * @property {number} yarnWidth          bias yarn width w [m]
 * @property {number} axialWidth         axial yarn width [m]
 * @property {number} yarnThickness      yarn thickness t_y [m]
 * @property {number} tension            yarn tension T [N]
 * @property {number} friction           yarn–mandrel friction coefficient μ
 * @property {number} dsMax              max fell-point advance per step [m]
 * @property {number} dphiMax            max carrier rotation per step [rad]
 * @property {number} turnMax            max turn of the yarn direction per step [rad]
 * @property {boolean} [forceGeneral]    solve every yarn even when symmetric (tests)
 */

const SERIES_DT = 0.05; // [s] sampling interval of the time series

export class Simulation {
  /** @param {SimConfig} config */
  constructor(config) {
    const c = (this.config = { ...config });
    /** @type {import("./profiles.js").Profile} */
    this.profile = makeProfile(c.profile);
    this.surface = new SurfaceOfRevolution(this.profile);
    this.machine = new CircularBraider({
      carriers: c.carriers,
      omega: c.omega,
      ringRadius: c.ringRadius,
      m: c.m,
      trackRadius: c.trackRadius,
    });
    this.pose = new MandrelPose({
      offsetX: c.offsetX,
      offsetY: c.offsetY,
      tilt: c.tilt,
      d0: c.tieZ + c.initialConvergence,
      v: c.takeUp,
    });
    this.symmetric = this.pose.isOnAxis && !c.forceGeneral;

    /** Simulation time [s]. */
    this.time = 0;
    this.ended = false;
    this.endReason = "";
    this.stepCount = 0;
    this.dtScale = 1;

    const P = this.machine.perFamily;
    /** Bias yarns: indices 0…P−1 "+" family (carrier j = k), P…2P−1 "−" family (i = k − P). */
    this.yarns = [];
    for (let j = 0; j < P; j++) this.yarns.push(new YarnPath({ family: 1, index: j }));
    for (let i = 0; i < P; i++) this.yarns.push(new YarnPath({ family: -1, index: i }));

    // Solvers: one per yarn, or only the two representatives (k = 0 and k = P) when symmetric.
    this.solverYarn = this.symmetric ? [0, P] : this.yarns.map((_, k) => k);
    this.solvers = this.solverYarn.map((k) => {
      const G = this.guideMandrel(k, 0);
      return new FellPointSolver(this.surface, { z: c.tieZ, th: Math.atan2(G[1], G[0]) });
    });

    // Axial yarns (triaxial): fixed mandrel azimuth (fixed machine points keep x_M, y_M).
    this.axialYarns = [];
    this.axialInfo = [];
    if (c.triaxial) {
      for (let q = 0; q < this.machine.gearCount; q++) {
        const G = this.pose.toMandrel(this.machine.axialGuidePoint(q), 0);
        this.axialInfo.push({ q, th: Math.atan2(G[1], G[0]), zLast: -Infinity });
        this.axialYarns.push(new YarnPath({ family: 1, index: q, kind: "axial" }));
      }
    }

    this.crossings = new CrossingTracker({
      machine: this.machine,
      plus: this.yarns.slice(0, P),
      minus: this.yarns.slice(P),
      axial: this.axialInfo,
    });

    /** Current fell point of every bias yarn in the mandrel frame (updated each step). */
    this.fell = this.yarns.map(() => [0, 0, 0]);
    /** Solver mode per bias yarn: "pinned" | "wrapping" | "ended". */
    this.mode = this.yarns.map(() => "pinned");

    /** Time series of the convergence length h (machine-frame distance ring plane → fell point). */
    this.series = { t: [], hPlus: [], hMinus: [], hMin: [], hMax: [], ringZ: [] };
    this.nextSeriesTime = 0;
    /** Time and h at which the first "+" yarn started wrapping (for the Du–Popper reference). */
    this.wrapStart = null;
    /** Flag counters over all deposited bias samples. */
    this.stats = { samples: 0, slip: 0, bridge: 0, contact: 0, liftoff: 0, jam: 0 };
    /** Flags of the most recent sample of each bias yarn (live status). */
    this.currentFlags = this.yarns.map(() => 0);

    // Step-size bounds from the profile.
    let slopeMax = 0;
    for (let i = 0; i <= 200; i++) {
      slopeMax = Math.max(
        slopeMax,
        Math.abs(this.profile.evaluate((i / 200) * this.profile.length).dr),
      );
    }
    const vF = Math.hypot(
      c.omega * this.profile.rMax,
      c.takeUp * Math.sqrt(1 + slopeMax * slopeMax),
    );
    this.dtBase = Math.min(c.dphiMax / c.omega, c.dsMax / vF);

    this.depositTieSamples();
    this.updateFellState();
    this.recordSeries(true);
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────────────────────

  /** Family (+1/−1) and carrier index of bias yarn k. */
  carrierOf(k) {
    const P = this.machine.perFamily;
    return k < P ? { family: 1, j: k } : { family: -1, j: k - P };
  }

  /** Guide point of bias yarn k in the MACHINE frame at time t. */
  guideMachine(k, t) {
    const { family, j } = this.carrierOf(k);
    return this.machine.guidePoint(family, j, t);
  }

  /** Guide point of bias yarn k in the MANDREL frame at time t. */
  guideMandrel(k, t) {
    return this.pose.toMandrel(this.guideMachine(k, t), t);
  }

  /** Relative velocity of the guide point of yarn k w.r.t. the mandrel, mandrel frame. */
  guideVelocityMandrel(k, t) {
    const { family, j } = this.carrierOf(k);
    return this.pose.velocityToMandrel(this.machine.guideVelocity(family, j, t));
  }

  /** Rotation angle that maps the representative of yarn k onto yarn k (symmetric mode). */
  rotationOf(k) {
    const P = this.machine.perFamily;
    return (k < P ? k : k - P) * this.machine.delta;
  }

  // ── Stepping ────────────────────────────────────────────────────────────────────────────────

  /**
   * Advances the simulation by up to `dt` seconds of simulated time, stopping early when the
   * wall-clock budget is exhausted or the run ends.
   * @param {number} dt [s]
   * @param {{budgetMs?:number}} [opts]
   * @returns {number} simulated time actually advanced [s]
   */
  advance(dt, opts = {}) {
    const budget = opts.budgetMs ?? Infinity;
    const t0 = this.time, tEnd = t0 + dt;
    const wall0 = performance.now();
    while (!this.ended && this.time < tEnd - 1e-12) {
      this.step(Math.min(this.dtBase * this.dtScale, tEnd - this.time));
      if (performance.now() - wall0 > budget) break;
    }
    return this.time - t0;
  }

  /** One sub-step of length h [s]. */
  step(h) {
    const c = this.config;
    const t1 = this.time + h;
    let worstTurn = 0, worstDs = 0, anyActive = false;

    this.solvers.forEach((solver, n) => {
      const k = this.solverYarn[n];
      if (solver.mode === "ended") return;
      const res = solver.advance(this.guideMandrel(k, t1), this.guideVelocityMandrel(k, t1), t1);
      if (solver.mode !== "ended") anyActive = true;
      const jumped = res.samples.some((s) => s.flags & FLAG.CONTACT);
      if (!jumped) {
        worstTurn = Math.max(worstTurn, res.turn);
        worstDs = Math.max(worstDs, res.ds);
      }
      for (const s of res.samples) {
        s.flags |= this.physicsFlags(s);
        this.deposit(k, s);
      }
      if (k === 0 && !this.wrapStart && solver.mode === "wrapping") {
        this.wrapStart = { time: t1, h: this.convergenceLength(solver.frame().p, t1) };
      }
    });

    this.time = t1;
    this.stepCount++;
    if (this.axialYarns.length) this.updateAxial(t1);
    this.crossings.update(t1);
    this.updateFellState();
    this.recordSeries(false);

    // Adaptive step scale.
    if (worstTurn > c.turnMax || worstDs > 1.5 * c.dsMax) {
      this.dtScale = Math.max(0.05, this.dtScale * 0.7);
    } else this.dtScale = Math.min(1, this.dtScale * 1.05);

    if (!anyActive) this.finish(this.solvers[0].endReason || "all yarns finished");
    else if (this.pose.ringAxisParam(t1) > this.profile.length + 5 * c.ringRadius) {
      this.finish("the mandrel has passed through the machine");
    }
  }

  /** SLIP / JAM flags from friction and cover factor. */
  physicsFlags(s) {
    const c = this.config;
    let f = 0;
    if (Number.isFinite(s.slip) && Math.abs(s.slip) > c.friction) f |= FLAG.SLIP;
    const r = this.profile.evaluate(s.zp).r;
    if (
      coverFactor({ carriers: c.carriers, width: c.yarnWidth, r, alpha: Math.abs(s.alpha) }).jammed
    ) {
      f |= FLAG.JAM;
    }
    return f;
  }

  /** Appends a sample of solver yarn k (and its rotated copies in symmetric mode). */
  deposit(k, s) {
    const targets = this.symmetric ? this.familyMembers(k) : [k];
    for (const kk of targets) {
      const y = this.yarns[kk];
      y.push(this.symmetric ? rotateSample(s, this.rotationOf(kk)) : s);
      this.currentFlags[kk] = s.flags;
    }
    this.stats.samples++;
    if (s.flags & FLAG.SLIP) this.stats.slip++;
    if (s.flags & FLAG.BRIDGE) this.stats.bridge++;
    if (s.flags & FLAG.CONTACT) this.stats.contact++;
    if (s.flags & FLAG.LIFTOFF) this.stats.liftoff++;
    if (s.flags & FLAG.JAM) this.stats.jam++;
  }

  /** All bias yarn indices of the same family as yarn k. */
  familyMembers(k) {
    const P = this.machine.perFamily, base = k < P ? 0 : P;
    return Array.from({ length: P }, (_, i) => base + i);
  }

  /** Tie samples at t = 0 (first sample of every yarn). */
  depositTieSamples() {
    this.solvers.forEach((solver, n) => {
      const k = this.solverYarn[n];
      this.deposit(k, solver.tieSample(this.guideMandrel(k, 0), 0));
    });
    this.stats = { samples: 0, slip: 0, bridge: 0, contact: 0, liftoff: 0, jam: 0 };
    this.axialYarns.forEach((y, a) => {
      const info = this.axialInfo[a];
      const f = this.surface.frame(this.config.tieZ, info.th);
      y.push(
        axialSample(
          this.surface,
          f,
          0,
          this.pose.toMandrel(this.machine.axialGuidePoint(info.q), 0),
        ),
      );
      info.zLast = this.config.tieZ;
    });
  }

  /**
   * Axial yarns follow the fell curve: each lies on its meridian θ_a and is extended to the axial
   * position of the bias fell curve at θ_a (linear interpolation between fell points in θ).
   */
  updateAxial(t) {
    const pts = [];
    this.solvers.forEach((solver, n) => {
      if (solver.mode === "ended") return;
      if (this.symmetric) {
        pts.push({ th: 0, z: solver.z, all: true });
      } else {
        pts.push({
          th: ((solver.th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
          z: solver.z,
          k: this.solverYarn[n],
        });
      }
    });
    if (!pts.length) return;
    const zAt = this.symmetric
      ? () => Math.min(...pts.map((p) => p.z))
      : fellCurveInterpolator(pts);
    const dsRec = this.config.dsMax;
    this.axialYarns.forEach((y, a) => {
      const info = this.axialInfo[a];
      const z = Math.min(zAt(info.th), this.profile.length);
      if (z < info.zLast + dsRec) return;
      const f = this.surface.frame(z, info.th);
      const G = this.pose.toMandrel(this.machine.axialGuidePoint(info.q), t);
      y.push(axialSample(this.surface, f, t, G));
      info.zLast = z;
    });
  }

  /** Refreshes `fell` (mandrel-frame fell points) and `mode` for every bias yarn. */
  updateFellState() {
    this.solvers.forEach((solver, n) => {
      const k = this.solverYarn[n];
      const p = solver.frame().p;
      const targets = this.symmetric ? this.familyMembers(k) : [k];
      for (const kk of targets) {
        this.fell[kk] = this.symmetric ? rotateZ(p, this.rotationOf(kk)) : p;
        this.mode[kk] = solver.mode;
      }
    });
  }

  /** Convergence length: distance of a mandrel-frame point downstream of the ring plane [m]. */
  convergenceLength(pM, t) {
    return -this.pose.toMachine(pM, t)[2];
  }

  /** Samples the h(t) time series. */
  recordSeries(force) {
    if (!force && this.time < this.nextSeriesTime) return;
    this.nextSeriesTime = this.time + SERIES_DT;
    const P = this.machine.perFamily;
    let sp = 0, sm = 0, mn = Infinity, mx = -Infinity;
    this.fell.forEach((p, k) => {
      const h = this.convergenceLength(p, this.time);
      if (k < P) sp += h;
      else sm += h;
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
    });
    const s = this.series;
    s.t.push(this.time);
    s.hPlus.push(sp / P);
    s.hMinus.push(sm / P);
    s.hMin.push(mn);
    s.hMax.push(mx);
    s.ringZ.push(this.pose.ringAxisParam(this.time));
  }

  /** Marks the run as finished. */
  finish(reason) {
    this.ended = true;
    this.endReason = reason;
  }

  /** Fraction of the mandrel length covered so far (for progress bars). */
  get progress() {
    let z = Infinity;
    for (const s of this.solvers) z = Math.min(z, s.mode === "ended" ? this.profile.length : s.z);
    return Math.max(
      0,
      Math.min(1, (z - this.config.tieZ) / (this.profile.length - this.config.tieZ)),
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Rotation of a vector about the z axis by angle a. */
function rotateZ(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/** A deposited sample rotated about the mandrel axis by angle a (symmetric replication). */
function rotateSample(s, a) {
  if (a === 0) return s;
  return {
    ...s,
    p: rotateZ(s.p, a),
    t: rotateZ(s.t, a),
    n: rotateZ(s.n, a),
    b: s.b && rotateZ(s.b, a),
    th: s.th + a,
  };
}

/** Sample of an axial yarn on the meridian through frame f. */
function axialSample(surface, f, time, G) {
  const kn = surface.principal(f.z).k_m;
  return {
    p: f.p,
    zp: f.z,
    th: f.th,
    t: f.m,
    n: f.n,
    alpha: 0,
    kn,
    kg: 0,
    slip: 0,
    free: Math.hypot(G[0] - f.p[0], G[1] - f.p[1], G[2] - f.p[2]),
    time,
    flags: 0,
  };
}

/**
 * Periodic linear interpolation z(θ) through the fell points (θ ∈ [0, 2π)).
 * @param {{th:number, z:number}[]} pts
 */
function fellCurveInterpolator(pts) {
  const sorted = [...pts].sort((a, b) => a.th - b.th);
  const n = sorted.length;
  return (th) => {
    const x = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (n === 1) return sorted[0].z;
    let i = sorted.findIndex((p) => p.th > x);
    if (i === -1) i = n; // beyond the last point → wrap to the first
    const a = sorted[(i - 1 + n) % n], b = sorted[i % n];
    const ta = a.th - (i === 0 ? 2 * Math.PI : 0), tb = b.th + (i === n ? 2 * Math.PI : 0);
    const u = tb > ta ? (x - ta) / (tb - ta) : 0;
    return a.z + u * (b.z - a.z);
  };
}
