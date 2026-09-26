/**
 * @file tools/figures/make.js — generates the illustrations of docs/THEORY.md (also shown in the
 * in-app Theory tab) as SVG files in docs/figures/ (dev tool, not deployed as code).
 *
 * The figures are COMPUTED with the app's own core (src/core): simulation runs, principal
 * curvatures, the geodesic integrator, the machine's track and over/under rules. Three figures are
 * schematic and say so in their descriptions: the overview diagram, the bridging sections (whose
 * chords are nevertheless computed, as the upper convex hull of the drawn section) and the planar
 * foliations illustrating curl and divergence.
 *
 *   deno task figures          # regenerate docs/figures/*.svg
 *
 * tests/figures.test.js rebuilds every figure in memory and fails if a committed file is out of
 * date. Output is deterministic (coordinates rounded to 0.01 px, see svg.js).
 */

import { Simulation } from "../../src/core/simulation.js";
import { makeProfile } from "../../src/core/profiles.js";
import { SurfaceOfRevolution } from "../../src/core/surface.js";
import { integrateGeodesic } from "../../src/core/geodesic.js";
import { CircularBraider } from "../../src/core/machine.js";
import {
  coverFactor,
  duPopperConvergenceLength,
  jammingAngle,
  quasiStaticAngle,
} from "../../src/core/analysis.js";
import { FLAG } from "../../src/core/yarnPath.js";
import { defaultParams, defaultShapes, profileSpec, toSimConfig } from "../../src/params.js";
import { curvatureMap, pivotScale, rgbToHex } from "../../src/view/colormaps.js";
import { zeroPivotRange } from "../../src/view/scales.js";
import { axes, C, f, Svg } from "./svg.js";

const DEG = Math.PI / 180;
const MM = 1e3;

// ── Shared simulation runs ──────────────────────────────────────────────────────────────────────

/**
 * Reference cylinder of THEORY.md: r = 40 mm, R_g = 150 mm, N = 16, ω = 1 rad/s, v = 40 mm/s,
 * hence tan α = ωr/v = 1 (α = 45°), h∞ = √(R_g² − r²)/tan α = 144.57 mm, τ = √(R_g² − r²)/(ωr)
 * = 3.614 s.
 */
export const REF = Object.freeze({
  carriers: 16,
  m: 2,
  omega: 1,
  takeUp: 0.04,
  ringRadius: 0.15,
  profile: { kind: "cylinder", length: 1.6, radius: 0.04 },
  offsetX: 0,
  offsetY: 0,
  tilt: 0,
  tieZ: 0.02,
  initialConvergence: 0.05,
  triaxial: false,
  yarnWidth: 0.004,
  axialWidth: 0.004,
  yarnThickness: 5e-4,
  tension: 5,
  friction: 0.25,
  dsMax: 5e-4,
  dphiMax: 0.5 * DEG,
  turnMax: 1 * DEG,
});
/** Snapshot time of the reference run [s]: the start-up transient has decayed by e^{−6.5}. */
const REF_T = 25;

let cache = null;
/** Runs the shared simulations once: the reference cylinder and the app's default (taper). */
function runs() {
  if (cache) return cache;
  const ref = new Simulation(REF);
  ref.advance(REF_T);
  const taper = new Simulation(toSimConfig(defaultParams()));
  while (!taper.ended) taper.advance(10);
  cache = { ref, taper };
  return cache;
}

/** Fixed-point number with a true minus sign. */
const num = (v, digits) => v.toFixed(digits).replace("-", "−");

/** Profile of one of the app's default mandrel presets. */
const presetProfile = (kind) =>
  makeProfile(profileSpec({ ...defaultParams(), mandrel: kind, shapes: defaultShapes() }));

/** First sample index k ≥ 1 of a yarn with predicate true (or the last sample). */
function findSample(y, pred) {
  let k = 1;
  while (k < y.count - 1 && !pred(k)) k++;
  return k;
}

/** Arc with an arrowhead at a1, showing rotation from a0 to a1 (screen angles, CCW positive). */
function rotationArrow(s, cx, cy, r, a0, a1, color) {
  s.arc(cx, cy, r, a0, a1, { stroke: color, width: 2 });
  const sg = Math.sign(a1 - a0);
  const e = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
  const dir = [-sg * Math.sin(a1), -sg * Math.cos(a1)]; // screen tangent in the travel direction
  s.arrow(e[0] - 7 * dir[0], e[1] - 7 * dir[1], e[0] + 2 * dir[0], e[1] + 2 * dir[1], {
    color,
    head: 9,
    width: 2,
  });
  return e;
}

// ── Figure 0: how the model is organised (schematic) ────────────────────────────────────────────

function figOverview() {
  const s = new Svg(760, 276, {
    title: "How the model is organised",
    desc: "Schematic: machine kinematics drive the straight free yarn; unilateral contact moves " +
      "the fell point; the deposited yarn's geometry follows in closed form and feeds mechanics, " +
      "braid structure and the reference solutions.",
  });
  const box = (x, y, w, h, title, lines) => {
    s.rect(x, y, w, h, { fill: "#f6f8fa", stroke: C.ink, width: 1.2, rx: 6 });
    s.text(x + w / 2, y + 20, title, { anchor: "middle", weight: 600 });
    lines.forEach((l, i) =>
      s.text(x + w / 2, y + 40 + 17 * i, l, {
        anchor: "middle",
        size: 12,
        math: true,
        color: C.muted,
      })
    );
  };
  const top = [
    ["Machine", ["carriers at ±ω", "guide ring R_g", "take-up speed v"]],
    ["Free yarn", ["straight from G to F", "tangent at F:", "g = (G − F)·n = 0"]],
    ["Fell point", ["moves along t:", "Ḟ = λ t", "λ = −Ġ·n / (L κ_n)"]],
    ["Deposited yarn", ["α, κ_n, κ_g", "in closed form", "from Ġ, L and κ_n"]],
  ];
  const bw = 160, bh = 96, gap = 30, y0 = 24;
  top.forEach(([t, l], i) => {
    const x = 20 + i * (bw + gap);
    box(x, y0, bw, bh, t, l);
    if (i < top.length - 1) s.arrow(x + bw + 3, y0 + bh / 2, x + bw + gap - 3, y0 + bh / 2);
  });
  const bottom = [
    ["Mechanics", ["pressure p = T κ_n", "no slip: |κ_g| ≤ μ κ_n"]],
    ["Braid structure", ["crossings, over/under", "cover factor, jamming"]],
    ["References", ["quasi-static α, Du–Popper h(t)", "geodesics (Clairaut)"]],
  ];
  const src = [20 + 3 * (bw + gap) + bw / 2, y0 + bh], bw2 = 190, bh2 = 76, y1 = 180;
  bottom.forEach(([t, l], i) => {
    const xc = 170 + 200 * i;
    box(xc - bw2 / 2, y1, bw2, bh2, t, l);
    s.arrow(src[0], src[1] + 2, xc, y1 - 3, { color: C.muted, width: 1.2 });
  });
  return s.toString();
}

// ── Figure 1: machine and convergence zone, side view ───────────────────────────────────────────

function figMachineSide() {
  const { ref: sim } = runs();
  const mc = sim.machine, pose = sim.pose, t = sim.time;
  const S = 820, W = 700, H = 620, x0 = 30, zL = 0.235;
  const s = new Svg(W, H, {
    title: "Circular braiding machine and convergence zone (side view)",
    desc: "Computed side view of the reference case (16 carriers, r = 40 mm, R_g = 150 mm, " +
      "α = 45°): carriers on the track plate, the guide ring seen edge-on, the straight free " +
      "yarns converging from the ring to the fell line, and the braid on the mandrel (back half " +
      "faint).",
  });
  // Screen x = x0 + S (zL − z): upstream (the machine) left, take-up direction right.
  const SX = (z) => x0 + S * (zL - z), SY = (x) => H / 2 - S * x;
  const r = REF.profile.radius, Rg = mc.ringRadius, zP = 0.1075;
  const h = sim.series.hPlus.at(-1);
  const zR = zL - (W - 2 * x0) / S;

  s.rect(SX(zL), SY(r), SX(zR) - SX(zL), 2 * S * r, {
    fill: C.mandrel,
    stroke: C.mandrelEdge,
    width: 1,
  });
  // Deposited braid (viewer on the +y side: y ≥ 0 is the front half).
  for (const y of sim.yarns) {
    const col = y.family === 1 ? C.plus : C.minus;
    const front = [], back = [];
    for (let i = 0; i < y.count; i += 4) {
      const p = pose.toMachine(y.point(i), t);
      const inside = p[2] <= -h && p[2] >= zR;
      const q = inside ? [SX(p[2]), SY(p[0])] : [NaN, NaN];
      front.push(inside && p[1] >= 0 ? q : [NaN, NaN]);
      back.push(inside && p[1] < 0 ? q : [NaN, NaN]);
    }
    s.polyline(back, { stroke: col, width: 1, opacity: 0.25 });
    s.polyline(front, { stroke: col, width: 1.6 });
  }
  // Track plate (cut away around the mandrel) with the carriers.
  const outer = mc.trackRadius + mc.gearRadius + 0.03, inner = Rg * 1.05;
  for (const sg of [1, -1]) {
    const yA = SY(sg * outer), yB = SY(sg * inner);
    s.rect(SX(zP + 0.012), Math.min(yA, yB), S * 0.012, Math.abs(yB - yA), {
      fill: "#c9ced6",
      stroke: C.faint,
      width: 1,
    });
  }
  s.line(SX(0), SY(Rg), SX(0), SY(-Rg), { stroke: "#9aa1a9", width: 1, dash: "3 3" });
  // Free yarns: bobbin → guide point on the ring → fell point.
  sim.yarns.forEach((_, k) => {
    const { family, j } = sim.carrierOf(k);
    const [cx] = mc.carrierTrackXY(family, j, t);
    const G = mc.guidePoint(family, j, t), F = pose.toMachine(sim.fell[k], t);
    const col = family === 1 ? C.plus : C.minus;
    const hi = k === 0 || k === mc.perFamily;
    s.polyline([[SX(zP) + 12, SY(cx)], [SX(0), SY(G[0])], [SX(F[2]), SY(F[0])]], {
      stroke: col,
      width: hi ? 2 : 1,
      opacity: hi ? 1 : 0.5,
    });
    s.rect(SX(zP) - 2, SY(cx) - 5, 14, 10, { fill: col, stroke: C.paper, width: 0.8, rx: 2 });
  });
  for (const sg of [1, -1]) s.circle(SX(0), SY(sg * Rg), 4, { fill: "#9aa1a9" });
  // Fell line, convergence length, ring radius.
  s.line(SX(-h), SY(r + 0.03), SX(-h), SY(-r - 0.03), { stroke: C.ink, width: 1.2, dash: "5 4" });
  s.text(SX(-h) + 6, SY(-r - 0.03) + 14, "fell line", { size: 12 });
  const yDim = SY(-Rg - 0.035);
  s.line(SX(0), SY(-Rg), SX(0), yDim + 6, { stroke: C.faint, width: 1 });
  s.line(SX(-h), SY(-r), SX(-h), yDim + 6, { stroke: C.faint, width: 1 });
  s.dimension(SX(0), yDim, SX(-h), yDim, `h = ${(h * MM).toFixed(1)} mm`, { dy: 18 });
  s.dimension(SX(0.012), SY(0), SX(0.012), SY(Rg), "R_g", { dx: -14, dy: 4 });
  // Braid angle at the front-most point of the helix, where the projection shows it undistorted.
  const alpha = Math.abs(sim.yarns[0].alpha[sim.yarns[0].last]);
  const ax = SX(-h - 0.16), ay = SY(0), len = 0.05;
  s.line(ax, ay, ax + S * len, ay, { stroke: C.ink, width: 1, dash: "3 3" });
  s.line(ax, ay, ax + S * len * Math.cos(alpha), ay - S * len * Math.sin(alpha), {
    stroke: C.ink,
    width: 1.4,
  });
  s.arc(ax, ay, 26, 0, alpha, { stroke: C.ink, width: 1 });
  s.text(ax + 30, ay - 8, `α = ${(alpha / DEG).toFixed(1)}°`, { math: true, size: 12 });
  // Labels.
  s.arrow(SX(zR) - 70, SY(r) - 18, SX(zR) - 20, SY(r) - 18, { width: 1.5 });
  s.text(SX(zR) - 76, SY(r) - 13, "take-up v", { anchor: "end", size: 12, math: true });
  s.text(SX(zP) + 20, 22, "carriers on the track plate (±ω)", { size: 12, math: true });
  s.text(SX(0) + 10, SY(-Rg) + 22, "guide ring (edge-on)", { size: 12 });
  s.text(SX(-h / 2), SY(Rg * 0.62), "convergence zone", {
    size: 12,
    anchor: "middle",
    color: C.muted,
  });
  s.text(SX(zR) - 6, SY(-r) + 16, "braided mandrel (r = 40 mm)", {
    size: 12,
    anchor: "end",
    math: true,
  });
  s.text(SX(zL) + 6, SY(r) - 6, "bare mandrel", { size: 12 });
  return s.toString();
}

