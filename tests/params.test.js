/** Parameter schema tests: defaults valid, repairs, clearance, URL round trip. */
import {
  decodeParams,
  defaultParams,
  encodeParams,
  MANDREL_LABELS,
  toSimConfig,
  validateParams,
} from "../src/params.js";
import { Simulation } from "../src/core/simulation.js";
import { assert, assertClose } from "./assert.js";

Deno.test("params: defaults are valid for every mandrel preset and run", () => {
  for (const mandrel of Object.keys(MANDREL_LABELS)) {
    const p = defaultParams();
    p.mandrel = mandrel;
    const v = validateParams(p);
    assert(v.errors.length === 0, `${mandrel}: ${v.errors.join("; ")}`);
    const sim = new Simulation(toSimConfig(p));
    sim.advance(3);
    assert(sim.yarns[0].count > 10, `${mandrel}: deposits yarn`);
  }
});

Deno.test("params: carrier count snapped to the pattern, clearance enforced", () => {
  const p = defaultParams();
  p.pattern = "hercules";
  p.carriers = 32;
  const v = validateParams(p);
  assert(p.carriers % 6 === 0 && v.fixes.length === 1, `snapped to ${p.carriers}`);
  const q = defaultParams();
  q.offsetXMm = 100; // needs R ≥ 100 + 55/cos 20° + 5 ≈ 164 mm > 150 mm
  q.tiltDeg = 20;
  assert(validateParams(q).errors.some((e) => e.includes("guide ring")), "clearance error");
});

Deno.test("params: SI conversion and URL-hash round trip", () => {
  const p = defaultParams();
  p.rpm = 12;
  p.mandrel = "custom";
  p.shapes.custom.points[2][1] = 44;
  const c = toSimConfig(p);
  assertClose(c.omega, (12 * 2 * Math.PI) / 60, 1e-15);
  assertClose(c.profile.points[2][1], 0.044, 1e-15);
  const back = decodeParams(encodeParams(p));
  assert(JSON.stringify(back) === JSON.stringify(p), "round trip");
  assert(decodeParams("not-base64!!") === null, "garbage → null");
});
