/** Colour-scale ranges: data / custom / full, signed midpoints, slider bounds and ordering. */
import {
  curvatureRanges,
  mandrelRange,
  niceStep,
  orderBounds,
  RangeTracker,
  signedRange,
  sliderBounds,
  snap,
  yarnRange,
} from "../src/view/scales.js";
import { makeProfile } from "../src/core/profiles.js";
import { Simulation } from "../src/core/simulation.js";
import { defaultParams, toSimConfig } from "../src/params.js";
import { assert, assertClose } from "./assert.js";

const ctx = { mu: 0.25, tension: 5, knMin: -4, knMax: 30, kAbsMax: 30 };
const empty = { min: Infinity, max: -Infinity };

Deno.test("scales: full ranges per colouring", () => {
  assert(
    JSON.stringify(yarnRange("alpha", { mode: "full" }, empty, ctx)) ===
      '{"min":0,"mid":45,"max":90}',
  );
  const s = yarnRange("slip", { mode: "full" }, empty, ctx);
  assert(s.min === 0 && s.mid === 0.5 && s.max === 1, "slip 0…1 × μ");
  const kn = yarnRange("kn", { mode: "full" }, empty, ctx);
  assert(kn.min === -4 && kn.mid === 0 && kn.max === 30, "κn: principal range, mid 0 (both signs)");
  const kg = yarnRange("kg", { mode: "full" }, empty, ctx);
  assert(kg.min === -30 && kg.mid === 0 && kg.max === 30, "κg: ±κ_max");
  const p = yarnRange("pressure", { mode: "full" }, empty, ctx);
  assert(p.min === -20 && p.max === 150 && p.mid === 0, "p = T κn");
  // Without data the data mode falls back to the full range.
  assert(yarnRange("alpha", { mode: "data" }, empty, ctx).max === 90, "fallback");
});

Deno.test("scales: data ranges — centre for one sign, 0 for both, slip capped at 1", () => {
  const a = yarnRange("alpha", { mode: "data" }, { min: 38, max: 54 }, ctx);
  assert(a.min === 38 && a.mid === 46 && a.max === 54, "α centre");
  const kn = yarnRange("kn", { mode: "data" }, { min: 10, max: 20 }, ctx);
  assert(kn.mid === 15, "positive-only κn: centre");
  const kg = yarnRange("kg", { mode: "data" }, { min: -1, max: 3 }, ctx);
  assert(kg.min === -1 && kg.mid === 0 && kg.max === 3, "κg with both signs: mid 0");
  const sl = yarnRange("slip", { mode: "data" }, { min: 0.1, max: 2.5 }, ctx);
  assert(sl.max === 1 && sl.min === 0.1, "slip range capped at μ (above: status colour)");
  // Near-constant data is widened to 2 % of the full range, clamped at 0 for unsigned values.
  const c = yarnRange("alpha", { mode: "data" }, { min: 45, max: 45 }, ctx);
  assertClose(c.max - c.min, 1.8, 1e-12, "α widened");
  const z = yarnRange("slip", { mode: "data" }, { min: 0, max: 0 }, ctx);
  assert(z.min === 0 && z.max > 0, "slip widened upwards from 0");
  // Custom passes through unchanged.
  const u = yarnRange(
    "kg",
    { mode: "custom", min: -2, mid: 0.5, max: 4 },
    { min: -1, max: 3 },
    ctx,
  );
  assert(u.min === -2 && u.mid === 0.5 && u.max === 4, "custom");
});

Deno.test("scales: mandrel auto range is symmetric about 0", () => {
  const r = mandrelRange({ mode: "auto" }, { min: -114, max: 60 });
  assert(r.min === -114 && r.mid === 0 && r.max === 114, "±max |K|");
  const z = mandrelRange({ mode: "auto" }, { min: 0, max: 0 });
  assert(z.min === -1 && z.max === 1, "K ≡ 0 → unit range");
  assert(
    mandrelRange({ mode: "custom", min: -5, mid: 1, max: 9 }, { min: 0, max: 0 }).mid === 1,
    "custom",
  );
  const s = signedRange(2, 2);
  assert(s.max > s.min, "degenerate widened");
});