// ── Figure 2: tangency and lag angle, projection along the axis ─────────────────────────────────

function figTangencyFront() {
  const { ref: sim } = runs();
  const mc = sim.machine, pose = sim.pose, t = sim.time;
  const W = 560, H = 500, S = 1350, cx = W / 2, cy = H / 2 + 10;
  const s = new Svg(W, H, {
    title: "Free yarns seen along the machine axis",
    desc: "Computed projection of the reference case onto the ring plane: every free yarn is " +
      "tangent to the mandrel circle, so its fell point F lags behind its guide point G by " +
      "β = arccos(r/R_g); the free length in this projection is √(R_g² − r²).",
  });
  const P = (v) => [cx + S * v[0], cy - S * v[1]];
  const r = REF.profile.radius, Rg = mc.ringRadius;
  s.circle(cx, cy, S * Rg, { stroke: "#9aa1a9", width: 2 });
  s.circle(cx, cy, S * r, { fill: C.mandrel, stroke: C.mandrelEdge, width: 1 });
  sim.yarns.forEach((_, k) => {
    const { family, j } = sim.carrierOf(k);
    const G = P(mc.guidePoint(family, j, t)), F = P(pose.toMachine(sim.fell[k], t));
    const col = family === 1 ? C.plus : C.minus;
    if (k !== 0) s.line(G[0], G[1], F[0], F[1], { stroke: col, width: 1, opacity: 0.5 });
    s.circle(G[0], G[1], 3, { fill: col, opacity: k === 0 ? 1 : 0.6 });
  });
  // Highlighted "+" yarn 0.
  const Gm = mc.guidePoint(1, 0, t), Fm = pose.toMachine(sim.fell[0], t);
  const G = P(Gm), F = P(Fm);
  const aG = Math.atan2(Gm[1], Gm[0]), aF = Math.atan2(Fm[1], Fm[0]);
  const beta = Math.atan2(Math.sin(aG - aF), Math.cos(aG - aF));
  s.line(cx, cy, G[0], G[1], { stroke: C.muted, width: 1, dash: "4 3" });
  s.line(cx, cy, F[0], F[1], { stroke: C.muted, width: 1, dash: "4 3" });
  s.line(G[0], G[1], F[0], F[1], { stroke: C.plus, width: 2.4 });
  s.arc(cx, cy, 28, aF, aF + beta, { stroke: C.ink, width: 1.2 });
  const am = aF + beta / 2;
  s.text(cx + 40 * Math.cos(am), cy - 40 * Math.sin(am) + 4, "β", {
    math: true,
    anchor: "middle",
  });
  const unit = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  s.rightAngle(F[0], F[1], unit(F, [cx, cy]), unit(F, G), 9);
  s.circle(F[0], F[1], 4, { fill: C.ink });
  s.circle(G[0], G[1], 5, { fill: C.plus });
  // Labels: F outside the circle, r beside its radius (away from G), G beyond the ring.
  s.text(F[0] + 18 * Math.cos(aF), F[1] - 18 * Math.sin(aF) + 4, "F", {
    math: true,
    anchor: "middle",
  });
  const mid = [cx + 0.5 * S * r * Math.cos(aF), cy - 0.5 * S * r * Math.sin(aF)];
  const aw = aF - Math.PI / 2;
  s.text(mid[0] + 11 * Math.cos(aw), mid[1] - 11 * Math.sin(aw) + 4, "r", {
    math: true,
    anchor: "middle",
  });
  s.text(G[0] + 16 * Math.cos(aG), G[1] - 16 * Math.sin(aG) + 4, "G", {
    math: true,
    anchor: "middle",
  });
  const fm = [(F[0] + G[0]) / 2, (F[1] + G[1]) / 2];
  s.text(fm[0] + 8, fm[1] + 18, "√(R_g² − r²)", { math: true, size: 12, color: C.ink });
  s.text(cx + S * Rg * 0.72, cy + S * Rg * 0.76, "R_g", { math: true });
  // Rotation senses of the two families.
  const eP = rotationArrow(s, cx, cy, S * Rg + 22, 1.95, 2.45, C.plus);
  s.text(eP[0] - 10, eP[1] - 4, "+ family, +ω", { math: true, anchor: "end", size: 12 });
  const eM = rotationArrow(s, cx, cy, S * Rg + 22, 1.2, 0.7, C.minus);
  s.text(eM[0] + 10, eM[1] - 4, "− family, −ω", { math: true, size: 12 });
  s.text(
    18,
    24,
    `β = arccos(r/R_g) = ${(Math.acos(r / Rg) / DEG).toFixed(1)}°  (simulated: ${
      (beta / DEG).toFixed(1)
    }°)`,
    { math: true, size: 12, color: C.muted },
  );
  return s.toString();
}

// ── Figure 3: unilateral contact, seen along the axis of a cylinder ─────────────────────────────

function figContactStates() {
  const W = 760, H = 300;
  const s = new Svg(W, H, {
    title: "Unilateral contact of the free yarn",
    desc:
      "Three computed configurations seen along the axis of a cylinder (where n is radial, so " +
      "contact is decided in this plane): the free yarn pointing away from the surface (fell " +
      "point pinned), tangent (g = 0), and a guide-point motion that would make the straight yarn " +
      "cut the mandrel, so the fell point advances to the new tangency point.",
  });
  const rp = 50, R = 1.9 * rp, beta = Math.acos(rp / R), aF = Math.PI / 2;
  const at = (cx, cy, rr, a) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  const unit = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const panel = (i, title, captions, draw) => {
    const cx = 115 + i * 250, cy = 150;
    s.circle(cx, cy, rp, { fill: C.mandrel, stroke: C.mandrelEdge, width: 1 });
    s.text(cx, 30, title, { anchor: "middle", weight: 600, math: true });
    captions.forEach((c, k) =>
      s.text(cx, 262 + 16 * k, c, { anchor: "middle", size: 12, color: C.muted, math: true })
    );
    const F = at(cx, cy, rp, aF), q = at(cx, cy, rp + 28, aF);
    s.arrow(F[0], F[1], q[0], q[1], { color: C.muted, width: 1.2, head: 7 });
    s.text(q[0] + 5, q[1] + 4, "n", { math: true, color: C.muted, size: 12 });
    draw(cx, cy, F);
  };
  const dot = (p, col, rad = 4) => s.circle(p[0], p[1], rad, { fill: col });
  panel(
    0,
    "g > 0: pinned",
    ["G is outside the tangent plane at F;", "F stays put"],
    (cx, cy, F) => {
      const G = at(cx, cy, R, aF - 0.45);
      s.line(F[0], F[1], G[0], G[1], { stroke: C.plus, width: 2.2 });
      dot(F, C.ink);
      dot(G, C.plus, 5);
      s.text(F[0] - 8, F[1] - 6, "F", { math: true, anchor: "end" });
      s.text(G[0] + 8, G[1] + 4, "G", { math: true });
    },
  );
  panel(1, "g = 0: tangent", ["the free yarn leaves F", "tangentially"], (cx, cy, F) => {
    const G = at(cx, cy, R, aF - beta);
    s.line(F[0], F[1], G[0], G[1], { stroke: C.plus, width: 2.2 });
    s.rightAngle(F[0], F[1], [0, 1], unit(F, G), 8);
    dot(F, C.ink);
    dot(G, C.plus, 5);
    s.text(F[0] - 8, F[1] - 6, "F", { math: true, anchor: "end" });
    s.text(G[0] + 8, G[1] + 4, "G", { math: true });
  });
  panel(2, "G moves on: the yarn wraps", [
    "F–G′ would cut the mandrel (g < 0):",
    "F advances along the surface to F′",
  ], (cx, cy, F) => {
    const dA = 0.7, G = at(cx, cy, R, aF - beta), G2 = at(cx, cy, R, aF - beta - dA);
    const F2 = at(cx, cy, rp, aF - dA);
    s.line(F[0], F[1], G[0], G[1], { stroke: C.plus, width: 1, opacity: 0.35 });
    s.arc(cx, cy, R, aF - beta - 0.06, aF - beta - dA + 0.1, {
      stroke: C.faint,
      width: 1,
      dash: "3 3",
    });
    rotationArrow(s, cx, cy, R, aF - beta - dA + 0.3, aF - beta - dA + 0.1, C.faint);
    s.line(F[0], F[1], G2[0], G2[1], { stroke: C.critical, width: 1.2, dash: "4 3" });
    s.arc(cx, cy, rp, aF - dA, aF, { stroke: C.plus, width: 3.5 });
    s.line(F2[0], F2[1], G2[0], G2[1], { stroke: C.plus, width: 2.2 });
    dot(F, C.faint, 3.5);
    dot(G, C.faint, 4);
    dot(F2, C.ink);
    dot(G2, C.plus, 5);
    s.text(F[0] - 8, F[1] - 6, "F", { math: true, anchor: "end", color: C.muted });
    s.text(G[0] + 8, G[1] - 2, "G", { math: true, color: C.muted });
    s.text(F2[0] + 6, F2[1] - 8, "F′", { math: true });
    s.text(G2[0] - 2, G2[1] + 20, "G′", { math: true, anchor: "middle" });
  });
  return s.toString();
}

