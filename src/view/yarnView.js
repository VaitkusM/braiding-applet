/**
 * @file yarnView.js — deposited yarns as flat elliptical tapes (custom BufferGeometry), in the
 * MANDREL frame (the group is a child of the mandrel group).
 *
 * Each yarn is a sequence of RINGS (cross-sections) at selected path samples. A ring's frame comes
 * from the surface — normal n and yarn tangent t stored with the sample, b = n × t — so the tape
 * lies flat on the mandrel (TubeGeometry's Frenet frames would twist it). The ring centre is lifted
 * along n by the undulation height t_y·(c + a·σ̃(s)), where σ̃ is the smoothed over/under side from
 * crossings.js; at every crossing the two yarns get opposite σ̃ = ±1, so they never interpenetrate
 * there. (Near side changes of dense, nearly jammed braids some clipping of flat tapes is
 * unavoidable — documented in docs/THEORY.md.)
 *
 * Buffers are preallocated and grown by doubling; per frame only new/changed rings are written
 * (addUpdateRange) and the draw range is extended. The newest ring (the "tail", at the current fell
 * point) is rewritten every frame.
 *
 * Level of detail: ring spacing ≈ crossing spacing / 6, clamped to [0.5, 3] mm. If the estimated
 * vertex count exceeds the budget, undulation is switched off (flat, layered tapes, 2 mm spacing).
 */

import * as THREE from "three";
import {
  AXIAL_COLOR,
  diverging,
  hexToRgb,
  sequential,
  SERIES,
  srgbToLinear,
  STATUS,
} from "./colormaps.js";
import { FLAG } from "../core/yarnPath.js";

/** @typedef {import("../core/simulation.js").Simulation} Simulation */
/** @typedef {import("../core/yarnPath.js").YarnPath} YarnPath */

const NSEG = 8; // vertices per cross-section
const VERTEX_BUDGET = 1.5e6;
const lin = (rgb) => rgb.map(srgbToLinear);
const hexLin = (hex) => lin(hexToRgb(hex));

/** Yarn colour modes and their colour-bar descriptions. */
export const YARN_COLOR_MODES = Object.freeze({
  family: "Yarn family",
  alpha: "Braid angle |α|",
  slip: "Slip ratio |κg/κn| / μ",
  kn: "Normal curvature κn",
  kg: "Geodesic curvature κg",
  pressure: "Contact pressure p = T·κn",
  flags: "Flags (slip / bridge / jam)",
});

