/**
 * Machine kinematics tests: carrier counts, passings on opposite sides away from gear boundaries,
 * collision-free continuous figure-eight track, axial guides.
 */
import { allowedCarrierCounts, CircularBraider, PATTERNS } from "../src/core/machine.js";
import { wrap2Pi } from "../src/core/numeric.js";
import { assert, assertClose, assertThrows } from "./assert.js";

Deno.test("machine: allowed carrier counts respect 2m | N", () => {
  assert(allowedCarrierCounts(1).includes(10), "diamond allows 10");
  assert(!allowedCarrierCounts(2).includes(10), "regular forbids 10");
  assert(allowedCarrierCounts(2).includes(144), "regular allows 144");
  assert(allowedCarrierCounts(3).every((N) => N % 6 === 0), "Hercules needs 6 | N");
  assertThrows(() => new CircularBraider({ carriers: 20, omega: 1, ringRadius: 0.1, m: 3 }));
});

Deno.test("machine: passings happen on opposite sides, never near a gear boundary", () => {
  for (const { m } of Object.values(PATTERNS)) {
    for (const N of [12, 24, 48].filter((n) => n % (2 * m) === 0)) {
      const mc = new CircularBraider({ carriers: N, omega: 1.3, ringRadius: 0.1, m });
      for (let j = 0; j < N / 2; j++) {
        for (let i = 0; i < N / 2; i++) {
          for (const t of [0.7, 5.3, 11.9]) {
            const p = mc.latestPassing(j, i, t);
            assert(
              p.time <= t + 1e-12 && p.time > t - Math.PI / mc.omega - 1e-12,
              "latest passing",
            );
            // Same azimuth at the passing.
            const a = wrap2Pi(mc.carrierAngle(1, j, p.time)),
              b = wrap2Pi(mc.carrierAngle(-1, i, p.time));
            assertClose(
              Math.min(Math.abs(a - b), 2 * Math.PI - Math.abs(a - b)),
              0,
              1e-9,
              "same azimuth",
            );
            // Passing azimuths are (2π/N)(k + ½): half a carrier spacing from any gear boundary.
            const frac = (p.azimuth / (2 * Math.PI / N)) % 1;
            assertClose(frac, 0.5, 1e-9, "passing at (k + 1/2)·2π/N");
            assert(
              mc.carrierSide(1, p.azimuth) === -mc.carrierSide(-1, p.azimuth),
              "opposite sides",
            );
          }
        }
      }
    }
  }
});

Deno.test("machine: every yarn is over m, under m along its passings (m/m pattern)", () => {
  for (const { m } of Object.values(PATTERNS)) {
    const N = 12 * m;
    const mc = new CircularBraider({ carriers: N, omega: 1, ringRadius: 0.1, m });
    // Successive passings of "+" carrier 0 with the "−" carriers, in time order.
    const events = [];
    for (let i = 0; i < N / 2; i++) {
      for (let p = 0; p < 4; p++) {
        const base = i * mc.delta + mc.delta / 2;
        const t = (base + 2 * Math.PI * p) / (2 * mc.omega);
        events.push({ t, side: mc.carrierSide(1, mc.carrierAngle(1, 0, t)) });
      }
    }
    events.sort((a, b) => a.t - b.t);
    // Run lengths of equal sides (drop the first run, which may be truncated).
    const runs = [];
    let len = 1;
    for (let k = 1; k < events.length; k++) {
      if (events[k].side === events[k - 1].side) len++;
      else {
        runs.push(len);
        len = 1;
      }
    }
    runs.slice(1).forEach((r) => assert(r === m, `pattern ${m}/${m}: run length ${r}`));
    assert(runs.length > 10, "enough runs");
  }
});

Deno.test("machine: figure-eight track is continuous and carriers never collide", () => {
  for (const { m } of Object.values(PATTERNS)) {
    const N = 12 * m;
    const mc = new CircularBraider({ carriers: N, omega: 1, ringRadius: 0.1, m });
    const T = (2 * Math.PI) / mc.omega, steps = 4000, dt = T / steps;
    let minDist = Infinity, maxJump = 0;
    const prev = new Map();
    for (let s = 0; s <= steps; s++) {
      const t = s * dt;
      const plus = [], minus = [];
      for (let j = 0; j < N / 2; j++) {
        const a = mc.carrierTrackXY(1, j, t), b = mc.carrierTrackXY(-1, j, t);
        plus.push(a);
        minus.push(b);
        for (const [key, p] of [[`p${j}`, a], [`m${j}`, b]]) {
          if (prev.has(key)) {
            const q = prev.get(key);
            maxJump = Math.max(maxJump, Math.hypot(p[0] - q[0], p[1] - q[1]));
          }
          prev.set(key, p);
        }
      }
      for (const a of plus) {
        for (const b of minus) minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    // Path speed ≈ gear radius × angular rate; a jump would be orders of magnitude larger.
    const arcPerStep = mc.gearRadius * (Math.PI + mc.gearPitch) / (mc.gearPitch / mc.omega) * dt;
    assert(maxJump < 3 * arcPerStep, `track continuity (jump ${maxJump} vs ${arcPerStep})`);
    // Opposite-family carriers stay a finite distance apart (they pass on opposite arcs).
    assert(
      minDist > 0.1 * mc.gearRadius,
      `min carrier distance ${minDist} (R_h = ${mc.gearRadius})`,
    );
  }
});

Deno.test("machine: guide velocity is the time derivative of the guide point", () => {
  const mc = new CircularBraider({ carriers: 16, omega: 0.8, ringRadius: 0.12, m: 2 });
  const h = 1e-6;
  for (const fam of [1, -1]) {
    const v = mc.guideVelocity(fam, 3, 2.1);
    const a = mc.guidePoint(fam, 3, 2.1 + h), b = mc.guidePoint(fam, 3, 2.1 - h);
    for (let c = 0; c < 3; c++) assertClose(v[c], (a[c] - b[c]) / (2 * h), 1e-8);
  }
  // Axial guides sit at gear centres, one per gear, with alternating over/under per family.
  assertClose(mc.gearCount, 8, 0);
  assert(mc.axialOver(1, 0) === -mc.axialOver(-1, 0), "families opposite at an axial yarn");
  assert(mc.axialOver(1, 0) === -mc.axialOver(1, 1), "alternates between gears");
});