// ── Figure 4: Darboux frame at the fell point (projected 3D) ────────────────────────────────────

function figDarbouxFrame() {
  const { ref: sim } = runs();
  const surf = sim.surface, y = sim.yarns[0], i = y.last;
  const F = y.point(i), t = [y.tx[i], y.ty[i], y.tz[i]], n = [y.nx[i], y.ny[i], y.nz[i]];
  const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  const W = 620, H = 420, S = 4200;
  const s = new Svg(W, H, {
    title: "Darboux frame of the laid yarn at the fell point",
    desc: "Computed oblique view of the reference cylinder around a fell point F: the laid yarn, " +
      "the free yarn leaving F along its tangent t, the outward surface normal n and b = n × t.",
  });
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const unitv = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  // Orthographic camera: d points towards the viewer, U is screen-up, R = U × d screen-right.
  const d = unitv([0, 1, 2].map((k) => 0.55 * n[k] + 0.55 * b[k] - 0.2 * (k === 2 ? 1 : 0)));
  const U = unitv(n.map((x, k) => x - dot(n, d) * d[k]));
  const R = [U[1] * d[2] - U[2] * d[1], U[2] * d[0] - U[0] * d[2], U[0] * d[1] - U[1] * d[0]];
  const P = (p) => {
    const q = [p[0] - F[0], p[1] - F[1], p[2] - F[2]];
    return [W / 2 - 40 + S * dot(q, R), H / 2 - 10 - S * dot(q, U)];
  };
  const th0 = y.th[i], z0 = y.zp[i];
  // Shaded surface patch (front-facing quads only; they cannot overlap on a convex surface).
  const light = unitv(d.map((x, k) => x + 0.6 * U[k] - 0.3 * R[k]));
  const nz = 12, nt = 24, dz = 0.072 / nz, dt = 1.8 / nt;
  for (let a = 0; a < nz; a++) {
    for (let c = 0; c < nt; c++) {
      const z = z0 - 0.036 + (a + 0.5) * dz, th = th0 - 0.9 + (c + 0.5) * dt;
      const nn = surf.frame(z, th).n;
      if (dot(nn, d) <= 0) continue;
      const g = Math.round(168 + 78 * Math.max(0, dot(nn, light)));
      const col = rgbToHex([g / 255, g / 255, Math.min(255, g + 3) / 255]);
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) =>
        P(surf.point(z + u * dz, th + v * dt))
      );
      s.polygon(corners, { fill: col, stroke: col, width: 0.6 });
    }
  }
  const vis = (z, th) => dot(surf.frame(z, th).n, d) > 0;
  for (let k = -3; k <= 3; k++) {
    const z = z0 + k * 0.012, pts = [];
    for (let c = 0; c <= 90; c++) {
      const th = th0 - 0.9 + c * 0.02;
      pts.push(vis(z, th) ? P(surf.point(z, th)) : [NaN, NaN]);
    }
    s.polyline(pts, { stroke: C.mandrelEdge, width: 0.7, opacity: 0.7 });
  }
  for (let k = -4; k <= 4; k++) {
    const th = th0 + k * 0.2, pts = [];
    for (let c = 0; c <= 36; c++) {
      const z = z0 - 0.036 + c * 0.002;
      pts.push(vis(z, th) ? P(surf.point(z, th)) : [NaN, NaN]);
    }
    s.polyline(pts, { stroke: C.mandrelEdge, width: 0.7, opacity: 0.7 });
  }
  // Laid yarn (the last 45 mm, visible part).
  const laid = [];
  for (let k = i; k >= 0 && y.arc[i] - y.arc[k] < 0.045; k--) {
    const nk = [y.nx[k], y.ny[k], y.nz[k]];
    laid.push(dot(nk, d) > 0 ? P(y.point(k)) : [NaN, NaN]);
  }
  s.polyline(laid, { stroke: C.plus, width: 3 });
  // Free yarn from F along t (towards the guide point).
  const pF = P(F), pG = P(F.map((x, k) => x + 0.05 * t[k]));
  s.line(pF[0], pF[1], pG[0], pG[1], { stroke: C.plus, width: 2, dash: "6 4" });
  s.text(pG[0] + 6, pG[1] - 4, "free yarn → G", { size: 12, color: C.plus, math: true });
  const L = 0.026;
  for (const [vec, lab, col] of [[t, "t", C.ink], [n, "n", C.quasiStatic], [b, "b", C.muted]]) {
    const q = P(F.map((x, k) => x + L * vec[k]));
    s.arrow(pF[0], pF[1], q[0], q[1], { color: col, width: 2, head: 9 });
    s.text(q[0] + 7, q[1] + 4, lab, { math: true, color: col, weight: 600, size: 14 });
  }
  s.circle(pF[0], pF[1], 4.5, { fill: C.ink });
  s.text(pF[0] + 8, pF[1] + 18, "F", { math: true });
  s.text(
    18,
    H - 42,
    "Darboux frame (t, n, b = n × t);  t′ = κ_g b − κ_n n  (convex-positive κ_n)",
    {
      math: true,
      size: 13,
    },
  );
  s.text(18, H - 22, "solid: laid yarn · grid: meridians and parallels of the cylinder", {
    size: 12,
    color: C.muted,
  });
  return s.toString();
}

// ── Figure 5: bridging and contact (schematic sections, computed chords) ────────────────────────

function figBridging() {
  const W = 760, H = 290;
  const s = new Svg(W, H, {
    title: "Bridging over a concave stretch and catching on an obstacle",
    desc: "Schematic normal sections along the yarn direction; the chords are computed as the " +
      "upper convex hull of the drawn section. Left: the yarn cannot follow a dip and spans it " +
      "with a bitangent chord. Right: a bulge rises into the free yarn, which catches on it at " +
      "the tangency point.",
  });
  const bump = (u) => (Math.abs(u) >= 1 ? 0 : (1 - u * u) ** 3);
  // Convex base (a normal section with κₙ > 0, as along a helix on a cylinder) plus a dip or bulge.
  const section = (A, xc, w) => (x) => -((x - 170) ** 2) / 1400 + A * bump((x - xc) / w);
  /** Upper convex hull (monotone chain over x-sorted points): indices of the hull vertices. */
  const upperHull = (pts) => {
    const hull = [];
    for (let k = 0; k < pts.length; k++) {
      while (hull.length >= 2) {
        const a = pts[hull.at(-2)], b = pts[hull.at(-1)], c = pts[k];
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) hull.pop();
        else break;
      }
      hull.push(k);
    }
    return hull;
  };
  /** The longest hull edge is the chord. */
  const chord = (pts) => {
    const hull = upperHull(pts);
    let best = [0, 1], len = -1;
    for (let k = 1; k < hull.length; k++) {
      const l = pts[hull[k]][0] - pts[hull[k - 1]][0];
      if (l > len) [len, best] = [l, [hull[k - 1], hull[k]]];
    }
    return best.map((k) => pts[k]);
  };
  const Y0 = 190;
  const panel = (ox, y, xStart, title, caption, flag, flagAnchor) => {
    const pts = [];
    for (let x = 0; x <= 330; x += 0.25) pts.push([x, y(x)]);
    const P = ([x, yy]) => [ox + x, Y0 - yy];
    const coarse = pts.filter((_, k) => k % 4 === 0); // 1 px spacing for drawing
    s.polygon([...coarse.map(P), [ox + 330, 262], [ox, 262]], { fill: C.mandrel });
    s.polyline(coarse.map(P), { stroke: C.mandrelEdge, width: 1.2 });
    const [F, F2] = chord(pts.filter((p) => p[0] >= xStart));
    // Guide point on the extension of the chord: the moment the yarn catches.
    const u = [F2[0] - F[0], F2[1] - F[1]], L = Math.hypot(u[0], u[1]);
    const G = [F2[0] + (u[0] / L) * 70, F2[1] + (u[1] / L) * 70];
    s.polyline([...coarse.filter((p) => p[0] < F[0] && p[0] >= 10), F].map(P), {
      stroke: C.plus,
      width: 3,
    });
    s.line(...P(F), ...P(F2), { stroke: C.plus, width: 2.6, dash: "7 4" });
    s.line(...P(F2), ...P(G), { stroke: C.plus, width: 1.8 });
    for (const p of [F, F2]) s.circle(...P(p), 4, { fill: C.ink });
    s.circle(...P(G), 5, { fill: C.plus });
    s.text(P(F)[0] - 4, P(F)[1] - 10, "F", { math: true, anchor: "end" });
    s.text(P(F2)[0] + 2, P(F2)[1] - 12, "F′", { math: true, anchor: "end" });
    s.text(P(G)[0] + 8, P(G)[1] + 4, "G", { math: true });
    s.text(ox + 165, 30, title, { anchor: "middle", weight: 600, math: true });
    s.text(ox + 165, 280, caption, { anchor: "middle", size: 12, color: C.muted, math: true });
    const dx = flagAnchor === "end" ? -10 : 0;
    s.text(ox + (F[0] + F2[0]) / 2 + dx, Y0 - (F[1] + F2[1]) / 2 - 12, flag, {
      anchor: flagAnchor,
      size: 11,
      color: C.muted,
    });
  };
  panel(
    20,
    section(-34, 185, 80),
    0,
    "dip: κ_n < 0 along the yarn",
    "the yarn spans the dip by the bitangent chord F–F′",
    "flag BRIDGE",
    "middle",
  );
  panel(
    400,
    section(52, 215, 60),
    60,
    "obstacle ahead of the fell point",
    "the free yarn from F catches on the bulge at F′",
    "flags BRIDGE | CONTACT",
    "end",
  );
  return s.toString();
}

// ── Figure 6: convergence-length transient on the reference cylinder ────────────────────────────