export class YarnView {
  /**
   * @param {Simulation} sim
   * @param {{thicknessScale:number, colorMode:string}} opts
   */
  constructor(sim, opts) {
    this.sim = sim;
    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.02,
    });
    this.selectedMaterial = this.material.clone();
    this.selectedMaterial.emissive = new THREE.Color(0x3a3a3a);

    const c = sim.config, prof = sim.profile;
    this.thickness = c.yarnThickness * opts.thicknessScale;
    this.width = c.yarnWidth;
    this.axialWidth = c.axialWidth;
    this.triaxial = sim.axialYarns.length > 0;

    // Level of detail from the estimated crossing spacing along a yarn: s_c = 2π r / (N sin α).
    const rRef = prof.evaluate(prof.length / 2).r;
    const aRef = Math.atan2(c.omega * rRef, c.takeUp);
    const sCross = (2 * Math.PI * rRef) / (c.carriers * Math.max(0.2, Math.sin(aRef)));
    let ds = Math.min(3e-3, Math.max(5e-4, sCross / 6));
    // Longest path: where the (quasi-static) braid angle is largest.
    let cosMin = 1;
    for (let i = 0; i <= 50; i++) {
      const e = prof.evaluate((i / 50) * prof.length);
      cosMin = Math.min(
        cosMin,
        Math.cos(Math.atan2(c.omega * e.r, c.takeUp * Math.sqrt(1 + e.dr * e.dr))),
      );
    }
    const pathLen = prof.length / Math.max(cosMin, 1e-3);
    const nYarns = sim.yarns.length + sim.axialYarns.length;
    this.undulate = nYarns * (pathLen / ds) * NSEG <= VERTEX_BUDGET;
    // Too many vertices: flat layered tapes, with the ring spacing that meets the budget.
    if (!this.undulate) ds = Math.max(ds, 2e-3, (nYarns * pathLen * NSEG) / VERTEX_BUDGET);
    this.ringSpacing = ds;
    this.capacityHint = Math.ceil((pathLen / ds) * 1.1) + 16;

    // Heights in units of the rendered thickness (centre line above the surface).
    const eps = 0.06;
    this.c = (this.triaxial ? 1.5 : 1.0) + eps;
    this.a = this.triaxial ? 1.0 : 0.5;

    this.colorMode = opts.colorMode;
    this.selected = 0;
    this.entries = [];
    sim.yarns.forEach((y, k) => this.entries.push(this.makeEntry(y, sim.crossings.events[k], k)));
    sim.axialYarns.forEach((y) => this.entries.push(this.makeEntry(y, null, -1)));
    this.applySelection();
  }

  /** Creates the mesh + bookkeeping for one yarn. */
  makeEntry(path, events, k) {
    const geo = new THREE.BufferGeometry();
    const e = {
      path,
      events,
      k,
      geo,
      mesh: new THREE.Mesh(geo, this.material),
      cap: 0,
      rings: [], // sample index of each committed ring
      ringArc: [], // arc position of each committed ring
      nextSample: 0,
      centers: null, // ring centres (for picking)
      written: 0, // rings written so far (committed + tail)
    };
    e.mesh.frustumCulled = false;
    this.allocate(e, this.capacityHint);
    this.group.add(e.mesh);
    return e;
  }

  /** (Re)allocates buffers for `cap` rings, preserving existing contents. */
  allocate(e, cap) {
    const pos = new Float32Array(cap * NSEG * 3), nor = new Float32Array(cap * NSEG * 3);
    const col = new Float32Array(cap * NSEG * 3), centers = new Float32Array(cap * 3);
    if (e.cap) {
      pos.set(e.geo.getAttribute("position").array);
      nor.set(e.geo.getAttribute("normal").array);
      col.set(e.geo.getAttribute("color").array);
      centers.set(e.centers);
      // Replacing attributes would leave the old GL buffers alive: use a fresh geometry instead.
      const old = e.geo;
      e.geo = new THREE.BufferGeometry();
      e.mesh.geometry = e.geo;
      e.geo.setDrawRange(0, old.drawRange.count);
      old.dispose();
    }
    const idx = new Uint32Array((cap - 1) * NSEG * 6);
    let o = 0;
    for (let r = 0; r < cap - 1; r++) {
      for (let k = 0; k < NSEG; k++) {
        const a = r * NSEG + k, b = r * NSEG + ((k + 1) % NSEG);
        const c = a + NSEG, d = b + NSEG;
        // (b − a) × (c − a) ∝ n × t = +b at φ = 0: triangles face outwards.
        idx[o++] = a;
        idx[o++] = b;
        idx[o++] = c;
        idx[o++] = b;
        idx[o++] = d;
        idx[o++] = c;
      }
    }
    for (const [name, arr] of [["position", pos], ["normal", nor], ["color", col]]) {
      const attr = new THREE.BufferAttribute(arr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      e.geo.setAttribute(name, attr);
    }
    e.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    e.centers = centers;
    e.cap = cap;
    e.fullUpload = true;
  }

  /** Brings every yarn mesh up to date with the simulation. */
  update() {
    for (const e of this.entries) this.sync(e);
  }

  /** Incremental update of one yarn. */
  sync(e) {
    const y = e.path, n = y.count;
    if (n === 0) return;
    const committedBefore = e.rings.length;
    // 1. Commit rings for samples that are no longer the newest.
    for (let i = e.nextSample; i < n - 1; i++) {
      const lastArc = e.ringArc.length ? e.ringArc[e.ringArc.length - 1] : -Infinity;
      const keep = y.arc[i] - lastArc >= this.ringSpacing ||
        (y.flags[i] & (FLAG.BRIDGE | FLAG.TIE)) !== 0 ||
        (y.flags[i + 1] & FLAG.BRIDGE) !== 0; // chord start
      if (keep && y.arc[i] > lastArc) {
        e.rings.push(i);
        e.ringArc.push(y.arc[i]);
      }
    }
    e.nextSample = Math.max(e.nextSample, n - 1);
    const total = e.rings.length + 1; // + tail
    if (total > e.cap) this.allocate(e, Math.max(total + 16, e.cap * 2));

    // 2. Rings whose undulation changed because of new crossings.
    let from = Math.max(0, committedBefore - 1);
    if (e.events && this.undulate) {
      const dirty = e.events.takeDirty();
      if (dirty !== Infinity) from = Math.min(from, lowerBound(e.ringArc, dirty));
    }
    if (e.fullUpload) from = 0;

    // 3. Write rings [from, total).
    for (let r = from; r < total; r++) {
      this.writeRing(e, r, r < e.rings.length ? e.rings[r] : n - 1);
    }
    this.markUpdated(e, from, total);
    e.written = total;
    e.geo.setDrawRange(0, Math.max(0, total - 1) * NSEG * 6);
  }

  /** Flags GPU upload of the ring range [from, to). */
  markUpdated(e, from, to) {
    for (const name of ["position", "normal", "color"]) {
      const attr = e.geo.getAttribute(name);
      attr.clearUpdateRanges();
      if (!e.fullUpload) attr.addUpdateRange(from * NSEG * 3, (to - from) * NSEG * 3);
      attr.needsUpdate = true;
    }
    if (e.fullUpload) e.geo.getIndex().needsUpdate = true;
    e.fullUpload = false;
  }

  /** Undulation side σ̃ at arc position s of yarn entry e. */
  sideAt(e, s) {
    if (e.k < 0) return 0; // axial yarn
    if (!this.undulate) return e.path.family; // layered: "+" on top
    return e.events ? e.events.sideAt(s) : 0;
  }

  /** Writes ring r of entry e from path sample i. */
  writeRing(e, r, i) {
    const y = e.path;
    const n = [y.nx[i], y.ny[i], y.nz[i]];
    const t = [y.tx[i], y.ty[i], y.tz[i]];
    let b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const bl = Math.hypot(b[0], b[1], b[2]) || 1;
    b = [b[0] / bl, b[1] / bl, b[2] / bl];
    const T = this.thickness;
    const h = T * (e.k < 0 ? this.c : this.c + this.a * this.sideAt(e, y.arc[i]));
    const C = [y.x[i] + h * n[0], y.y[i] + h * n[1], y.z[i] + h * n[2]];
    e.centers.set(C, 3 * r);
    const hw = (e.k < 0 ? this.axialWidth : this.width) / 2, ht = T / 2;
    const col = this.colorOf(e, i);
    const pos = e.geo.getAttribute("position").array;
    const nor = e.geo.getAttribute("normal").array;
    const cols = e.geo.getAttribute("color").array;
    for (let k = 0; k < NSEG; k++) {
      const phi = (2 * Math.PI * k) / NSEG;
      const cb = Math.cos(phi), sn = Math.sin(phi);
      const o = (r * NSEG + k) * 3;
      for (let d = 0; d < 3; d++) {
        pos[o + d] = C[d] + hw * cb * b[d] + ht * sn * n[d];
        nor[o + d] = (cb / hw) * b[d] + (sn / ht) * n[d];
        cols[o + d] = col[d];
      }
      const l = Math.hypot(nor[o], nor[o + 1], nor[o + 2]);
      nor[o] /= l;
      nor[o + 1] /= l;
      nor[o + 2] /= l;
    }
  }

  /** Linear-RGB colour of sample i of entry e for the current colour mode. */
  colorOf(e, i) {
    const y = e.path, c = this.sim.config, rMin = this.sim.profile.rMin;
    const neutral = hexLin("#898781");
    if (e.k < 0 && this.colorMode === "family") return hexLin(AXIAL_COLOR);
    switch (this.colorMode) {
      case "family":
        return hexLin(y.family === 1 ? SERIES.plus : SERIES.minus);
      case "alpha":
        return lin(sequential(Math.abs(y.alpha[i]) / (Math.PI / 2)));
      case "slip": {
        // Status first (also for μ = 0), then the ratio |κg/κn| / μ on the sequential scale.
        const r = Math.abs(y.slip[i]);
        if (!Number.isFinite(r)) return neutral;
        if (r > c.friction) return hexLin(STATUS.critical);
        return lin(sequential(c.friction > 0 ? r / c.friction : 0));
      }
      case "kn":
        return Number.isFinite(y.kn[i]) ? lin(sequential(y.kn[i] * rMin)) : neutral;
      case "kg":
        return Number.isFinite(y.kg[i]) ? lin(diverging(y.kg[i] * rMin * 2)) : neutral;
      case "pressure":
        return Number.isFinite(y.kn[i])
          ? lin(sequential(y.kn[i] * rMin)) // p / p_max = T κn / (T / r_min)
          : neutral;
      case "flags": {
        const f = y.flags[i];
        if (f & FLAG.SLIP) return hexLin(STATUS.critical);
        if (f & (FLAG.BRIDGE | FLAG.CONTACT | FLAG.LIFTOFF)) return hexLin(STATUS.serious);
        if (f & FLAG.JAM) return hexLin(STATUS.warning);
        return hexLin("#5d5c58");
      }
      default:
        return neutral;
    }
  }

  /** Colour-bar description for the current mode (see ui/colorbar in app.js). */
  legend() {
    const c = this.sim.config, rMin = this.sim.profile.rMin;
    switch (this.colorMode) {
      case "family":
        return {
          title: "Yarn family",
          keys: [
            { color: SERIES.plus, label: "+ family (counter-clockwise carriers)" },
            { color: SERIES.minus, label: "− family (clockwise carriers)" },
            ...(this.triaxial ? [{ color: AXIAL_COLOR, label: "axial yarns" }] : []),
          ],
        };
      case "alpha":
        return {
          title: "Braid angle |α| (from the meridian)",
          unit: "°",
          kind: "sequential",
          min: 0,
          max: 90,
        };
      case "slip":
        return {
          title: `Slip ratio |κg/κn| relative to μ = ${c.friction}`,
          unit: "× μ",
          kind: "sequential",
          min: 0,
          max: 1,
          keys: [{ color: STATUS.critical, label: "slips (|κg| > μ κn)" }, {
            color: "#898781",
            label: "undefined (tie / bridge)",
          }],
        };
      case "kn":
        return {
          title: "Normal curvature κn (convex > 0)",
          unit: "1/m",
          kind: "sequential",
          min: 0,
          max: 1 / rMin,
        };
      case "kg":
        return {
          title: "Geodesic curvature κg",
          unit: "1/m",
          kind: "diverging",
          min: -0.5 / rMin,
          max: 0.5 / rMin,
        };
      case "pressure":
        return {
          title: `Contact pressure p = T κn (T = ${c.tension} N)`,
          unit: "N/m",
          kind: "sequential",
          min: 0,
          max: c.tension / rMin,
        };
      case "flags":
        return {
          title: "Deposition flags",
          keys: [
            { color: STATUS.critical, label: "slip (friction exceeded)" },
            { color: STATUS.serious, label: "bridge / contact / lift-off" },
            { color: STATUS.warning, label: "jammed (k ≥ 1)" },
            { color: "#5d5c58", label: "ok" },
          ],
        };
    }
    return null;
  }

  /** Changes the colour mode and recolours every ring. */
  setColorMode(mode) {
    this.colorMode = mode;
    for (const e of this.entries) {
      const cols = e.geo.getAttribute("color");
      const total = e.rings.length + 1;
      for (let r = 0; r < total && e.path.count; r++) {
        const col = this.colorOf(e, r < e.rings.length ? e.rings[r] : e.path.count - 1);
        for (let k = 0; k < NSEG; k++) cols.setXYZ(r * NSEG + k, col[0], col[1], col[2]);
      }
      cols.clearUpdateRanges();
      cols.needsUpdate = true;
      e.fullUpload = true; // the next sync must upload everything, not just the newest rings
    }
  }

  /** Highlights the selected bias yarn. */
  setSelected(k) {
    this.selected = k;
    this.applySelection();
  }

  applySelection() {
    this.entries.forEach((
      e,
    ) => (e.mesh.material = e.k === this.selected ? this.selectedMaterial : this.material));
  }

  /**
   * Picks the bias yarn whose centre line passes closest to a screen point.
   * @param {number} x @param {number} y CSS pixels in the viewport
   * @param {THREE.Camera} camera @param {{w:number, h:number}} size
   * @param {number} [maxDist=Infinity] ignore ring centres farther from the camera (occlusion)
   * @returns {number} yarn index or −1 (nothing within 12 px)
   */
  pick(x, y, camera, size, maxDist = Infinity) {
    const m = this.group.matrixWorld, v = new THREE.Vector3();
    const eye = camera.getWorldPosition(new THREE.Vector3());
    let best = -1, bestD = 12 * 12;
    for (const e of this.entries) {
      if (e.k < 0) continue;
      const step = Math.max(1, Math.floor(e.written / 400));
      for (let r = 0; r < e.written; r += step) {
        v.fromArray(e.centers, 3 * r).applyMatrix4(m);
        if (v.distanceTo(eye) > maxDist) continue;
        v.project(camera);
        if (v.z < -1 || v.z > 1) continue;
        const dx = (v.x * 0.5 + 0.5) * size.w - x, dy = (-v.y * 0.5 + 0.5) * size.h - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = e.k;
        }
      }
    }
    return best;
  }

  dispose() {
    for (const e of this.entries) e.geo.dispose();
    this.material.dispose();
    this.selectedMaterial.dispose();
  }
}

/** First index i with arr[i] ≥ x (arr ascending). */
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
