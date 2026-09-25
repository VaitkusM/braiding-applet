/**
 * Validation of the fell-point deposition model (the physics core):
 *  1. cylinder steady state: α → atan(ωr/v), h → √(R_g² − r²)/tan α, κ_g → 0;
 *  2. cylinder transient after wrap start = Du & Popper (1994) exponential;
 *  3. curved (taper) mandrel: agreement with an independent SciPy solution of the exact on-axis
 *     scalar ODE (tests/fixtures), and second-order convergence of the Heun scheme;
 *  4. closed-form κₙ, κ_g of the deposited curve = finite differences of the deposited polyline;
 *  5. symmetry: general solver = symmetric solver; mirror symmetry of the two families;
 *  6. flags: bridging on a deep waist, contact jumps on a steep bulge, slip on a steep cone.
 */
import { Simulation } from "../src/core/simulation.js";
import { FLAG } from "../src/core/yarnPath.js";
import { duPopperConvergenceLength } from "../src/core/analysis.js";
import * as V from "../src/core/vec.js";
import { assert, assertClose, assertRelClose } from "./assert.js";

const DEG = Math.PI / 180;

/** Default test configuration (SI); override fields per test. */
function config(over = {}) {
  return {
    carriers: 16,
    m: 2,
    omega: 1,
    takeUp: 0.04,
    ringRadius: 0.15,
    profile: { kind: "cylinder", length: 1.6, radius: 0.04 },
    offsetX: 0,
    offsetY: 0,
    tilt: 0,
    tieZ: 0.02,
    initialConvergence: 0.05,
    triaxial: false,
    yarnWidth: 0.004,
    axialWidth: 0.004,
    yarnThickness: 5e-4,
    tension: 5,
    friction: 0.2,
    dsMax: 5e-4,
    dphiMax: 0.5 * DEG,
    turnMax: 1 * DEG,
    ...over,
  };
}

Deno.test("deposition: cylinder steady state matches the classical solution", () => {
  const sim = new Simulation(config());
  sim.advance(45);
  const r = 0.04, R = 0.15, alpha = Math.atan(1 * r / 0.04);
  for (const k of [0, 8]) {
    const y = sim.yarns[k], i = y.last;
    assertRelClose(Math.abs(y.alpha[i]), alpha, 1e-4, `α (yarn ${k})`);
    assertRelClose(y.kn[i], Math.sin(alpha) ** 2 / r, 1e-4, "κₙ = sin²α / r");
    assertClose(y.kg[i], 0, 1e-3, "κ_g = 0 (helix is a geodesic)");
  }
  const s = sim.series, n = s.t.length - 1;
  assertRelClose(s.hPlus[n], Math.sqrt(R * R - r * r) / Math.tan(alpha), 1e-4, "h∞");
  assertRelClose(s.hMinus[n], s.hPlus[n], 1e-9, "both families");
  assert(sim.stats.slip === 0 && sim.stats.bridge === 0 && sim.stats.contact === 0, "no flags");
});

Deno.test("deposition: cylinder transient follows Du & Popper (1994)", () => {
  const sim = new Simulation(config());
  sim.advance(20);
  const w = sim.wrapStart;
  assert(w !== null, "wrapping started");
  const s = sim.series;
  let maxErr = 0;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] < w.time) continue;
    const ref = duPopperConvergenceLength(s.t[i] - w.time, {
      h0: w.h,
      r: 0.04,
      ringRadius: 0.15,
      omega: 1,
      v: 0.04,
    });
    maxErr = Math.max(maxErr, Math.abs(s.hPlus[i] - ref));
  }
  assert(maxErr < 1e-5, `max |h − h_DuPopper| = ${maxErr} m`);
});

// ── Curved mandrel vs independent SciPy reference ─────────────────────────────────────────────
const fixture = JSON.parse(
  Deno.readTextFileSync(new URL("./fixtures/taper_scalar_ode.json", import.meta.url)),
);