function figTransient() {
  const { ref: sim } = runs();
  const se = sim.series, c = REF;
  const r = c.profile.radius, Rg = c.ringRadius, root = Math.sqrt(Rg * Rg - r * r);
  const hInf = (c.takeUp * root) / (c.omega * r), tau = root / (c.omega * r);
  const W = 640, H = 330;
  const s = new Svg(W, H, {
    title: "Convergence length after start-up on the reference cylinder",
    desc:
      "Computed h(t): while the fell point is pinned on the tie ring, h grows with the take-up " +
      "speed; once the free yarns are tangent, h relaxes exponentially to h∞, as Du and Popper " +
      "predict (dashed).",
  });
  const A = axes(s, {
    x: 60,
    y: 40,
    w: 540,
    h: 230,
    xDomain: [0, 20],
    yDomain: [0, 160],
    xTicks: [0, 5, 10, 15, 20],
    yTicks: [0, 40, 80, 120, 160],
    xLabel: "t [s]",
    yLabel: "h [mm]",
  });
  const t0 = sim.wrapStart.time, h0 = sim.wrapStart.h;
  const pts = [], dp = [];
  for (let k = 0; k < se.t.length && se.t[k] <= 20; k++) {
    pts.push([A.X(se.t[k]), A.Y(se.hPlus[k] * MM)]);
  }
  for (let k = 0; k <= 200; k++) {
    const tt = t0 + ((20 - t0) * k) / 200;
    const hh = duPopperConvergenceLength(tt - t0, {
      h0,
      r,
      ringRadius: Rg,
      omega: c.omega,
      v: c.takeUp,
    });
    dp.push([A.X(tt), A.Y(hh * MM)]);
  }
  s.line(A.X(0), A.Y(hInf * MM), A.X(20), A.Y(hInf * MM), {
    stroke: C.quasiStatic,
    width: 1.5,
    dash: "6 4",
  });
  s.polyline(pts, { stroke: C.plus, width: 2.5 });
  s.polyline(dp, { stroke: C.ink, width: 1.4, dash: "3 3" });
  s.circle(A.X(t0), A.Y(h0 * MM), 4, { fill: C.ink });
  s.text(A.X(t0) + 8, A.Y(h0 * MM) + 16, `yarns become tangent (t = ${t0.toFixed(2)} s)`, {
    size: 12,
    math: true,
  });
  s.text(A.X(0.55), A.Y(56), "pinned: dh/dt = v", { size: 12, math: true });
  s.text(
    A.X(20),
    A.Y(hInf * MM) - 8,
    `h_∞ = √(R_g² − r²)/tan α = ${(hInf * MM).toFixed(1)} mm`,
    { size: 12, anchor: "end", math: true, color: C.ink },
  );
  s.text(A.X(9), A.Y(70), "simulated h(t)", { size: 12, weight: 600, math: true });
  s.line(A.X(9) - 30, A.Y(70) - 4, A.X(9) - 6, A.Y(70) - 4, { stroke: C.plus, width: 2.5 });
  s.text(
    A.X(9),
    A.Y(52),
    `Du–Popper: h_∞ + (h_0 − h_∞) e^{−t/τ},  τ = ${tau.toFixed(2)} s`,
    { size: 12, math: true },
  );
  s.line(A.X(9) - 30, A.Y(52) - 4, A.X(9) - 6, A.Y(52) - 4, {
    stroke: C.ink,
    width: 1.4,
    dash: "3 3",
  });
  return s.toString();
}

// ── Figure 7: braid angle lags behind the quasi-static value on a taper ─────────────────────────

function figLagTaper() {
  const { taper: sim } = runs();
  const prof = sim.profile, c = sim.config, y = sim.yarns[0];
  const W = 640, H = 420;
  const s = new Svg(W, H, {
    title: "Braid angle along the default taper",
    desc: "Computed for the app's default taper (top: radius). The simulated braid angle trails " +
      "the quasi-static value through the transition, while the geodesic leaving the braided " +
      "yarn at z = 250 mm turns the other way (Clairaut).",
  });
  const Lmm = prof.length * MM;
  const A1 = axes(s, {
    x: 60,
    y: 34,
    w: 540,
    h: 80,
    xDomain: [0, Lmm],
    yDomain: [0, 60],
    xTicks: [],
    yTicks: [0, 30, 60],
    xLabel: "",
    yLabel: "r [mm]",
  });
  const rp = [];
  for (let k = 0; k <= 200; k++) {
    const z = (k / 200) * prof.length;
    rp.push([A1.X(z * MM), A1.Y(prof.evaluate(z).r * MM)]);
  }
  s.polyline(rp, { stroke: C.ink, width: 2 });
  const A = axes(s, {
    x: 60,
    y: 160,
    w: 540,
    h: 200,
    xDomain: [0, Lmm],
    yDomain: [0, 90],
    xTicks: [0, 200, 400, 600, 800],
    yTicks: [0, 30, 60, 90],
    xLabel: "z [mm]",
    yLabel: "|α| [°]",
  });
  const simPts = [];
  for (let k = 1; k < y.count; k += 4) {
    simPts.push([A.X(y.zp[k] * MM), A.Y(Math.abs(y.alpha[k]) / DEG)]);
  }
  const qs = [];
  for (let k = 0; k <= 200; k++) {
    const z = (k / 200) * prof.length;
    qs.push([A.X(z * MM), A.Y(quasiStaticAngle(prof, z, c.omega, c.takeUp) / DEG)]);
  }
  // Geodesic leaving the braided yarn at z = 250 mm (start of the transition), via Clairaut.
  const k0 = findSample(y, (k) => y.zp[k] >= 0.25);
  const cc = prof.evaluate(y.zp[k0]).r * Math.sin(Math.abs(y.alpha[k0]));
  const geo = [];
  for (let k = 0; k <= 200; k++) {
    const z = y.zp[k0] + (k / 200) * (prof.length - y.zp[k0]);
    const rr = prof.evaluate(z).r;
    geo.push([A.X(z * MM), cc <= rr ? A.Y(Math.asin(cc / rr) / DEG) : NaN]);
  }
  s.polyline(qs, { stroke: C.quasiStatic, width: 2 });
  s.polyline(geo, { stroke: C.geodesic, width: 2.2, dash: "6 4" });
  s.polyline(simPts, { stroke: C.plus, width: 2.5 });
  s.circle(A.X(y.zp[k0] * MM), A.Y(Math.abs(y.alpha[k0]) / DEG), 3.5, { fill: C.ink });
  const qs640 = quasiStaticAngle(prof, 0.64, c.omega, c.takeUp) / DEG;
  s.text(A.X(640), A.Y(qs640) - 10, "quasi-static α_{qs}", {
    size: 12,
    math: true,
    anchor: "middle",
  });
  s.text(A.X(560), A.Y(40), "simulated (+ family)", { size: 12, weight: 600 });
  s.text(A.X(720), A.Y(12), "geodesic from z = 250 mm", {
    size: 12,
    anchor: "middle",
    math: true,
  });
  s.text(A.X(45), A.Y(60), "start-up transient", { size: 12, color: C.muted });
  return s.toString();
}

// ── Figure 8: Euler's formula and the bridging threshold ────────────────────────────────────────

function figEuler() {
  const sh = defaultShapes();
  const cyl = new SurfaceOfRevolution(presetProfile("taper")).principal(0.1);
  const crest = new SurfaceOfRevolution(presetProfile("bulge")).principal(sh.bulge.center / MM);
  const waist = new SurfaceOfRevolution(presetProfile("hourglass")).principal(
    sh.hourglass.center / MM,
  );
  const W = 640, H = 340;
  const s = new Svg(W, H, {
    title: "Normal curvature along a yarn as a function of the braid angle",
    desc: "Euler's formula at three points of the app's default mandrels: the taper's " +
      "cylindrical part (K = 0), the bulge crest (K > 0) and the waist centre (K < 0). On the " +
      "waist κn is negative below the angle α* = arctan √(−k_m/k_p): there a yarn cannot rest on " +
      "the surface under tension.",
  });
  const A = axes(s, {
    x: 60,
    y: 40,
    w: 540,
    h: 240,
    xDomain: [0, 90],
    yDomain: [-10, 40],
    xTicks: [0, 15, 30, 45, 60, 75, 90],
    yTicks: [-10, 0, 10, 20, 30, 40],
    xLabel: "braid angle α [°]",
    yLabel: "κ_n [1/m]",
  });
  const aStar = Math.atan(Math.sqrt(-waist.k_m / waist.k_p)) / DEG;
  s.rect(A.X(0), A.Y(0), A.X(aStar) - A.X(0), A.Y(-10) - A.Y(0), {
    fill: C.kNeg,
    fillOpacity: 0.08,
  });
  s.line(A.X(0), A.Y(0), A.X(90), A.Y(0), { stroke: C.faint, width: 1 });
  const kn = (pr, a) => pr.k_m * Math.cos(a * DEG) ** 2 + pr.k_p * Math.sin(a * DEG) ** 2;
  const f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);
  const curves = [
    [cyl, C.kZero, `taper, cylindrical part r = 30 mm (K = 0): k_m = 0, k_p = ${f1(cyl.k_p)}`],
    [crest, C.kPos, `bulge crest (K > 0): k_m = ${f2(crest.k_m)}, k_p = ${f1(crest.k_p)}`],
    [waist, C.kNeg, `waist centre (K < 0): k_m = ${f2(waist.k_m)}, k_p = ${f1(waist.k_p)}`],
  ];
  curves.forEach(([pr, col, label], i) => {
    const pts = [];
    for (let a = 0; a <= 90; a++) pts.push([A.X(a), A.Y(kn(pr, a))]);
    s.polyline(pts, { stroke: col, width: 2.4 });
    const ly = A.Y(37 - 4 * i);
    s.line(A.X(1), ly - 4, A.X(1) + 22, ly - 4, { stroke: col, width: 2.4 });
    s.text(A.X(1) + 28, ly, label, { size: 12, math: true });
  });
  s.circle(A.X(aStar), A.Y(0), 4, { fill: C.kNeg });
  s.text(A.X(aStar) + 6, A.Y(0) + 16, `α* = ${aStar.toFixed(1)}°`, { math: true, size: 12 });
  s.text(A.X(1), A.Y(-7), "κ_n < 0: the yarn bridges", { size: 12, math: true });
  s.text(A.X(45), 30, "κ_n(α) = k_m cos²α + k_p sin²α   [1/m]", {
    size: 13,
    math: true,
    anchor: "middle",
  });
  return s.toString();
}

// ── Figure 9: Gaussian curvature of the default mandrels ────────────────────────────────────────