Deno.test("scales: slider bounds, snapping and ordering of custom bounds", () => {
  assertClose(niceStep(90), 0.5, 1e-15);
  assertClose(niceStep(1), 0.005, 1e-15);
  assertClose(niceStep(34), 0.2, 1e-15);
  const b = sliderBounds({ min: -4, mid: 0, max: 30 }, { min: -1, mid: 0, max: 31.3 });
  assert(b.lo <= -4 && b.hi >= 31.3 && b.step === 0.2, JSON.stringify(b));
  assert(snap(0.1 + 0.2, 0.1) === 0.3, "snap removes float noise");
  const B = { lo: 0, hi: 90, step: 0.5 };
  const o1 = orderBounds({ min: 70, mid: 45, max: 60 }, "min", B);
  assert(o1.min === 70 && o1.mid === 70.5 && o1.max === 71, JSON.stringify(o1));
  const o2 = orderBounds({ min: 30, mid: 45, max: 20 }, "max", B);
  assert(o2.max === 20 && o2.mid === 19.5 && o2.min === 19, JSON.stringify(o2));
  const o3 = orderBounds({ min: 30, mid: 95, max: 60 }, "mid", B);
  assert(o3.mid === 89.5 && o3.max === 90 && o3.min === 30, JSON.stringify(o3));
  const o4 = orderBounds({ min: 89.9, mid: 90, max: 90 }, "min", B);
  assert(o4.min < o4.mid && o4.mid < o4.max && o4.max <= 90, JSON.stringify(o4));
});

Deno.test("scales: curvature ranges of profiles, tracker over a real run", () => {
  const cyl = curvatureRanges(makeProfile({ kind: "cylinder", length: 1, radius: 0.04 }));
  assertClose(cyl.knMin, 0, 1e-12);
  assertClose(cyl.knMax, 25, 1e-9);
  assertClose(cyl.kAbsMax, 25, 1e-9);
  const hg = curvatureRanges(
    makeProfile({
      kind: "hourglass",
      length: 0.7,
      radius: 0.05,
      depth: 0.015,
      center: 0.38,
      halfWidth: 0.15,
    }),
  );
  assert(hg.knMin < 0, "a waist has negative meridian curvature");

  const sim = new Simulation(toSimConfig(defaultParams()));
  sim.advance(12);
  const t = new RangeTracker(),
    c = { mu: sim.config.friction, tension: sim.config.tension, ...curvatureRanges(sim.profile) };
  const y = sim.yarns[0];
  for (let i = 1; i < y.count; i++) t.add(y, i, c);
  const a = t.get("alpha");
  assert(a.min > 20 && a.max < 70 && a.max > a.min, `α range ${a.min}…${a.max}`);
  const kn = t.get("kn");
  assert(
    kn.min > 0 && kn.max <= c.knMax + 1e-9,
    `κn within the principal range: ${kn.min}…${kn.max}`,
  );
  assertClose(t.get("pressure").max, c.tension * kn.max, 1e-9, "p = T κn");
});

Deno.test("scales: orderBounds keeps lo ≤ min < mid < max ≤ hi for many random moves", () => {
  const B = { lo: -3, hi: 12, step: 0.1 };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 5000; n++) {
    const s = { min: -5 + 20 * rnd(), mid: -5 + 20 * rnd(), max: -5 + 20 * rnd() };
    const moved = ["min", "mid", "max"][Math.floor(3 * rnd())];
    const o = orderBounds(s, moved, B);
    assert(
      o.min >= B.lo - 1e-9 && o.min < o.mid && o.mid < o.max && o.max <= B.hi + 1e-9,
      `${JSON.stringify(s)} (${moved}) → ${JSON.stringify(o)}`,
    );
  }
});
