/**
 * @file params.js — the user-facing parameter set: defaults, presets, ranges, validation,
 * conversion to the SI simulation config, and share-link (URL hash) encoding.
 *
 * UI parameters use practitioner units (mm, rpm, mm/s, degrees, N); `toSimConfig` converts them to
 * the SI `SimConfig` consumed by src/core/simulation.js. This module is pure (no DOM), so it is
 * unit-testable; the only browser-facing helpers take/return plain strings.
 */

import { allowedCarrierCounts, PATTERNS } from "./core/machine.js";
import { defaultCustomPoints, makeProfile, validateProfile } from "./core/profiles.js";
import { MandrelPose } from "./core/pose.js";

const DEG = Math.PI / 180;

/** Human-readable names of the mandrel presets. */
export const MANDREL_LABELS = Object.freeze({
  cylinder: "Cylinder",
  cone: "Cone",
  taper: "Cylinder – taper – cylinder",
  bulge: "Bulge (K > 0)",
  hourglass: "Hourglass waist (K < 0)",
  custom: "Custom profile (editor)",
});

/**
 * Default shape parameters per mandrel preset, in mm. Keys match ProfileSpec fields.
 * @returns {Record<string, Record<string, any>>}
 */
export function defaultShapes() {
  return {
    cylinder: { length: 700, radius: 40 },
    cone: { length: 700, r0: 30, r1: 60 },
    taper: { length: 800, r0: 30, r1: 55, zStart: 250, zEnd: 450 },
    bulge: { length: 700, radius: 35, amplitude: 15, center: 380, halfWidth: 120 },
    hourglass: { length: 700, radius: 50, depth: 15, center: 380, halfWidth: 150 },
    // Custom control points: [u, r] with u = z / length ∈ [0, 1] (so changing the length rescales
    // the curve) and r in mm.
    custom: { length: 600, points: defaultCustomPoints().map(([z, r]) => [z / 0.6, r * 1e3]) },
  };
}

/**
 * Slider ranges for shape parameters (mm), used by the controls.
 * @type {Record<string, [number, number, number]>}  [min, max, step]
 */
export const SHAPE_RANGES = Object.freeze({
  length: [200, 1500, 10],
  radius: [10, 100, 0.5],
  r0: [10, 100, 0.5],
  r1: [10, 100, 0.5],
  zStart: [0, 1500, 5],
  zEnd: [0, 1500, 5],
  amplitude: [0, 60, 0.5],
  depth: [0, 60, 0.5],
  center: [0, 1500, 5],
  halfWidth: [10, 600, 5],
});

/**
 * Default parameter set (UI units).
 */
export function defaultParams() {
  return {
    // Machine
    carriers: 32,
    pattern: "regular",
    rpm: 6, // carrier revolutions per minute about the machine axis
    takeUpMm: 25, // mandrel take-up speed [mm/s]
    ringRadiusMm: 150, // guide-ring radius [mm]
    triaxial: false,
    // Mandrel
    mandrel: "taper",
    shapes: defaultShapes(),
    offsetXMm: 0,
    offsetYMm: 0,
    tiltDeg: 0,
    tieZMm: 20, // tie ring position from the leading end [mm]
    initialConvergenceMm: 60, // tie ring distance downstream of the guide ring at t = 0 [mm]
    // Yarn
    yarnWidthMm: 5,
    axialWidthMm: 4,
    yarnThicknessMm: 0.6,
    tensionN: 5,
    friction: 0.25,
    // Numerics
    dsMaxMm: 0.5,
    dphiMaxDeg: 0.5,
    turnMaxDeg: 1,
  };
}

/** Pattern key → m. */
export const patternM = (key) => PATTERNS[key].m;

/**
 * Converts UI parameters to the SI simulation config.
 * @param {ReturnType<typeof defaultParams>} p
 * @returns {import("./core/simulation.js").SimConfig}
 */
export function toSimConfig(p) {
  return {
    carriers: p.carriers,
    m: patternM(p.pattern),
    omega: (p.rpm * 2 * Math.PI) / 60,
    takeUp: p.takeUpMm * 1e-3,
    ringRadius: p.ringRadiusMm * 1e-3,
    profile: profileSpec(p),
    offsetX: p.offsetXMm * 1e-3,
    offsetY: p.offsetYMm * 1e-3,
    tilt: p.tiltDeg * DEG,
    tieZ: p.tieZMm * 1e-3,
    initialConvergence: p.initialConvergenceMm * 1e-3,
    triaxial: p.triaxial,
    yarnWidth: p.yarnWidthMm * 1e-3,
    axialWidth: p.axialWidthMm * 1e-3,
    yarnThickness: p.yarnThicknessMm * 1e-3,
    tension: p.tensionN,
    friction: p.friction,
    dsMax: p.dsMaxMm * 1e-3,
    dphiMax: p.dphiMaxDeg * DEG,
    turnMax: p.turnMaxDeg * DEG,
  };
}

/**
 * SI profile spec of the selected mandrel.
 * @param {ReturnType<typeof defaultParams>} p
 * @returns {import("./core/profiles.js").ProfileSpec}
 */
export function profileSpec(p) {
  const s = p.shapes[p.mandrel];
  if (p.mandrel === "custom") {
    const L = s.length * 1e-3;
    return { kind: "custom", length: L, points: s.points.map(([u, r]) => [u * L, r * 1e-3]) };
  }
  const out = { kind: p.mandrel };
  for (const [k, v] of Object.entries(s)) out[k] = v * 1e-3;
  return out;
}