function figProfilesK() {
  const kinds = [
    ["taper", "cylinder – taper – cylinder"],
    ["bulge", "bulge"],
    ["hourglass", "hourglass waist"],
  ];
  const W = 760, H = 260;
  const s = new Svg(W, H, {
    title: "Gaussian curvature of the default mandrels",
    desc:
      "Computed silhouettes of the app's default taper, bulge and hourglass, coloured with the " +
      "app's curvature map (blue K < 0, green K = 0, red K > 0; each sign scaled to its own " +
      "extent on that mandrel). Radii exaggerated 2×.",
  });
  kinds.forEach(([kind, label], idx) => {
    const prof = presetProfile(kind), surf = new SurfaceOfRevolution(prof);
    const ox = 20 + idx * 250, w = 220, sx = w / prof.length, sy = 2 * sx, cy = 120, n = 240;
    const Ks = [];
    for (let k = 0; k <= n; k++) Ks.push(surf.principal((k / n) * prof.length).K);
    const lo = Math.min(...Ks), hi = Math.max(...Ks);
    const R = zeroPivotRange(lo, hi, 0.02 * Math.max(Math.abs(lo), Math.abs(hi)));
    const up = [], dn = [];
    for (let k = 0; k <= n; k++) {
      const z = (k / n) * prof.length, r = prof.evaluate(z).r;
      up.push([ox + z * sx, cy - r * sy]);
      dn.push([ox + z * sx, cy + r * sy]);
    }
    s.polygon([...up, ...dn.slice().reverse()], { fill: C.mandrel });
    // Colour runs (map position quantised to 1/64): equal neighbours form one polyline.
    const cols = [];
    for (let k = 0; k < n; k++) {
      const Km = 0.5 * (Ks[k] + Ks[k + 1]);
      const tq = Math.round(64 * pivotScale(Km, R.min, R.mid, R.max)) / 64;
      cols.push(rgbToHex(curvatureMap(tq)));
    }
    // Shared stroke attributes in a group keep the many short runs compact.
    s.raw(`<g fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">`);
    for (const edge of [up, dn]) {
      let k0 = 0;
      for (let k = 1; k <= n; k++) {
        if (k === n || cols[k] !== cols[k0]) {
          const pts = edge.slice(k0, k + 1).map((p) => `${f(p[0])},${f(p[1])}`).join(" ");
          s.raw(`<polyline points="${pts}" stroke="${cols[k0]}"/>`);
          k0 = k;
        }
      }
    }
    s.raw(`</g>`);
    s.text(ox + w / 2, 30, label, { anchor: "middle", weight: 600 });
  });
  const lx = 250, ly = 206, lw = 260;
  for (let k = 0; k < 52; k++) {
    s.rect(lx + (k * lw) / 52, ly, lw / 52 + 0.6, 10, { fill: rgbToHex(curvatureMap(k / 51)) });
  }
  s.text(lx, ly + 26, "K < 0", { size: 12, math: true });
  s.text(lx + lw / 2, ly + 26, "K = 0", { size: 12, math: true, anchor: "middle" });
  s.text(lx + lw, ly + 26, "K > 0", { size: 12, math: true, anchor: "end" });
  s.text(W - 16, H - 12, "radii exaggerated 2×", { size: 11, color: C.muted, anchor: "end" });
  return s.toString();
}

// ── Figure 10: geodesic versus braided yarn on the taper ────────────────────────────────────────

function figGeodesic() {
  const { taper: sim } = runs();
  const prof = sim.profile, y = sim.yarns[0];
  const W = 700, H = 230, sx = 800, cy = 140, ox = 30;
  const s = new Svg(W, H, {
    title: "Braided yarn and geodesic on the default taper",
    desc: "Computed side view (front half solid, back half faint): from a common point and " +
      "direction at z ≈ 250 mm, the braided yarn keeps winding as the radius grows, whereas the " +
      "geodesic obeys Clairaut's relation r sin α = const and straightens out.",
  });
  const X = (z) => ox + z * sx, Y = (xv) => cy - xv * sx;
  const up = [], dn = [];
  for (let k = 0; k <= 200; k++) {
    const z = (k / 200) * prof.length, r = prof.evaluate(z).r;
    up.push([X(z), Y(r)]);
    dn.push([X(z), Y(-r)]);
  }
  s.polygon([...up, ...dn.slice().reverse()], {
    fill: C.mandrel,
    stroke: C.mandrelEdge,
    width: 1,
  });
  // Common start: the first braided-yarn sample past z = 240 mm on the front meridian (θ ≈ π/2).
  const k0 = findSample(y, (k) => y.zp[k] > 0.24 && Math.sin(y.th[k]) > 0.99);
  const g = integrateGeodesic(prof, {
    z0: y.zp[k0],
    th0: y.th[k0],
    alpha0: y.alpha[k0],
    ds: 1e-3,
    maxLength: 2,
  });
  const halves = (pts) => {
    const front = [], back = [];
    for (const p of pts) {
      const q = [X(p[2]), Y(p[0])];
      front.push(p[1] >= 0 ? q : [NaN, NaN]);
      back.push(p[1] < 0 ? q : [NaN, NaN]);
    }
    return { front, back };
  };
  const braid = [];
  for (let k = k0; k < y.count; k += 2) braid.push(y.point(k));
  const geo = g.z.map((z, k) => sim.surface.point(z, g.th[k]));
  const hb = halves(braid), hg = halves(geo);
  s.polyline(hb.back, { stroke: C.plus, width: 1.4, opacity: 0.35 });
  s.polyline(hg.back, { stroke: C.geodesic, width: 1.6, opacity: 0.4, dash: "5 4" });
  s.polyline(hb.front, { stroke: C.plus, width: 2.4 });
  s.polyline(hg.front, { stroke: C.geodesic, width: 2.6, dash: "7 4" });
  const p0 = y.point(k0);
  s.circle(X(p0[2]), Y(p0[0]), 4.5, { fill: C.ink });
  s.text(X(p0[2]) - 8, Y(p0[0]) - 8, "common start", { size: 12, anchor: "end" });
  const alphaEnd = Math.abs(y.alpha[y.last]) / DEG, geoEnd = Math.abs(g.alpha.at(-1)) / DEG;
  s.line(ox, 22, ox + 24, 22, { stroke: C.plus, width: 2.4 });
  s.text(ox + 30, 26, `braided yarn (+ family): α → ${alphaEnd.toFixed(0)}° at the end`, {
    size: 12,
    math: true,
  });
  s.line(ox, 42, ox + 24, 42, { stroke: C.geodesic, width: 2.6, dash: "7 4" });
  s.text(ox + 30, 46, `geodesic, r sin α = const: α → ${geoEnd.toFixed(0)}°`, {
    size: 12,
    math: true,
  });
  return s.toString();
}

// ── Figure 11: slip as a friction-cone condition ────────────────────────────────────────────────

function figFrictionCone() {
  const { ref, taper } = runs();
  const mu = taper.config.friction;
  const yRef = ref.yarns[0], yT = taper.yarns[0];
  // Worst slip ratio on the default taper past the start-up transient, and a point at z = 300 mm.
  let iMax = -1, sMax = 0;
  for (let k = 1; k < yT.count; k++) {
    if (yT.zp[k] < 0.1 || yT.flags[k] & (FLAG.TIE | FLAG.BRIDGE)) continue;
    if (Math.abs(yT.slip[k]) > sMax) [sMax, iMax] = [Math.abs(yT.slip[k]), k];
  }
  const i300 = findSample(yT, (k) => yT.zp[k] >= 0.3);
  const W = 640, H = 360, cx = 330, cy = 320, Lr = 250;
  const s = new Svg(W, H, {
    title: "No slip as a friction-cone condition in the normal plane of the yarn",
    desc: "The surface reaction per unit length is f = T(κn n − κg b), parallel to −Ġ⊥. No slip " +
      "means f lies inside the Coulomb cone of half-angle arctan μ about n. Computed samples: the " +
      "steady helix on the reference cylinder, and two points of the default taper's transition.",
  });
  const half = Math.atan(mu);
  s.polygon(
    [[cx, cy], [cx - Lr * Math.sin(half), cy - Lr * Math.cos(half)], [
      cx + Lr * Math.sin(half),
      cy - Lr * Math.cos(half),
    ]],
    { fill: C.good, fillOpacity: 0.12, stroke: C.good, width: 1 },
  );
  s.arrow(cx - 190, cy, cx + 190, cy, { color: C.faint, width: 1, head: 7 });
  s.arrow(cx, cy + 10, cx, cy - 290, { color: C.faint, width: 1, head: 7 });
  s.text(cx + 194, cy + 4, "b", { math: true, color: C.muted });
  s.text(cx + 8, cy - 282, "n", { math: true, color: C.muted });
  s.arc(cx, cy, 64, Math.PI / 2, Math.PI / 2 + half, { stroke: C.good, width: 1.2 });
  s.text(cx - 24, cy - 60, `arctan μ = ${(half / DEG).toFixed(1)}°`, {
    size: 12,
    math: true,
    anchor: "end",
  });
  /** Reaction direction ∝ (−κ_g, κ_n) = κ_n (−slip, 1) in the (b, n) plane. */
  const vec = (slip, col, label, side, Lv) => {
    const ang = Math.atan(Math.abs(slip)), sg = slip >= 0 ? -1 : 1;
    const ex = cx + sg * Lv * Math.sin(ang), ey = cy - Lv * Math.cos(ang);
    s.arrow(cx, cy, ex, ey, { color: col, width: 2.6, head: 10 });
    if (side === "left") {
      s.line(cx - 60, ey, ex - 6, ey, { stroke: C.faint, width: 0.8 });
      s.text(cx - 64, ey + 4, label, { size: 12, math: true, anchor: "end" });
    } else s.text(ex + 8, ey + 4, label, { size: 12, math: true });
  };
  const sRef = Math.abs(yRef.slip[yRef.last]);
  vec(yRef.slip[yRef.last], C.ink, `cylinder helix: |κ_g/κ_n| = ${sRef.toFixed(3)}`, "left", 205);
  vec(
    yT.slip[i300],
    C.good,
    `taper, z = 300 mm: ${Math.abs(yT.slip[i300]).toFixed(2)} ≤ μ`,
    "right",
    205,
  );
  vec(
    yT.slip[iMax],
    C.critical,
    `taper, z = ${(yT.zp[iMax] * MM).toFixed(0)} mm: ${sMax.toFixed(2)} > μ, slips`,
    "right",
    170,
  );
  const lines = [
    "surface reaction on the yarn per length:",
    "f = T (κ_n n − κ_g b)  ∥  −Ġ_⊥",
    "no slip ⇔ f inside the cone",
    `⇔ |κ_g| ≤ μ κ_n  (μ = ${mu})`,
  ];
  lines.forEach((l, k) => s.text(20, 30 + 20 * k, l, { size: 13, math: true }));
  return s.toString();
}

