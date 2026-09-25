/** Closed-form reference formulas: quasi-static kinematics, cover factor, jamming, binning. */
import {
  binByZ,
  contactPressure,
  coverFactor,
  cylinderConvergenceLength,
  duPopperConvergenceLength,
  jammingAngle,
  quasiStaticAngle,
  quasiStaticConvergenceLength,
  takeUpForAngle,
} from "../src/core/analysis.js";
import { makeProfile } from "../src/core/profiles.js";
import { assert, assertClose, assertRelClose } from "./assert.js";

Deno.test("analysis: quasi-static angle and convergence length", () => {
  const cyl = makeProfile({ kind: "cylinder", length: 1, radius: 0.04 });
  const a = quasiStaticAngle(cyl, 0.3, 1.2, 0.05);
  assertClose(Math.tan(a), 1.2 * 0.04 / 0.05, 1e-14, "tan α = ωr/v");
  const h = quasiStaticConvergenceLength(cyl, 0.3, 1.2, 0.05, 0.15);
  assertRelClose(h, cylinderConvergenceLength(0.04, 0.15, a), 1e-12, "cylinder h");
  assertRelClose(takeUpForAngle(1.2, 0.04, a), 0.05, 1e-12, "inverse");
  // Sloped profile: meridian speed v√(1+r'²) enters the formula.
  const cone = makeProfile({ kind: "cone", length: 1, r0: 0.03, r1: 0.08 });
  const z = 0.5, e = cone.evaluate(z), ac = quasiStaticAngle(cone, z, 1, 0.04);
  assertClose(Math.tan(ac), (1 * e.r) / (0.04 * Math.sqrt(1 + e.dr * e.dr)), 1e-14);
  assert(
    Number.isNaN(quasiStaticConvergenceLength(cyl, 0.3, 1, 0.05, 0.03)),
    "ring inside mandrel",
  );
  // The tangent line really reaches the ring radius at axial distance h.
  const hc = quasiStaticConvergenceLength(cone, z, 1, 0.04, 0.2);
  const q = Math.sqrt(1 + e.dr * e.dr);
  const t = [Math.cos(ac) * e.dr / q, Math.sin(ac), Math.cos(ac) / q];
  const ell = hc / t[2];
  assertRelClose(Math.hypot(e.r + ell * t[0], ell * t[1]), 0.2, 1e-12, "reaches R_g");
});

Deno.test("analysis: Du & Popper transient limits", () => {
  const p = { h0: 0.05, r: 0.04, ringRadius: 0.15, omega: 1, v: 0.04 };
  assertClose(duPopperConvergenceLength(0, p), 0.05, 1e-15);
  assertRelClose(
    duPopperConvergenceLength(1e3, p),
    Math.sqrt(0.15 ** 2 - 0.04 ** 2) * 0.04 / 0.04,
    1e-12,
  );
});

Deno.test("analysis: cover factor, triaxial cover and jamming", () => {
  // k = N w / (4π r cos α)
  const c = coverFactor({ carriers: 32, width: 0.008, r: 0.04, alpha: Math.PI / 4 });
  assertRelClose(c.k, 32 * 0.008 / (4 * Math.PI * 0.04 * Math.cos(Math.PI / 4)), 1e-14);
  assertClose(c.cover, 2 * c.k - c.k * c.k, 1e-14, "CF = 2k − k²");
  assert(!c.jammed, "not jammed");
  const aj = jammingAngle(32, 0.008, 0.04);
  assertClose(Math.cos(aj), 32 * 0.008 / (4 * Math.PI * 0.04), 1e-14);
  const atJam = coverFactor({ carriers: 32, width: 0.008, r: 0.04, alpha: aj + 1e-9 });
  assert(atJam.jammed && atJam.cover === 1, "jammed beyond α_jam, CF clamped to 1");
  assertClose(jammingAngle(100, 0.01, 0.04), 0, 0, "jammed at every angle");
  const tri = coverFactor({
    carriers: 32,
    width: 0.008,
    r: 0.04,
    alpha: 0.5,
    axialCount: 16,
    axialWidth: 0.004,
  });
  const ka = 16 * 0.004 / (2 * Math.PI * 0.04);
  assertClose(tri.ka, ka, 1e-14);
  assertClose(tri.cover, 1 - (1 - tri.k) ** 2 * (1 - ka), 1e-14, "triaxial CF");
  assertClose(contactPressure(5, 12.5), 62.5, 1e-12, "p = Tκₙ");
});

Deno.test("analysis: binByZ", () => {
  const b = binByZ([0.05, 0.15, 0.16, 0.95], [1, 2, 4, NaN], 4, 0, 1, 10);
  assertClose(b.mean[0], 1, 0);
  assertClose(b.mean[1], 3, 0);
  assertClose(b.min[1], 2, 0);
  assertClose(b.max[1], 4, 0);
  assert(Number.isNaN(b.mean[9]) && Number.isNaN(b.mean[5]), "empty / non-finite bins are NaN");
});
