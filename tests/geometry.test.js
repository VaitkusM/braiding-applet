/**
 * Geometry tests: profiles (derivatives, C² joins), surface fundamental forms and curvatures
 * (checked against a sphere zone, where every normal curvature is 1/ρ), geodesics (Clairaut,
 * helices, great circles) and the mandrel pose.
 */
import { defaultCustomPoints, makeProfile, validateProfile } from "../src/core/profiles.js";
import { SurfaceOfRevolution } from "../src/core/surface.js";
import { clairautAlpha, integrateGeodesic } from "../src/core/geodesic.js";
import { MandrelPose } from "../src/core/pose.js";
import * as V from "../src/core/vec.js";
import { assert, assertClose, assertRelClose, assertVecClose } from "./assert.js";

const PRESETS = [
  { kind: "cylinder", length: 0.6, radius: 0.04 },
  { kind: "cone", length: 0.6, r0: 0.03, r1: 0.06 },
  { kind: "taper", length: 0.8, r0: 0.03, r1: 0.055, zStart: 0.25, zEnd: 0.5 },
  { kind: "bulge", length: 0.6, radius: 0.035, amplitude: 0.02, center: 0.3, halfWidth: 0.12 },
  { kind: "hourglass", length: 0.6, radius: 0.05, depth: 0.02, center: 0.3, halfWidth: 0.15 },
  { kind: "custom", length: 0.6, points: defaultCustomPoints() },
];

/** A sphere zone of radius rho centred at z = c (for curvature checks; not a preset). */
function sphereZone(rho, c, length) {
  return {
    kind: "sphere-test",
    length,
    rMax: rho,
    rMin: 0,
    evaluate: (z) => {
      const u = z - c, r = Math.sqrt(rho * rho - u * u);
      return { r, dr: -u / r, d2r: -(rho * rho) / (r * r * r) };
    },
  };
}

Deno.test("profiles: r' and r'' agree with finite differences (all presets)", () => {
  const h = 1e-6;
  for (const spec of PRESETS) {
    const p = makeProfile(spec);
    for (let i = 1; i < 60; i++) {
      const z = (i / 60) * spec.length;
      const e = p.evaluate(z), ep = p.evaluate(z + h), em = p.evaluate(z - h);
      assertClose(e.dr, (ep.r - em.r) / (2 * h), 1e-7, `${spec.kind} r' at ${z}`);
      assertClose(e.d2r, (ep.dr - em.dr) / (2 * h), 2e-4, `${spec.kind} r'' at ${z}`);
    }
  }
});

Deno.test("profiles: C² joins at taper ends and bump edges", () => {
  const eps = 1e-9;
  const joins = [
    [PRESETS[2], [0.25, 0.5]],
    [PRESETS[3], [0.18, 0.42]],
    [PRESETS[4], [0.15, 0.45]],
  ];
  for (const [spec, zs] of joins) {
    const p = makeProfile(spec);
    for (const z of zs) {
      const L = p.evaluate(z - eps), R = p.evaluate(z + eps);
      assertClose(L.r, R.r, 1e-12, `${spec.kind} C0 @${z}`);
      assertClose(L.dr, R.dr, 1e-7, `${spec.kind} C1 @${z}`);
      assertClose(L.d2r, R.d2r, 1e-4, `${spec.kind} C2 @${z}`);
    }
  }
});

Deno.test("profiles: extremes, validation flags spline overshoot and thin radii", () => {
  const cone = makeProfile(PRESETS[1]);
  assertClose(cone.rMin, 0.03, 1e-12);
  assertClose(cone.rMax, 0.06, 1e-12);
  assert(validateProfile(cone).ok, "cone should be valid");
  const bad = makeProfile({
    kind: "custom",
    length: 0.3,
    points: [[0, 0.02], [0.05, 0.002], [0.1, 0.02], [0.3, 0.02]],
  });
  const v = validateProfile(bad);
  assert(!v.ok && v.messages.length > 0, "overshooting spline must be flagged");
});