// ── Figure 12: horn-gear track, figure-eight paths and passings ─────────────────────────────────

function figTrack() {
  const mc = new CircularBraider({ carriers: 16, omega: 1, ringRadius: 0.15, m: 2 });
  const W = 560, H = 610, S = 680, cx = W / 2, cy = 310;
  const s = new Svg(W, H, {
    title: "Horn-gear track of a 16-carrier regular (2/2) braider",
    desc: "Computed from the machine model: 8 horn gears and the serpentine paths of the two " +
      "carrier families, shown at an instant when every '+' carrier passes a '−' carrier. The " +
      "two carriers of a passing are on opposite arcs of their gear; the outer carrier's yarn " +
      "goes over.",
  });
  const P = (x, y) => [cx + S * x, cy - S * y];
  for (let q = 0; q < mc.gearCount; q++) {
    const c = mc.gearCenter(q), p = P(mc.trackRadius * Math.cos(c), mc.trackRadius * Math.sin(c));
    s.circle(p[0], p[1], S * mc.gearRadius, { fill: "#f3f4f6", stroke: C.faint, width: 1 });
  }
  for (const fam of [1, -1]) {
    const pts = [];
    for (let k = 0; k <= 720; k++) {
      pts.push(P(...mc.carrierTrackXY(fam, 0, (k / 720) * 2 * Math.PI)));
    }
    s.polyline(pts, { stroke: fam === 1 ? C.plus : C.minus, width: 1.6, opacity: 0.8 });
  }
  s.circle(cx, cy, S * mc.ringRadius, { stroke: "#9aa1a9", width: 1.5, dash: "4 3" });
  s.text(cx, cy + 4, "guide ring (above the track)", {
    anchor: "middle",
    size: 12,
    color: C.muted,
  });
  // Instant t = π/(Nω): "+" carrier j and "−" carrier j have the same azimuth jΔ + Δ/4 (passing).
  const t = Math.PI / (mc.N * mc.omega), dt = 1e-3;
  for (let j = 0; j < mc.perFamily; j++) {
    const a = P(...mc.carrierTrackXY(1, j, t)), b = P(...mc.carrierTrackXY(-1, j, t));
    s.line(a[0], a[1], b[0], b[1], { stroke: C.ink, width: 1, dash: "2 2" });
    for (const [fam, p] of [[1, a], [-1, b]]) {
      const q = P(...mc.carrierTrackXY(fam, j, t + dt));
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const u = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
      const col = fam === 1 ? C.plus : C.minus;
      s.circle(p[0], p[1], 7, { fill: col, stroke: C.paper, width: 1.2 });
      s.arrow(p[0] + 8 * u[0], p[1] + 8 * u[1], p[0] + 24 * u[0], p[1] + 24 * u[1], {
        color: col,
        head: 7,
        width: 1.6,
      });
    }
  }
  // Annotate the passing of carriers +2 and −2 (top of the figure).
  const outerFam = mc.carrierSide(1, mc.carrierAngle(1, 2, t)) === 1 ? 1 : -1;
  const po = P(...mc.carrierTrackXY(outerFam, 2, t));
  s.text(
    po[0] - 14,
    po[1] - 16,
    `outer carrier (${outerFam === 1 ? "+" : "−"}): its yarn goes over`,
    {
      size: 12,
      anchor: "end",
    },
  );
  s.text(18, 24, "+ family counter-clockwise, − family clockwise; each carrier alternates", {
    size: 12,
  });
  s.text(18, 41, "between the outer and inner arcs of successive gears (arrows: velocity)", {
    size: 12,
  });
  s.text(18, H - 14, "dashed: the 8 passings at this instant → 2 over, 2 under along each yarn", {
    size: 12,
    color: C.muted,
  });
  return s.toString();
}

// ── Figure 13: interlacing patterns (unrolled mandrel) ──────────────────────────────────────────

function figPatterns() {
  const W = 760, H = 310;
  const s = new Svg(W, H, {
    title: "Interlacing patterns 1/1, 2/2 and 3/3",
    desc: "Part of the unrolled mandrel (circumference horizontal, axis vertical) at α = 45° for " +
      "12 carriers. Over/under at every crossing is computed from the machine's gear sides: the " +
      "yarn of the outer carrier lies on top.",
  });
  const pats = [[1, "diamond 1/1"], [2, "regular 2/2"], [3, "Hercules 3/3"]];
  pats.forEach(([m, label], idx) => {
    const mc = new CircularBraider({ carriers: 12, omega: 1, ringRadius: 0.15, m });
    const Nf = mc.perFamily, D = mc.delta;
    const ox = 20 + idx * 250, oy = 50, pw = 220, ph = 220;
    const sc = pw / (1.25 * Math.PI), uMax = ph / sc, strip = 16;
    const clip = `clip-pattern-${idx}`;
    s.raw(
      `<clipPath id="${clip}"><rect x="${ox}" y="${oy}" width="${pw}" height="${ph}"/></clipPath>`,
    );
    s.raw(`<g clip-path="url(#${clip})">`);
    s.rect(ox, oy, pw, ph, { fill: "#f6f8fa" });
    // At α = 45° on the unrolled cylinder (u = z/r): "+" yarn θ = θ0 + u, "−" yarn θ = θ0 − u.
    const X = (th) => ox + sc * th, Y = (u) => oy + ph - sc * u;
    const strand = (x1, y1, x2, y2, col) => {
      if (Math.max(x1, x2) < ox - strip || Math.min(x1, x2) > ox + pw + strip) return; // clipped
      s.line(x1, y1, x2, y2, { stroke: C.paper, width: strip + 3, cap: "butt" });
      s.line(x1, y1, x2, y2, { stroke: col, width: strip, cap: "butt" });
    };
    for (let wrap = -2; wrap <= 2; wrap++) {
      for (let i = 0; i < Nf; i++) {
        const a = i * D + D / 2 + 2 * Math.PI * wrap;
        strand(X(a), Y(0), X(a - uMax), Y(uMax), C.minus);
      }
    }
    for (let wrap = -2; wrap <= 2; wrap++) {
      for (let j = 0; j < Nf; j++) {
        const a = j * D + 2 * Math.PI * wrap;
        strand(X(a), Y(0), X(a + uMax), Y(uMax), C.plus);
      }
    }
    // Crossing of (+j, −i): θ_c = (i + j)Δ/2 + Δ/4 + πp at u = θ_c − jΔ; redraw the upper yarn.
    const half = (strip + 6) / Math.SQRT2;
    for (let j = 0; j < Nf; j++) {
      for (let i = 0; i < Nf; i++) {
        for (let p = -3; p <= 3; p++) {
          const thc = ((i + j) * D) / 2 + D / 4 + Math.PI * p, u = thc - j * D;
          if (u < -0.5 || u > uMax + 0.5) continue;
          const plusOver = mc.carrierSide(1, thc) === 1;
          for (let wrap = -2; wrap <= 2; wrap++) {
            const x = X(thc + 2 * Math.PI * wrap), yy = Y(u);
            if (x < ox - 30 || x > ox + pw + 30) continue;
            const sg = plusOver ? 1 : -1;
            strand(x - sg * half, yy + half, x + sg * half, yy - half, plusOver ? C.plus : C.minus);
          }
        }
      }
    }
    s.raw(`</g>`);
    s.rect(ox, oy, pw, ph, { stroke: C.faint, width: 1 });
    s.text(ox + pw / 2, 34, label, { anchor: "middle", weight: 600 });
  });
  s.text(20, H - 14, "horizontal: circumference θ (225° shown) · vertical: axis z", {
    size: 12,
    color: C.muted,
    math: true,
  });
  return s.toString();
}

// ── Figure 14: cover factor and jamming ─────────────────────────────────────────────────────────

function figCover() {
  const c = toSimConfig(defaultParams());
  const N = c.carriers, w = c.yarnWidth, r = defaultShapes().taper.r0 / MM;
  const W = 760, H = 330;
  const s = new Svg(W, H, {
    title: "Cover factor and jamming",
    desc:
      "Left: a patch of the unrolled braid at α = 40° (two families of flat strips of width w, " +
      "perpendicular spacing d = 4πr cos α / N). Right: cover factor versus braid angle for the " +
      "app's defaults (N = 32, w = 5 mm, r = 30 mm) with the jamming angle.",
  });
  const a = 40 * DEG, d = (4 * Math.PI * r * Math.cos(a)) / N, k = w / d;
  const ox = 30, oy = 50, pw = 290, ph = 240, sc = pw / ((6 * d) / Math.cos(a));
  const cxp = ox + pw / 2, cyp = oy + ph / 2;
  const P2 = (u, v) => [cxp + sc * u, cyp - sc * v]; // u along the circumference, v along the axis
  s.raw(
    `<clipPath id="clip-cover"><rect x="${ox}" y="${oy}" width="${pw}" height="${ph}"/></clipPath>`,
  );
  s.raw(`<g clip-path="url(#clip-cover)">`);
  s.rect(ox, oy, pw, ph, { fill: "#f6f8fa" });
  // Strip directions t± = (±sin α, cos α); unit normals ν± = (cos α, ∓sin α).
  const strips = (sg, col) => {
    const t = [sg * Math.sin(a), Math.cos(a)], nv = [Math.cos(a), -sg * Math.sin(a)];
    for (let kk = -10; kk <= 10; kk++) {
      const c0 = [nv[0] * kk * d, nv[1] * kk * d], L = 0.2;
      const corner = (st, sn) =>
        P2(
          c0[0] + st * L * t[0] + (sn * w * nv[0]) / 2,
          c0[1] + st * L * t[1] + (sn * w * nv[1]) / 2,
        );
      s.polygon([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], {
        fill: col,
        fillOpacity: 0.45,
      });
    }
  };
  strips(1, C.plus);
  strips(-1, C.minus);
  s.raw(`</g>`);
  s.rect(ox, oy, pw, ph, { stroke: C.faint, width: 1 });
  const nvp = [Math.cos(a), -Math.sin(a)];
  const q0 = P2(0, 0), q1 = P2(nvp[0] * d, nvp[1] * d);
  s.dimension(q0[0], q0[1], q1[0], q1[1], "d", { dx: 10, dy: -8, text: { weight: 600 } });
  const w0 = P2(-nvp[0] * (d - w / 2), -nvp[1] * (d - w / 2));
  const w1 = P2(-nvp[0] * (d + w / 2), -nvp[1] * (d + w / 2));
  s.dimension(w0[0], w0[1], w1[0], w1[1], "w", { dx: -2, dy: -10, text: { weight: 600 } });
  // Braid angle between the meridian (vertical) and the "+" strip through the centre.
  s.line(cxp, cyp, cxp, cyp - 70, { stroke: C.ink, width: 1, dash: "3 3" });
  s.arc(cxp, cyp, 44, Math.PI / 2 - a, Math.PI / 2, { stroke: C.ink, width: 1.2 });
  const am = Math.PI / 2 - a / 2;
  s.text(cxp + 54 * Math.cos(am), cyp - 54 * Math.sin(am) + 4, "α", {
    math: true,
    anchor: "middle",
    weight: 600,
  });
  s.arrow(ox + pw + 14, oy + ph, ox + pw + 14, oy + ph - 44, { width: 1.2, head: 7 });
  s.text(ox + pw + 14, oy + ph - 50, "z", { math: true, anchor: "middle", size: 12 });
  s.text(
    ox,
    34,
    `α = 40°: d = ${(d * MM).toFixed(2)} mm, k = w/d = ${k.toFixed(2)}, CF = ${
      (1 - (1 - k) ** 2).toFixed(2)
    }`,
    { size: 12, math: true },
  );
  const aJ = jammingAngle(N, w, r) / DEG;
  const A = axes(s, {
    x: 400,
    y: 50,
    w: 330,
    h: 230,
    xDomain: [0, 90],
    yDomain: [0, 1.05],
    xTicks: [0, 30, 60, 90],
    yTicks: [0, 0.25, 0.5, 0.75, 1],
    xLabel: "braid angle α [°]",
    yLabel: "cover factor CF",
  });
  const pts = [];
  for (let al = 0; al <= 89.5; al += 0.5) {
    pts.push([A.X(al), A.Y(coverFactor({ carriers: N, width: w, r, alpha: al * DEG }).cover)]);
  }
  s.line(A.X(0), A.Y(0.82), A.X(90), A.Y(0.82), { stroke: C.muted, width: 1, dash: "5 4" });
  s.text(A.X(2), A.Y(0.82) - 6, "round yarns jam near CF ≈ 0.82", { size: 11, color: C.muted });
  s.polyline(pts, { stroke: C.ink, width: 2.4 });
  s.line(A.X(aJ), A.Y(0), A.X(aJ), A.Y(1), { stroke: C.critical, width: 1.2, dash: "4 3" });
  s.text(A.X(aJ) - 6, A.Y(0.12), `α_{jam} = ${aJ.toFixed(1)}° (k = 1)`, {
    size: 12,
    math: true,
    anchor: "end",
  });
  return s.toString();
}