/** Runs the taper case and returns the max position error vs the fixture. */
function taperError(ds) {
  const c = fixture.case;
  const sim = new Simulation(config({
    omega: c.omega,
    takeUp: c.takeUp,
    ringRadius: c.ringRadius,
    profile: {
      kind: "taper",
      length: c.length,
      r0: c.r0,
      r1: c.r1,
      zStart: c.zStart,
      zEnd: c.zEnd,
    },
    tieZ: c.tieZ,
    initialConvergence: c.initialConvergence,
    dsMax: ds,
    dphiMax: 10 * ds, // step limited by ds only
    turnMax: 10, // no adaptive shrinking: fixed step sequence for the order test
  }));
  let err = 0;
  for (let i = 0; i < fixture.t.length; i++) {
    sim.advance(fixture.t[i] - sim.time);
    const s = sim.solvers[0];
    const r = sim.profile.evaluate(s.z).r;
    err = Math.max(err, Math.abs(s.z - fixture.z[i]), r * Math.abs(s.th - fixture.theta[i]));
  }
  return err;
}

Deno.test("deposition: curved mandrel agrees with SciPy reference, 2nd-order convergence", () => {
  const e1 = taperError(2e-3), e2 = taperError(1e-3), e3 = taperError(5e-4);
  assert(e3 < 1e-7, `error at ds = 0.5 mm: ${e3} m`);
  const p1 = Math.log2(e1 / e2), p2 = Math.log2(e2 / e3);
  assert(p1 > 1.8 && p2 > 1.8, `observed orders ${p1.toFixed(2)}, ${p2.toFixed(2)}`);
});

Deno.test("deposition: closed-form κₙ, κ_g equal finite differences of the deposited path", () => {
  const sim = new Simulation(config({
    profile: { kind: "cone", length: 1.0, r0: 0.03, r1: 0.07 },
    takeUp: 0.03,
    dsMax: 2.5e-4,
  }));
  sim.advance(18);
  const y = sim.yarns[0];
  let checked = 0;
  const w = 8; // stencil half-width (samples)
  for (let i = y.count - 400; i < y.count - w; i += 37) {
    const a = y.point(i - w), b = y.point(i), c = y.point(i + w);
    const l1 = V.dist(a, b), l2 = V.dist(b, c);
    const kvec = V.scale(
      V.sub(V.scale(V.sub(c, b), 1 / l2), V.scale(V.sub(b, a), 1 / l1)),
      2 / (l1 + l2),
    );
    const n = [y.nx[i], y.ny[i], y.nz[i]], t = [y.tx[i], y.ty[i], y.tz[i]];
    const bvec = V.cross(n, t);
    assertRelClose(-V.dot(kvec, n), y.kn[i], 2e-3, "κₙ");
    assertClose(V.dot(kvec, bvec), y.kg[i], 2e-3 * y.kn[i], "κ_g");
    checked++;
  }
  assert(checked >= 8, "enough samples");
  // On a cone the braided path is NOT a geodesic.
  assert(Math.abs(y.kg[y.count - 100]) > 0.05, "cone path has geodesic curvature");
});

Deno.test("deposition: general solver reproduces the symmetric solver; families are mirror images", () => {
  const prof = {
    kind: "bulge",
    length: 0.7,
    radius: 0.035,
    amplitude: 0.012,
    center: 0.35,
    halfWidth: 0.12,
  };
  const a = new Simulation(config({ profile: prof, takeUp: 0.03 }));
  const b = new Simulation(config({ profile: prof, takeUp: 0.03, forceGeneral: true }));
  const c = new Simulation(config({ profile: prof, takeUp: 0.03, offsetX: 1e-12 })); // generic path
  for (const s of [a, b, c]) s.advance(8);
  assert(a.symmetric && !b.symmetric && !c.symmetric, "modes");
  for (const k of [3, 11]) {
    const ya = a.yarns[k], yb = b.yarns[k], yc = c.yarns[k];
    assert(ya.count === yb.count, "same number of samples");
    let d = 0;
    for (let i = 0; i < ya.count; i++) {
      d = Math.max(d, V.dist(ya.point(i), yb.point(i)), V.dist(ya.point(i), yc.point(i)));
    }
    assert(d < 1e-8, `max deviation ${d} m (yarn ${k})`);
  }
  // Mirror symmetry about θ = π/N: "−" yarn 0 is the reflection of "+" yarn 0.
  const P = a.yarns[0], M = a.yarns[8], c0 = Math.PI / 16;
  for (let i = 0; i < P.count; i += 50) {
    assertClose(M.zp[i], P.zp[i], 1e-9, "same z");
    assertClose(M.th[i], 2 * c0 - P.th[i], 1e-9, "mirrored θ");
  }
});