Deno.test("surface: frame orthogonality, outward normal, fundamental forms by finite differences", () => {
  const surf = new SurfaceOfRevolution(makeProfile(PRESETS[5]));
  const h = 1e-5;
  for (const [z, th] of [[0.13, 0.4], [0.31, -2.2], [0.47, 3.0]]) {
    const f = surf.frame(z, th);
    assertClose(V.norm(f.n), 1, 1e-14);
    assertClose(V.dot(f.n, f.Sz), 0, 1e-14);
    assertClose(V.dot(f.n, f.St), 0, 1e-14);
    assert(V.dot(f.n, [Math.cos(th), Math.sin(th), 0]) > 0, "normal must point outward");
    // n = (S_θ × S_z)/|…|
    assertVecClose(V.normalize(V.cross(f.St, f.Sz)), f.n, 1e-14);
    // Second fundamental form from finite differences of S.
    const S = (a, b) => surf.point(a, b);
    const Szz = V.scale(
      V.add(V.sub(S(z + h, th), V.scale(S(z, th), 2)), S(z - h, th)),
      1 / (h * h),
    );
    const Stt = V.scale(
      V.add(V.sub(S(z, th + h), V.scale(S(z, th), 2)), S(z, th - h)),
      1 / (h * h),
    );
    assertClose(V.dot(Szz, f.n), f.ii_zz, 1e-4, "ii_zz");
    assertClose(V.dot(Stt, f.n), f.ii_tt, 1e-6, "ii_tt");
    assertClose(V.dot(f.Sz, f.Sz), f.g_zz, 1e-14);
    assertClose(V.dot(f.St, f.St), f.g_tt, 1e-14);
  }
});

Deno.test("surface: sphere zone has κₙ = 1/ρ in every direction, K = 1/ρ², H = 1/ρ", () => {
  const rho = 0.05;
  const surf = new SurfaceOfRevolution(sphereZone(rho, 0.05, 0.1));
  for (const z of [0.02, 0.05, 0.081]) {
    const pr = surf.principal(z);
    assertRelClose(pr.k_m, 1 / rho, 1e-12, "k_m");
    assertRelClose(pr.k_p, 1 / rho, 1e-12, "k_p");
    assertRelClose(pr.K, 1 / (rho * rho), 1e-12, "K");
    assertRelClose(pr.H, 1 / rho, 1e-12, "H");
    const f = surf.frame(z, 0.7);
    for (const psi of [0, 0.4, 1.1, Math.PI / 2, 2.5]) {
      const t = V.add(V.scale(f.m, Math.cos(psi)), V.scale(f.e, Math.sin(psi)));
      assertRelClose(surf.normalCurvature(f, t), 1 / rho, 1e-12, `κₙ(ψ=${psi})`);
    }
  }
});

Deno.test("surface: cylinder curvatures, Euler's formula and braid angle on a general profile", () => {
  const cyl = new SurfaceOfRevolution(makeProfile(PRESETS[0]));
  const pc = cyl.principal(0.2);
  assertClose(pc.k_m, 0, 0);
  assertRelClose(pc.k_p, 1 / 0.04, 1e-14);
  assertClose(pc.K, 0, 0);
  const surf = new SurfaceOfRevolution(makeProfile(PRESETS[4]));
  for (const z of [0.2, 0.3, 0.37]) {
    const f = surf.frame(z, 1.3), pr = surf.principal(z);
    for (const psi of [0.2, 0.9, -1.2]) {
      const t = V.add(V.scale(f.m, Math.cos(psi)), V.scale(f.e, Math.sin(psi)));
      const euler = pr.k_m * Math.cos(psi) ** 2 + pr.k_p * Math.sin(psi) ** 2;
      assertClose(surf.normalCurvature(f, t), euler, 1e-10, `Euler z=${z} ψ=${psi}`);
      assertClose(surf.braidAngle(f, t), psi, 1e-12, "braid angle");
    }
  }
  // Waist of the hourglass has negative Gaussian curvature.
  assert(surf.principal(0.3).K < 0, "hourglass waist must have K < 0");
});