// ── Figure 15: curl and divergence of a unit vector field (planar foliations) ──────────────────

function figCurlDiv() {
  const W = 760, H = 330;
  const s = new Svg(W, H, {
    title: "Curl and divergence of the unit field of a foliation",
    desc: "Schematic, three planar foliations drawn exactly: parallel lines (curl and divergence " +
      "zero), a pencil of lines (geodesic leaves whose spacing grows, divergence 1/ℓ) and concentric " +
      "circles (equally spaced leaves that bend, curl 1/ℓ); ℓ is the distance from the centre.",
  });
  const pw = 220, ph = 200, oy = 44;
  const panel = (i, title, lines, draw) => {
    const ox = 20 + i * 250;
    const clip = `clip-fol-${i}`;
    s.raw(
      `<clipPath id="${clip}"><rect x="${ox}" y="${oy}" width="${pw}" height="${ph}"/></clipPath>`,
    );
    s.rect(ox, oy, pw, ph, { fill: "#f6f8fa" });
    s.raw(`<g clip-path="url(#${clip})">`);
    const marks = draw(ox);
    s.raw(`</g>`);
    s.rect(ox, oy, pw, ph, { stroke: C.faint, width: 1 });
    marks();
    s.text(ox + pw / 2, 30, title, { anchor: "middle", weight: 600 });
    lines.forEach((l, k) =>
      s.text(ox + pw / 2, oy + ph + 22 + 17 * k, l, {
        anchor: "middle",
        size: 12,
        math: true,
        color: k === 0 ? C.ink : C.muted,
      })
    );
  };
  const leaf = { stroke: C.plus, width: 2 };
  const unitArrow = (x, y, ux, uy) =>
    s.arrow(x - 11 * ux, y - 11 * uy, x + 11 * ux, y + 11 * uy, { head: 7, width: 1.4 });
  const gap = (x1, y1, x2, y2, label) =>
    s.dimension(x1, y1, x2, y2, label, { dx: 10, dy: 2, text: { size: 12 } });
  // (a) parallel lines at 35° (screen), spacing 28 px.
  panel(0, "parallel lines", ["curl X = 0,  div X = 0", "only where K = 0"], (ox) => {
    const a = -35 * DEG, u = [Math.cos(a), Math.sin(a)], nv = [-u[1], u[0]], sp = 28;
    const cx = ox + pw / 2, cy = oy + ph / 2;
    for (let j = -8; j <= 8; j++) {
      const p = [cx + j * sp * nv[0], cy + j * sp * nv[1]];
      s.line(p[0] - 300 * u[0], p[1] - 300 * u[1], p[0] + 300 * u[0], p[1] + 300 * u[1], leaf);
    }
    return () => {
      for (const [j, t] of [[-2, -40], [0, 30], [2, -10]]) {
        unitArrow(cx + j * sp * nv[0] + t * u[0], cy + j * sp * nv[1] + t * u[1], u[0], u[1]);
      }
      const p1 = [cx + sp * nv[0] + 60 * u[0], cy + sp * nv[1] + 60 * u[1]];
      gap(p1[0], p1[1], p1[0] + sp * nv[0], p1[1] + sp * nv[1], "ρ");
    };
  });
  // Pencil and circles share a centre below-left of the panel; ℓ = distance from it.
  const centre = (ox) => [ox - 30, oy + ph + 30];
  panel(1, "pencil of lines", ["curl X = 0,  div X = 1/ℓ", "geodesic leaves spread"], (ox) => {
    const [cx, cy] = centre(ox);
    for (let a = 6; a <= 84; a += 6) {
      const u = [Math.cos(a * DEG), -Math.sin(a * DEG)];
      s.line(cx + 20 * u[0], cy + 20 * u[1], cx + 420 * u[0], cy + 420 * u[1], leaf);
    }
    return () => {
      for (const [a, d] of [[30, 150], [54, 230], [66, 110]]) {
        const u = [Math.cos(a * DEG), -Math.sin(a * DEG)];
        unitArrow(cx + d * u[0], cy + d * u[1], u[0], u[1]);
      }
      for (const d of [110, 250]) {
        const a1 = 42 * DEG, a2 = 48 * DEG;
        gap(
          cx + d * Math.cos(a1),
          cy - d * Math.sin(a1),
          cx + d * Math.cos(a2),
          cy - d * Math.sin(a2),
          "ρ",
        );
      }
    };
  });
  panel(2, "concentric circles", ["|curl X| = 1/ℓ,  div X = 0", "equally spaced leaves bend"], (
    ox,
  ) => {
    const [cx, cy] = centre(ox);
    for (let d = 64; d <= 420; d += 28) s.arc(cx, cy, d, 0, Math.PI / 2, leaf);
    return () => {
      for (const [a, d] of [[30, 148], [60, 204], [20, 260]]) {
        const u = [-Math.sin(a * DEG), -Math.cos(a * DEG)]; // counter-clockwise tangent (screen)
        unitArrow(cx + d * Math.cos(a * DEG), cy - d * Math.sin(a * DEG), u[0], u[1]);
      }
      const a = 45 * DEG;
      gap(
        cx + 176 * Math.cos(a),
        cy - 176 * Math.sin(a),
        cx + 204 * Math.cos(a),
        cy - 204 * Math.sin(a),
        "ρ",
      );
    };
  });
  s.text(
    W - 16,
    H - 10,
    "arrows: unit field X · ρ: spacing of neighbouring leaves · ℓ: distance from the centre",
    {
      size: 11,
      color: C.muted,
      anchor: "end",
      math: true,
    },
  );
  return s.toString();
}

// ── Figure 16: Clairaut's relation with friction on the default taper ───────────────────────────

/** Samples of the "+" yarn that lie on the surface and were laid continuously. */
function laidSamples(y, zMin = 0) {
  const ok = [];
  for (let k = 1; k < y.count; k++) {
    if (y.flags[k] & (FLAG.TIE | FLAG.BRIDGE | FLAG.CONTACT | FLAG.LIFTOFF)) continue;
    if (y.zp[k] >= zMin) ok.push(k);
  }
  return ok;
}

