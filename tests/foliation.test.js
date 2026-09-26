/**
 * Foliation identities of docs/THEORY.md §10, checked on simulated yarns and computed geodesics:
 *  - Clairaut with a source term: along any curve on a surface of revolution,
 *    κ_g = −(1/r) d(r sin α)/dσ (σ meridian arc length; convention b = n × t);
 *  - the spacing ρ = √(r² − c²) of a Clairaut geodesic family is a Jacobi field, ρ'' + Kρ = 0;
 *  - a flat tape of width w on a curve with geodesic curvature κ_g has edge strains ∓ w κ_g / 2.
 */
import { Simulation } from "../src/core/simulation.js";
import { makeProfile } from "../src/core/profiles.js";
import { SurfaceOfRevolution } from "../src/core/surface.js";
import { integrateGeodesic } from "../src/core/geodesic.js";
import { FLAG } from "../src/core/yarnPath.js";
import { defaultParams, defaultShapes, profileSpec, toSimConfig } from "../src/params.js";
import { assert } from "./assert.js";

const runToEnd = (mandrel) => {
  const sim = new Simulation(toSimConfig({ ...defaultParams(), mandrel }));
  while (!sim.ended) sim.advance(10);
  return sim;
};
const SKIP = FLAG.TIE | FLAG.BRIDGE | FLAG.CONTACT | FLAG.LIFTOFF;

Deno.test("foliation: Clairaut with a source term matches the closed-form κ_g", () => {
  for (const mandrel of ["taper", "cone", "bulge", "hourglass"]) {
    const sim = runToEnd(mandrel), prof = sim.profile;
    for (const y of [sim.yarns[0], sim.yarns[sim.machine.perFamily]]) {
      const c = (i) => prof.evaluate(y.zp[i]).r * Math.sin(y.alpha[i]);
      const q = (z) => Math.sqrt(1 + prof.evaluate(z).dr ** 2);
      let maxErr = 0, maxKg = 0, n = 0;
      for (let k = 2; k < y.count - 2; k++) {
        let skip = y.zp[k] < 0.05;
        for (let i = k - 2; i <= k + 2; i++) skip ||= (y.flags[i] & SKIP) !== 0;
        if (skip) continue;
        // σ(k+2) − σ(k−2) by Simpson's rule in z; central difference of r sin α.
        const za = y.zp[k - 2], zb = y.zp[k + 2];
        const dSigma = ((zb - za) * (q(za) + 4 * q(0.5 * (za + zb)) + q(zb))) / 6;
        const kgClairaut = -(c(k + 2) - c(k - 2)) / dSigma / prof.evaluate(y.zp[k]).r;
        maxErr = Math.max(maxErr, Math.abs(kgClairaut - y.kg[k]));
        maxKg = Math.max(maxKg, Math.abs(y.kg[k]));
        n++;
      }
      assert(n > 1000, `${mandrel}: enough samples (${n})`);
      assert(maxKg > 0.5, `${mandrel}: non-trivial geodesic curvature (${maxKg})`);
      assert(maxErr < 3e-3 * maxKg, `${mandrel}: error ${maxErr} vs max |κ_g| ${maxKg}`);
    }
  }
});

Deno.test("foliation: spacing of a Clairaut geodesic family is a Jacobi field", () => {
  for (const kind of ["taper", "bulge", "hourglass"]) {
    const prof = makeProfile(
      profileSpec({ ...defaultParams(), mandrel: kind, shapes: defaultShapes() }),
    );
    const surf = new SurfaceOfRevolution(prof);
    const g = integrateGeodesic(prof, { z0: 0.05, th0: 0, alpha0: 0.35, ds: 2e-4, maxLength: 3 });
    const c = prof.evaluate(g.z[0]).r * Math.sin(g.alpha[0]);
    const rho = g.z.map((z) => Math.sqrt(prof.evaluate(z).r ** 2 - c * c));
    let maxRes = 0, maxKrho = 0;
    for (let k = 1; k < g.z.length - 1; k++) {
      const h = g.s[k + 1] - g.s[k];
      const d2 = (rho[k + 1] - 2 * rho[k] + rho[k - 1]) / (h * h);
      const Krho = surf.principal(g.z[k]).K * rho[k];
      maxRes = Math.max(maxRes, Math.abs(d2 + Krho));
      maxKrho = Math.max(maxKrho, Math.abs(Krho));
    }
    assert(g.z.at(-1) > prof.length - 1e-3, `${kind}: geodesic crosses the mandrel`);
    assert(maxKrho > 1, `${kind}: curvature matters (${maxKrho})`);
    assert(maxRes < 5e-3 * maxKrho, `${kind}: Jacobi residual ${maxRes} vs ${maxKrho}`);
  }
});

Deno.test("foliation: flat-tape edge strain is ∓ w κ_g / 2", () => {
  const sim = runToEnd("taper"), y = sim.yarns[0], surf = sim.surface, w = 0.005;
  const edge = (k, sgn) => {
    const t = [y.tx[k], y.ty[k], y.tz[k]], n = [y.nx[k], y.ny[k], y.nz[k]];
    const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const x = [0, 1, 2].map((i) => y.point(k)[i] + (sgn * w * b[i]) / 2);
    const p = surf.projectRadially(x, y.th[k]);
    return surf.point(p.z, p.th);
  };
  const length = (pts) =>
    pts.slice(1).reduce(
      (a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]),
      0,
    );
  let checked = 0;
  for (const z of [0.2, 0.33, 0.36, 0.39, 0.6]) {
    let k0 = 1;
    while (y.zp[k0] < z) k0++;
    const ks = Array.from({ length: 20 }, (_, i) => k0 + i);
    const L = length(ks.map((k) => y.point(k)));
    const kg = ks.reduce((a, k) => a + y.kg[k], 0) / ks.length;
    for (const sgn of [1, -1]) {
      const strain = (length(ks.map((k) => edge(k, sgn))) - L) / L;
      const predicted = (-sgn * w * kg) / 2;
      assert(
        Math.abs(strain - predicted) < 0.03 * Math.abs(predicted),
        `z=${z}, side ${sgn}: strain ${strain} vs ${predicted}`,
      );
      checked++;
    }
  }
  assert(checked === 10, "all windows checked");
});