Deno.test("geodesic: helix on a cylinder, Clairaut invariant on curved profiles", () => {
  const cyl = makeProfile(PRESETS[0]);
  const g = integrateGeodesic(cyl, { z0: 0.1, th0: 0, alpha0: 0.8, ds: 1e-3, maxLength: 0.3 });
  const last = g.z.length - 1;
  assertClose(g.z[last] - 0.1, g.s[last] * Math.cos(0.8), 1e-10, "helix axial advance");
  assertClose(g.th[last], g.s[last] * Math.sin(0.8) / 0.04, 1e-9, "helix twist");

  for (const spec of [PRESETS[1], PRESETS[3], PRESETS[4]]) {
    const p = makeProfile(spec);
    const geo = integrateGeodesic(p, { z0: 0.05, th0: 0, alpha0: 0.6, ds: 5e-4, maxLength: 1.5 });
    const c0 = geo.clairaut[0];
    for (const c of geo.clairaut) assertClose(c, c0, 1e-8, `${spec.kind} Clairaut`);
    // α from the integrator agrees with asin(c/r) wherever the geodesic is heading to +z.
    const i = Math.floor(geo.z.length / 3);
    assertClose(Math.sin(geo.alpha[i]), Math.sin(clairautAlpha(p, c0, geo.z[i])), 1e-7);
  }
  const custom = makeProfile(PRESETS[5]);
  const gc = integrateGeodesic(custom, { z0: 0.02, th0: 0, alpha0: 0.5, ds: 5e-4, maxLength: 1 });
  for (const c of gc.clairaut) assertClose(c, gc.clairaut[0], 1e-6, "custom Clairaut");
  assert(Number.isNaN(clairautAlpha(custom, 1, 0.3)), "beyond turning point → NaN");
});

Deno.test("geodesic: great circles on a sphere zone stay in a plane through the centre", () => {
  const rho = 0.05, c = 0.05;
  const p = sphereZone(rho, c, 0.1);
  const g = integrateGeodesic(p, { z0: c, th0: 0, alpha0: 0.7, ds: 2e-4, maxLength: 0.12 });
  const surf = new SurfaceOfRevolution(p);
  const P = g.z.map((z, i) => V.sub(surf.point(z, g.th[i]), [0, 0, c]));
  const normal = V.normalize(V.cross(P[0], P[10]));
  for (const x of P) assertClose(V.dot(x, normal), 0, 1e-9, "planarity");
});

Deno.test("pose: frame round trip, ring piercing point, relative velocity", () => {
  const pose = new MandrelPose({ offsetX: 0.01, offsetY: -0.004, tilt: 0.2, d0: 0.05, v: 0.03 });
  const xM = [0.02, -0.03, 0.4];
  for (const t of [0, 1.7, 5]) {
    assertVecClose(pose.toMandrel(pose.toMachine(xM, t), t), xM, 1e-15);
    // The axis point at z_M = ringAxisParam(t) lies in the ring plane at the offset e.
    const pierce = pose.toMachine([0, 0, pose.ringAxisParam(t)], t);
    assertVecClose(pierce, [0.01, -0.004, 0], 1e-15, "axis pierces ring at e");
  }
  // Relative velocity of a rotating guide point, compared with finite differences.
  const R = 0.15, w = 1.3;
  const G = (t) => [R * Math.cos(w * t), R * Math.sin(w * t), 0];
  const dG = (t) => [-R * w * Math.sin(w * t), R * w * Math.cos(w * t), 0];
  const t = 0.9, h = 1e-6;
  const fd = V.scale(
    V.sub(pose.toMandrel(G(t + h), t + h), pose.toMandrel(G(t - h), t - h)),
    0.5 / h,
  );
  assertVecClose(pose.velocityToMandrel(dG(t)), fd, 1e-8, "Ġ in mandrel frame");
  // Moves downstream (−z in the machine frame).
  assert(pose.origin(1)[2] < pose.origin(0)[2], "mandrel moves towards −z");
  assertClose(pose.requiredRingRadius(0.05), Math.hypot(0.01, 0.004) + 0.05 / Math.cos(0.2), 1e-15);
  assert(new MandrelPose({ d0: 0, v: 0.01 }).isOnAxis, "default pose is on-axis");
});