function figClairautFriction() {
  const { taper: sim } = runs();
  const prof = sim.profile, c = sim.config, y = sim.yarns[0], mu = c.friction;
  const W = 640, H = 470;
  const s = new Svg(W, H, {
    title: "Clairaut's relation with friction along the default taper",
    desc:
      "Computed for the '+' yarns of the default taper. Top: the Clairaut function r sin α of " +
      "the braid, of the quasi-static braid and of the geodesic from z = 250 mm (constant). " +
      "Bottom: the geodesic curvature from the closed form of Section 3.4 (line) and from the rate " +
      "of change of r sin α (dots), with the friction band ±μκn; outside it the yarn slips.",
  });
  const Lmm = prof.length * MM;
  const csin = (k) => prof.evaluate(y.zp[k]).r * Math.sin(Math.abs(y.alpha[k]));
  const A1 = axes(s, {
    x: 60,
    y: 40,
    w: 540,
    h: 110,
    xDomain: [0, Lmm],
    yDomain: [0, 50],
    xTicks: [],
    yTicks: [0, 25, 50],
    xLabel: "",
    yLabel: "c = r sin α [mm]",
  });
  const trans = (A, y0, y1) =>
    s.rect(A.X(250), y0, A.X(450) - A.X(250), y1 - y0, { fill: C.grid, fillOpacity: 0.6 });
  trans(A1, 40, 150);
  const k0 = findSample(y, (k) => y.zp[k] >= 0.25), cGeo = csin(k0);
  const braid = laidSamples(y).filter((_, i) => i % 3 === 0).map((k) => [
    A1.X(y.zp[k] * MM),
    A1.Y(csin(k) * MM),
  ]);
  const qs = [];
  for (let i = 0; i <= 200; i++) {
    const z = (i / 200) * prof.length;
    qs.push([
      A1.X(z * MM),
      A1.Y(prof.evaluate(z).r * Math.sin(quasiStaticAngle(prof, z, c.omega, c.takeUp)) * MM),
    ]);
  }
  s.polyline(qs, { stroke: C.quasiStatic, width: 2 });
  s.line(A1.X(250), A1.Y(cGeo * MM), A1.X(Lmm), A1.Y(cGeo * MM), {
    stroke: C.geodesic,
    width: 2.2,
    dash: "6 4",
  });
  s.polyline(braid, { stroke: C.plus, width: 2.5 });
  const legend = [
    ["braid (+ family)", { stroke: C.plus, width: 2.5 }],
    ["quasi-static braid", { stroke: C.quasiStatic, width: 2 }],
    ["geodesic: c constant", { stroke: C.geodesic, width: 2.2, dash: "6 4" }],
  ];
  legend.forEach(([label, style], i) => {
    const ly = A1.Y(46 - 6.5 * i);
    s.line(A1.X(12), ly - 4, A1.X(12) + 22, ly - 4, style);
    s.text(A1.X(12) + 28, ly, label, { size: 12, math: true });
  });
  s.text(A1.X(350), 36, "taper", { size: 11, anchor: "middle", color: C.muted });
  // Bottom: κ_g two ways, friction band.
  const A = axes(s, {
    x: 60,
    y: 200,
    w: 540,
    h: 210,
    xDomain: [0, Lmm],
    yDomain: [-5, 5],
    xTicks: [0, 200, 400, 600, 800],
    yTicks: [-4, -2, 0, 2, 4],
    xLabel: "z [mm]",
    yLabel: "κ_g [1/m]",
  });
  trans(A, 200, 410);
  const ks = laidSamples(y, 0.05);
  const up = [], dn = [];
  for (let i = 0; i < ks.length; i += 4) {
    const k = ks[i];
    up.push([A.X(y.zp[k] * MM), A.Y(mu * y.kn[k])]);
    dn.push([A.X(y.zp[k] * MM), A.Y(-mu * y.kn[k])]);
  }
  s.polygon([...up, ...dn.reverse()], { fill: C.good, fillOpacity: 0.13 });
  s.line(A.X(0), A.Y(0), A.X(Lmm), A.Y(0), { stroke: C.faint, width: 1 });
  // Slip: samples flagged SLIP, marked on the axis in the status colour.
  let z0 = null;
  const slipRuns = [];
  for (const k of ks) {
    const slip = (y.flags[k] & FLAG.SLIP) !== 0;
    if (slip && z0 === null) z0 = y.zp[k];
    if (!slip && z0 !== null) {
      slipRuns.push([z0, y.zp[k]]);
      z0 = null;
    }
  }
  if (z0 !== null) slipRuns.push([z0, y.zp[ks.at(-1)]]);
  for (const [a, b] of slipRuns) {
    s.rect(A.X(a * MM), A.Y(-5) - 8, A.X(b * MM) - A.X(a * MM), 6, { fill: C.critical });
    s.text((A.X(a * MM) + A.X(b * MM)) / 2, A.Y(-5) - 12, "slips", {
      size: 11,
      anchor: "middle",
      color: C.critical,
    });
  }
  s.polyline(ks.filter((_, i) => i % 2 === 0).map((k) => [A.X(y.zp[k] * MM), A.Y(y.kg[k])]), {
    stroke: C.plus,
    width: 2.4,
  });
  // Dots: κ_g = −(1/r) d(r sin α)/dσ by central differences over ±2 samples.
  const sigma = (a, b) => {
    const q = (z) => Math.sqrt(1 + prof.evaluate(z).dr ** 2), zm = 0.5 * (y.zp[a] + y.zp[b]);
    return ((y.zp[b] - y.zp[a]) * (q(y.zp[a]) + 4 * q(zm) + q(y.zp[b]))) / 6;
  };
  const cs = (k) => prof.evaluate(y.zp[k]).r * Math.sin(y.alpha[k]);
  for (let i = 2; i < ks.length - 2; i += 18) {
    const k = ks[i];
    if (ks[i + 2] !== k + 2 || ks[i - 2] !== k - 2) continue;
    const kg = -(cs(k + 2) - cs(k - 2)) / sigma(k - 2, k + 2) / prof.evaluate(y.zp[k]).r;
    s.circle(A.X(y.zp[k] * MM), A.Y(kg), 2.3, { fill: C.ink });
  }
  s.text(A.X(560), A.Y(3.3), "friction band ±μκ_n", { size: 12, math: true });
  s.text(A.X(470), A.Y(-2.4), "κ_g, closed form (line)", { size: 12, math: true });
  s.text(A.X(470), A.Y(-3.3), "−(1/r) d(r sin α)/dσ (dots)", { size: 12, math: true });
  return s.toString();
}

// ── Figure 17: what a geodesic braid would cost ─────────────────────────────────────────────────

function figGeodesicBraid() {
  const { taper: sim } = runs();
  const prof = sim.profile, c = sim.config, y = sim.yarns[0];
  const N = c.carriers, w = c.yarnWidth;
  const W = 640, H = 430;
  const s = new Svg(W, H, {
    title: "Machine braid versus a geodesic braid on the default taper",
    desc: "Computed. Top: cover factor of the simulated braid and of the pair of mirror Clairaut " +
      "foliations through the braid at z = 250 mm, whose leaf spacing is a Jacobi field. Bottom: " +
      "the constant take-up speed of the run and the quasi-static take-up schedule that would lay " +
      "the geodesic pair.",
  });
  const Lmm = prof.length * MM;
  const k0 = findSample(y, (k) => y.zp[k] >= 0.25);
  const cc = prof.evaluate(y.zp[k0]).r * Math.sin(Math.abs(y.alpha[k0]));
  const cf = (rho) => 1 - (1 - Math.min(1, w / rho)) ** 2;
  const A1 = axes(s, {
    x: 60,
    y: 40,
    w: 540,
    h: 150,
    xDomain: [0, Lmm],
    yDomain: [0, 1],
    xTicks: [],
    yTicks: [0, 0.25, 0.5, 0.75, 1],
    xLabel: "",
    yLabel: "cover factor CF",
  });
  const band = (A, y0, y1) =>
    s.rect(A.X(250), y0, A.X(450) - A.X(250), y1 - y0, { fill: C.grid, fillOpacity: 0.6 });
  band(A1, 40, 190);
  const braid = laidSamples(y).filter((_, i) => i % 3 === 0).map((k) => {
    const r = prof.evaluate(y.zp[k]).r;
    return [A1.X(y.zp[k] * MM), A1.Y(cf((4 * Math.PI * r * Math.cos(y.alpha[k])) / N))];
  });
  const geo = [], vgeo = [];
  for (let i = 0; i <= 240; i++) {
    const z = (i / 240) * prof.length, e = prof.evaluate(z), q = Math.sqrt(1 + e.dr * e.dr);
    const root = Math.sqrt(e.r * e.r - cc * cc);
    geo.push([A1.X(z * MM), A1.Y(cf((4 * Math.PI * root) / N))]);
    vgeo.push([z * MM, (c.omega * e.r * root) / (q * cc) * MM]);
  }
  s.polyline(geo, { stroke: C.geodesic, width: 2.4, dash: "7 4" });
  s.polyline(braid, { stroke: C.plus, width: 2.5 });
  const cfEnd = cf((4 * Math.PI * prof.evaluate(prof.length).r * Math.cos(y.alpha[y.last])) / N);
  const cfGeoEnd = cf((4 * Math.PI * Math.sqrt(prof.evaluate(prof.length).r ** 2 - cc * cc)) / N);
  s.text(A1.X(790), A1.Y(cfEnd) - 8, `machine braid: CF → ${cfEnd.toFixed(2)}`, {
    size: 12,
    anchor: "end",
    weight: 600,
  });
  s.text(A1.X(790), A1.Y(cfGeoEnd) + 18, `geodesic braid: CF → ${cfGeoEnd.toFixed(2)}`, {
    size: 12,
    anchor: "end",
  });
  s.text(A1.X(350), 36, "taper", { size: 11, anchor: "middle", color: C.muted });
  const A = axes(s, {
    x: 60,
    y: 240,
    w: 540,
    h: 130,
    xDomain: [0, Lmm],
    yDomain: [0, 100],
    xTicks: [0, 200, 400, 600, 800],
    yTicks: [0, 25, 50, 75, 100],
    xLabel: "z [mm]",
    yLabel: "take-up speed [mm/s]",
  });
  band(A, 240, 370);
  s.polyline(vgeo.map(([z, v]) => [A.X(z), A.Y(v)]), {
    stroke: C.geodesic,
    width: 2.4,
    dash: "7 4",
  });
  s.line(A.X(0), A.Y(c.takeUp * MM), A.X(Lmm), A.Y(c.takeUp * MM), {
    stroke: C.plus,
    width: 2.5,
  });
  s.text(A.X(790), A.Y(c.takeUp * MM) + 18, `run: constant ${(c.takeUp * MM).toFixed(0)} mm/s`, {
    size: 12,
    anchor: "end",
    weight: 600,
  });
  s.text(A.X(15), A.Y(60), "geodesic braid, quasi-static schedule", { size: 12 });
  s.text(
    20,
    H - 14,
    `geodesic pair: r sin α = ±${(cc * MM).toFixed(1)} mm (the braid's value at z = 250 mm)`,
    {
      size: 12,
      color: C.muted,
      math: true,
    },
  );
  return s.toString();
}

// ── Registry and CLI ────────────────────────────────────────────────────────────────────────────

/** All figures: file name → builder. */
export const FIGURES = Object.freeze({
  "overview.svg": figOverview,
  "machine-side.svg": figMachineSide,
  "tangency-front.svg": figTangencyFront,
  "contact-states.svg": figContactStates,
  "darboux-frame.svg": figDarbouxFrame,
  "bridging-contact.svg": figBridging,
  "transient-cylinder.svg": figTransient,
  "lag-taper.svg": figLagTaper,
  "euler-normal-curvature.svg": figEuler,
  "gaussian-curvature-profiles.svg": figProfilesK,
  "geodesic-vs-braid.svg": figGeodesic,
  "friction-cone.svg": figFrictionCone,
  "horn-gear-track.svg": figTrack,
  "interlacing-patterns.svg": figPatterns,
  "cover-jamming.svg": figCover,
  "foliation-curl-div.svg": figCurlDiv,
  "clairaut-friction.svg": figClairautFriction,
  "geodesic-braid.svg": figGeodesicBraid,
});

/** Builds every figure. @returns {Record<string, string>} file name → SVG source */
export function buildFigures() {
  const out = {};
  for (const [name, fn] of Object.entries(FIGURES)) out[name] = fn();
  return out;
}

if (import.meta.main) {
  const dir = new URL("../../docs/figures/", import.meta.url);
  await Deno.mkdir(dir, { recursive: true });
  for (const [name, svg] of Object.entries(buildFigures())) {
    await Deno.writeTextFile(new URL(name, dir), svg);
    console.log(`docs/figures/${name}`);
  }
}
