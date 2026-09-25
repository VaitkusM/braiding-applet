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

Deno.test("params: invalid numbers and hostile share links are rejected, never crash", () => {
  for (
    const [key, bad] of [["dsMaxMm", 0], ["dsMaxMm", -1], ["tensionN", 0], ["rpm", NaN], [
      "axialWidthMm",
      0,
    ], ["tiltDeg", 45]]
  ) {
    const p = defaultParams();
    p[key] = bad;
    assert(validateParams(p).errors.length > 0, `${key} = ${bad} must be rejected`);
  }
  const p = defaultParams();
  p.pattern = "toString"; // inherited key must not pass
  const v = validateParams(p);
  assert(p.pattern === "regular" && v.fixes.length > 0, "unknown pattern repaired");
  const q = defaultParams();
  q.mandrel = "custom";
  q.shapes.custom.points[3] = [0.5, NaN];
  assert(validateParams(q).errors.length > 0, "NaN control point rejected");
  // JSON with 1e999 (→ Infinity) or inherited keys decodes to safe values.
  const b64 = (o) =>
    btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const d = decodeParams(b64({ rpm: 1e999, pattern: "toString" }));
  assert(
    d === null || (Number.isFinite(d.rpm) && d.pattern !== "toString"),
    "hostile hash sanitised",
  );
  const e = decodeParams(b64({ rpm: 1e999 }));
  assert(e !== null && e.rpm === defaultParams().rpm, "non-finite number ignored");
});

Deno.test("params: memory guard refuses runs with tens of millions of samples", () => {
  const p = defaultParams();
  p.carriers = 144;
  p.rpm = 30;
  p.takeUpMm = 1;
  const v = validateParams(p);
  assert(v.errors.some((m) => m.includes("million")), v.errors.join(" "));
  assert(validateParams(defaultParams()).errors.length === 0, "defaults unaffected");
});
