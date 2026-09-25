/**
 * Interlacing tests: detected crossings carry the over/under sign dictated by the machine, which
 * on a centred mandrel equals the closed-form rule "side of the gear at the crossing azimuth";
 * each yarn alternates in blocks of m; triaxial bias yarns cross every axial yarn; the smoothed
 * side function hits ±1 exactly at crossings.
 */
import { Simulation } from "../src/core/simulation.js";
import { CrossingEvents } from "../src/core/crossings.js";
import { assert, assertClose } from "./assert.js";

const DEG = Math.PI / 180;
const base = {
  omega: 1,
  takeUp: 0.04,
  ringRadius: 0.15,
  profile: { kind: "taper", length: 0.7, r0: 0.03, r1: 0.05, zStart: 0.2, zEnd: 0.45 },
  offsetX: 0,
  offsetY: 0,
  tilt: 0,
  tieZ: 0.02,
  initialConvergence: 0.05,
  triaxial: false,
  yarnWidth: 0.003,
  axialWidth: 0.003,
  yarnThickness: 5e-4,
  tension: 5,
  friction: 0.3,
  dsMax: 5e-4,
  dphiMax: 0.5 * DEG,
  turnMax: 1 * DEG,
};

/** Interpolated θ of yarn y at arc position s. */
function thetaAtArc(y, s) {
  let i = 1;
  while (i < y.count - 1 && y.arc[i] < s) i++;
  const u = (s - y.arc[i - 1]) / (y.arc[i] - y.arc[i - 1]);
  return y.th[i - 1] + u * (y.th[i] - y.th[i - 1]);
}

/** Run lengths of equal consecutive signs. */
function runs(signs) {
  const out = [];
  let len = 1;
  for (let k = 1; k < signs.length; k++) {
    if (signs[k] === signs[k - 1]) len++;
    else {
      out.push(len);
      len = 1;
    }
  }
  out.push(len);
  return out;
}

for (const m of [1, 2, 3]) {
  Deno.test(`crossings (${m}/${m}): signs match the θ rule on-axis and come in blocks of ${m}`, () => {
    const sim = new Simulation({ ...base, carriers: 12 * m, m });
    sim.advance(10);
    const mc = sim.machine, P = mc.perFamily;
    assert(sim.crossings.count > 50, "crossings found");
    for (let k = 0; k < 2 * P; k++) {
      const ev = sim.crossings.events[k], y = sim.yarns[k];
      const fam = k < P ? 1 : -1;
      assert(ev.s.length > 5, `yarn ${k} has crossings`);
      for (let e = 0; e < ev.s.length; e++) {
        // Closed-form rule on a centred mandrel: θ_M = machine azimuth φ, outer carrier is over.
        const expected = mc.carrierSide(fam, thetaAtArc(y, ev.s[e]));
        assert(
          ev.sign[e] === expected,
          `yarn ${k} crossing ${e}: sign ${ev.sign[e]} ≠ ${expected}`,
        );
      }
      const r = runs(ev.sign);
      r.slice(1, -1).forEach((len) => assert(len === m, `yarn ${k}: block length ${len} ≠ ${m}`));
    }
  });
}

Deno.test("crossings: every crossing is shared by exactly one yarn of each family", () => {
  const sim = new Simulation({ ...base, carriers: 16, m: 2 });
  sim.advance(8);
  const P = sim.machine.perFamily;
  let plus = 0, minus = 0, overPlus = 0, overMinus = 0;
  sim.crossings.events.forEach((ev, k) => {
    for (const s of ev.sign) {
      if (k < P) {
        plus++;
        if (s > 0) overPlus++;
      } else {
        minus++;
        if (s > 0) overMinus++;
      }
    }
  });
  assert(plus === sim.crossings.count && minus === sim.crossings.count, "one event per family");
  assert(overPlus + overMinus === sim.crossings.count, "exactly one yarn on top at each crossing");
});

Deno.test("crossings: off-axis crossings are still detected and consistent", () => {
  const sim = new Simulation({ ...base, carriers: 16, m: 2, offsetX: 0.015, tilt: 4 * DEG });
  sim.advance(8);
  const P = sim.machine.perFamily;
  let overPlus = 0, overMinus = 0;
  sim.crossings.events.forEach((ev, k) =>
    ev.sign.forEach((s) => s > 0 && (k < P ? overPlus++ : overMinus++))
  );
  assert(sim.crossings.count > 100, "crossings");
  assert(overPlus + overMinus === sim.crossings.count, "one yarn on top per crossing");
});

Deno.test("crossings: triaxial bias yarns cross every axial yarn with the gear-side rule", () => {
  const sim = new Simulation({ ...base, carriers: 16, m: 2, triaxial: true });
  sim.advance(6);
  const mc = sim.machine, P = mc.perFamily;
  const bias = sim.crossings.count;
  let axialEvents = 0;
  sim.crossings.events.forEach((ev) => (axialEvents += ev.s.length));
  axialEvents -= 2 * bias;
  assert(axialEvents > 50, `axial crossings: ${axialEvents}`);
  // Bias–bias and bias–axial crossings interleave consistently: in the regular 2/2 pattern the
  // axial yarn (gear centre) sits between the two passings of the same gear, so along each yarn
  // blocks become over-over-over / under-under-under (2 bias + 1 axial per gear).
  for (let k = 0; k < 2 * P; k++) {
    const r = runs(sim.crossings.events[k].sign);
    r.slice(1, -1).forEach((len) => assert(len === 3, `yarn ${k}: block ${len}`));
  }
});

Deno.test("CrossingEvents: smoothed side is exact at crossings and blends in between", () => {
  const ev = new CrossingEvents();
  ev.add(3, -1);
  ev.add(1, 1);
  ev.add(2, 1);
  assert(ev.takeDirty() === 0, "dirty from start");
  assertClose(ev.sideAt(0), 1, 0);
  assertClose(ev.sideAt(1), 1, 0);
  assertClose(ev.sideAt(1.5), 1, 0);
  assertClose(ev.sideAt(2.5), 0, 1e-12);
  assertClose(ev.sideAt(3), -1, 0);
  assertClose(ev.sideAt(9), -1, 0);
  ev.add(4, 1);
  assert(ev.takeDirty() === 3, "dirty from the previous event");
  assertClose(new CrossingEvents().sideAt(1), 0, 0);
});

Deno.test("crossings: the spatial hash is pruned (memory stays bounded)", () => {
  const sim = new Simulation({
    ...base,
    carriers: 16,
    m: 2,
    profile: { kind: "cylinder", length: 1.2, radius: 0.04 },
  });
  sim.advance(8);
  const early = sim.crossings.storedSegments;
  sim.advance(16);
  const late = sim.crossings.storedSegments;
  // Deposited segments grow linearly with time; stored ones must not (only ~one revolution kept).
  assert(late < 1.3 * early, `stored segments ${early} → ${late}`);
});