Deno.test("deposition: off-axis mandrel runs, yarns differ around the circumference", () => {
  const sim = new Simulation(
    config({
      offsetX: 0.02,
      tilt: 5 * DEG,
      profile: { kind: "cylinder", length: 0.8, radius: 0.04 },
    }),
  );
  sim.advance(12);
  assert(!sim.symmetric, "general mode");
  const hs = sim.series.hMax.at(-1) - sim.series.hMin.at(-1);
  assert(hs > 5e-3, `convergence length varies around the ring (${hs} m)`);
  const alphas = sim.yarns.map((y) => Math.abs(y.alpha[y.last]));
  assert(Math.max(...alphas) - Math.min(...alphas) > 1 * DEG, "braid angle varies");
  assert(sim.crossings.count > 100, "crossings detected off-axis");
});

Deno.test("deposition: flags — bridging on a waist, contact on a bulge, slip on a steep cone", () => {
  // Deep, short waist with a low braid angle: the yarn must span the concave region.
  const waist = new Simulation(config({
    profile: {
      kind: "hourglass",
      length: 0.8,
      radius: 0.05,
      depth: 0.03,
      center: 0.35,
      halfWidth: 0.08,
    },
    takeUp: 0.15,
  }));
  waist.advance(6);
  assert(waist.stats.bridge > 0, `bridging expected (stats ${JSON.stringify(waist.stats)})`);

  // Steep bulge at low braid angle: the free yarn catches on it.
  const bulge = new Simulation(config({
    profile: {
      kind: "bulge",
      length: 0.8,
      radius: 0.03,
      amplitude: 0.03,
      center: 0.35,
      halfWidth: 0.06,
    },
    takeUp: 0.12,
  }));
  bulge.advance(8);
  assert(bulge.stats.contact > 0, `contact jumps expected (stats ${JSON.stringify(bulge.stats)})`);

  // Steep cone with a low friction coefficient: kinematic paths need more friction than available.
  const cone = new Simulation(config({
    profile: { kind: "cone", length: 0.8, r0: 0.02, r1: 0.1 },
    takeUp: 0.02,
    friction: 0.05,
  }));
  cone.advance(15);
  assert(cone.stats.slip > 0, `slip expected (stats ${JSON.stringify(cone.stats)})`);
  // …while the steady cylinder never slips.
  const cyl = new Simulation(config());
  cyl.advance(5);
  assert(cyl.stats.slip === 0, "cylinder does not slip");
  assert((cyl.currentFlags[0] & FLAG.SLIP) === 0, "current flag clear");
});

Deno.test("deposition: triaxial axial yarns lie on meridians and follow the fell line", () => {
  const sim = new Simulation(config({ triaxial: true }));
  sim.advance(10);
  assert(sim.axialYarns.length === sim.machine.gearCount, "one axial yarn per gear");
  for (const y of sim.axialYarns) {
    assert(y.count > 10, "axial yarn grows");
    const th0 = y.th[0];
    for (let i = 0; i < y.count; i++) assertClose(y.th[i], th0, 0, "constant azimuth");
    assertClose(y.zp[y.last], sim.solvers[0].z, sim.config.dsMax + 1e-9, "reaches the fell line");
  }
});