/**
 * Validates and REPAIRS a parameter set in place where a repair is unambiguous.
 * @param {ReturnType<typeof defaultParams>} p
 * @returns {{errors:string[], warnings:string[], fixes:string[]}}
 *   errors: the run cannot start; warnings: it can, with caveats; fixes: what was auto-corrected.
 */
export function validateParams(p) {
  const errors = [], warnings = [], fixes = [];
  const m = patternM(p.pattern);

  // Carrier count must satisfy 2m | N.
  const allowed = allowedCarrierCounts(m);
  if (!allowed.includes(p.carriers)) {
    const nearest = allowed.reduce((
      a,
      b,
    ) => (Math.abs(b - p.carriers) < Math.abs(a - p.carriers) ? b : a));
    fixes.push(`${p.carriers} carriers do not fit the ${m}/${m} pattern; using ${nearest}.`);
    p.carriers = nearest;
  }
  if (!(p.rpm > 0)) errors.push("Carrier speed must be positive.");
  if (!(p.takeUpMm > 0)) errors.push("Take-up speed must be positive.");

  // Shape sanity.
  const s = p.shapes[p.mandrel];
  if (p.mandrel === "taper" && !(s.zEnd > s.zStart)) {
    errors.push("Taper: the transition end must lie after its start.");
  }
  if (p.mandrel === "hourglass" && !(s.depth < s.radius - 5)) {
    errors.push("Hourglass: the waist depth must leave at least 5 mm of radius.");
  }
  if (p.mandrel === "custom") {
    const pts = s.points;
    if (pts.length < 2 || pts[0][0] !== 0 || pts[pts.length - 1][0] !== 1) {
      errors.push("Custom profile: the first/last control points must sit at the mandrel ends.");
    }
    for (let i = 1; i < pts.length; i++) {
      if (!(pts[i][0] > pts[i - 1][0])) {
        errors.push("Custom profile: control points must be ordered in z.");
        break;
      }
    }
  }
  if (errors.length) return { errors, warnings, fixes };

  let profile;
  try {
    profile = makeProfile(profileSpec(p));
  } catch (e) {
    errors.push(String(e.message ?? e));
    return { errors, warnings, fixes };
  }
  const v = validateProfile(profile);
  if (!v.ok) errors.push(...v.messages);

  if (!(p.tieZMm >= 0 && p.tieZMm < s.length - 50)) {
    errors.push("The tie ring must lie on the mandrel, at least 50 mm before its trailing end.");
  }
  if (!(p.initialConvergenceMm > 0)) {
    errors.push("The initial convergence length must be positive.");
  }

  // Guide-ring clearance (tilted section is an ellipse r / cos τ, offset by e).
  const pose = new MandrelPose({
    offsetX: p.offsetXMm * 1e-3,
    offsetY: p.offsetYMm * 1e-3,
    tilt: p.tiltDeg * DEG,
    d0: 0,
    v: 1,
  });
  const need = pose.requiredRingRadius(profile.rMax) * 1e3 + 5;
  if (p.ringRadiusMm < need) {
    errors.push(
      `The guide ring (R = ${p.ringRadiusMm} mm) must clear the mandrel: R ≥ ${
        need.toFixed(0)
      } mm.`,
    );
  }
  if (Math.abs(p.tiltDeg) > 30) errors.push("Tilt is limited to ±30°.");
  if (!(p.friction >= 0)) errors.push("Friction must be non-negative.");
  if (p.yarnWidthMm <= 0 || p.yarnThicknessMm <= 0) {
    errors.push("Yarn width and thickness must be positive.");
  }
  if (p.carriers * (p.yarnWidthMm * 1e-3) / (4 * Math.PI * profile.rMin) >= 1) {
    warnings.push(
      "The yarns are too wide for the smallest radius: the braid is jammed at any angle there.",
    );
  }
  return { errors, warnings, fixes };
}

/** Encodes parameters for the URL hash (JSON → base64url). */
export function encodeParams(p) {
  const json = JSON.stringify(p);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Decodes a URL-hash payload into a full parameter set (unknown keys dropped, missing keys taken
 * from the defaults). Returns null if the payload is not valid.
 * @param {string} s
 */
export function decodeParams(s) {
  try {
    const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const raw = JSON.parse(json);
    const d = defaultParams();
    for (const k of Object.keys(d)) {
      if (k === "shapes") continue;
      if (k in raw && typeof raw[k] === typeof d[k]) d[k] = raw[k];
    }
    if (raw.shapes && typeof raw.shapes === "object") {
      for (const key of Object.keys(d.shapes)) {
        const src = raw.shapes[key];
        if (!src) continue;
        for (const f of Object.keys(d.shapes[key])) {
          if (f === "points") {
            if (
              Array.isArray(src.points) &&
              src.points.every((q) => Array.isArray(q) && q.length === 2)
            ) {
              d.shapes[key].points = src.points.map(([z, r]) => [Number(z), Number(r)]);
            }
          } else if (typeof src[f] === "number") d.shapes[key][f] = src[f];
        }
      }
    }
    if (!(d.pattern in PATTERNS) || !(d.mandrel in MANDREL_LABELS)) return null;
    return d;
  } catch {
    return null;
  }
}
