import {
  brent,
  clamp,
  firstSignChange,
  goldenMin,
  naturalCubicSpline,
  rk4Step,
  smootherstep,
  wrap2Pi,
  wrapPi,
} from "../src/core/numeric.js";
import { assert, assertClose, assertThrows } from "./assert.js";

Deno.test("brent: finds roots of smooth functions to tolerance", () => {
  const r = brent((x) => x * x * x - 2 * x - 5, 2, 3, { xtol: 1e-14 });
  assert(r.converged, "converged");
  assertClose(r.x, 2.0945514815423265, 1e-12);
  const c = brent(Math.cos, 0, 3);
  assertClose(c.x, Math.PI / 2, 1e-12);
  assertThrows(() => brent((x) => x * x + 1, -1, 1), "unbracketed root must throw");
});

Deno.test("firstSignChange: returns the FIRST crossing, not a later one", () => {
  // f has roots at 1, 3, 5: negative before 1, positive on (1,3), negative on (3,5), positive after 5.
  const f = (s) => (s - 1) * (s - 3) * (s - 5);
  const br = firstSignChange(f, f(0), 0.1, 10);
  assert(br !== null, "bracket found");
  assert(br.a < 1 && br.b >= 1 && br.b < 3, `bracket [${br.a}, ${br.b}] must contain first root`);
  const r = brent(f, br.a, br.b, { fa: br.fa, fb: br.fb });
  assertClose(r.x, 1, 1e-10);
  assert(firstSignChange((s) => -1 - s, -1, 0.1, 5) === null, "no root → null");
});

Deno.test("goldenMin: minimum of a parabola", () => {
  const m = goldenMin((x) => (x - 0.3) ** 2 + 1, -2, 2, 1e-10);
  // A flat minimum can only be located to ~sqrt(machine eps) in x.
  assertClose(m.x, 0.3, 1e-7);
  assertClose(m.fx, 1, 1e-12);
});

Deno.test("rk4Step: 4th-order accuracy on y' = y", () => {
  const f = (_t, y) => [y[0]];
  const run = (h) => {
    let y = [1];
    const n = Math.round(1 / h);
    for (let i = 0; i < n; i++) y = rk4Step(f, i * h, y, h);
    return Math.abs(y[0] - Math.E);
  };
  const e1 = run(0.1), e2 = run(0.05);
  assert(e1 < 1e-5, `error ${e1}`);
  const order = Math.log2(e1 / e2);
  assert(order > 3.8 && order < 4.2, `observed order ${order}`);
});

Deno.test("naturalCubicSpline: interpolates, is C², natural ends, reproduces lines", () => {
  const xs = [0, 0.1, 0.25, 0.4, 0.7, 1.0];
  const ys = [0.03, 0.035, 0.05, 0.045, 0.04, 0.06];
  const sp = naturalCubicSpline(xs, ys);
  xs.forEach((x, i) => assertClose(sp.evaluate(x).y, ys[i], 1e-15, `knot ${i}`));
  assertClose(sp.m[0], 0, 0);
  assertClose(sp.m[xs.length - 1], 0, 0);
  // Continuity of y, y', y'' across interior knots (evaluate just left/right).
  const eps = 1e-9;
  for (let i = 1; i < xs.length - 1; i++) {
    const L = sp.evaluate(xs[i] - eps), R = sp.evaluate(xs[i] + eps);
    assertClose(L.y, R.y, 1e-9, `C0 at ${i}`);
    assertClose(L.dy, R.dy, 1e-6, `C1 at ${i}`);
    assertClose(L.d2y, R.d2y, 1e-4, `C2 at ${i}`);
  }
  // Derivatives agree with finite differences inside a segment.
  const x0 = 0.33, h = 1e-6;
  const e0 = sp.evaluate(x0), ep = sp.evaluate(x0 + h), em = sp.evaluate(x0 - h);
  assertClose(e0.dy, (ep.y - em.y) / (2 * h), 1e-7);
  assertClose(e0.d2y, (ep.dy - em.dy) / (2 * h), 1e-5);
  // A straight line is reproduced exactly, also beyond the ends (linear extension).
  const line = naturalCubicSpline([0, 1, 2, 3], [1, 3, 5, 7]);
  assertClose(line.evaluate(1.7).y, 4.4, 1e-14);
  assertClose(line.evaluate(-1).y, -1, 1e-14);
  assertClose(line.evaluate(4).dy, 2, 1e-14);
  assertThrows(() => naturalCubicSpline([0, 0], [1, 2]));
});

Deno.test("smootherstep: C² with correct derivatives", () => {
  assertClose(smootherstep(0).s, 0, 0);
  assertClose(smootherstep(1).s, 1, 0);
  assertClose(smootherstep(0.5).s, 0.5, 1e-15);
  const h = 1e-6;
  for (const x of [0.13, 0.5, 0.77]) {
    const e = smootherstep(x);
    assertClose(e.ds, (smootherstep(x + h).s - smootherstep(x - h).s) / (2 * h), 1e-8);
    assertClose(e.d2s, (smootherstep(x + h).ds - smootherstep(x - h).ds) / (2 * h), 1e-6);
  }
  for (const x of [0, 1]) {
    assertClose(smootherstep(x).ds, 0, 0);
    assertClose(smootherstep(x).d2s, 0, 0);
  }
});

Deno.test("angle wrapping and clamp", () => {
  assertClose(wrapPi(3 * Math.PI), Math.PI, 1e-12);
  assertClose(wrapPi(-3 * Math.PI / 2), Math.PI / 2, 1e-12);
  assertClose(wrap2Pi(-0.5), 2 * Math.PI - 0.5, 1e-12);
  assertClose(wrap2Pi(7), 7 - 2 * Math.PI, 1e-12);
  assertClose(clamp(5, 0, 1), 1, 0);
  assertClose(clamp(-5, 0, 1), 0, 0);
});
