/**
 * @file yarnView.js — deposited yarns, in the MANDREL frame (the group is a child of the mandrel
 * group). Two drawing styles share one controller:
 *  - "line": fat screen-space lines, drawn exactly like the free yarns (LineSegments2, same width);
 *  - "tape": flat elliptical tapes of the real yarn width (custom BufferGeometry).
 *
 * Each yarn is a sequence of RINGS at selected path samples. A ring's frame comes from the
 * surface — normal n and yarn tangent t stored with the sample, b = n × t — so tapes lie flat on
 * the mandrel (TubeGeometry's Frenet frames would twist them). The ring centre is lifted along n by
 * the undulation height t_y·(c + a·σ̃(s)), where σ̃ is the smoothed over/under side from
 * crossings.js; at every crossing the two yarns get opposite σ̃ = ±1, so the upper one is drawn on
 * top (lines: by depth; tapes: they never interpenetrate there). Near side changes of dense, nearly
 * jammed braids some clipping of flat tapes is unavoidable (docs/THEORY.md §10).
 *
 * Buffers are preallocated and grown by doubling; per frame only new/changed rings are written
 * (addUpdateRange) and the drawn range is extended. The newest ring (the "tail", at the current fell
 * point) is rewritten every frame.
 *
 * Level of detail: ring spacing ≈ crossing spacing / 6, clamped to [0.5, 3] mm. If the estimated
 * vertex count exceeds the budget, undulation is switched off (layered, "+" on top) and the spacing
 * grows until the budget is met.
 */

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  AXIAL_COLOR,
  curvatureMap,
  hexToRgb,
  pivotScale,
  sequential,
  SERIES,
  srgbToLinear,
  STATUS,
} from "./colormaps.js";
import { FLAG } from "../core/yarnPath.js";
import { curvatureRanges, RangeTracker, sliderBounds, YARN_SCALES, yarnRange } from "./scales.js";

/** @typedef {import("../core/simulation.js").Simulation} Simulation */
/** @typedef {import("../core/yarnPath.js").YarnPath} YarnPath */

const NSEG = 8; // vertices per tape cross-section
const VERTEX_BUDGET = 1.5e6;
/** Width of yarn lines in CSS pixels — shared with the free yarns (machineView.js). */
export const YARN_LINE_WIDTH = 1.4;
/** Drawing styles of the deposited yarns. */
export const YARN_STYLES = Object.freeze({
  line: "Lines (like the free yarns)",
  tape: "Flat tapes",
});
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
    /** "line" | "tape" */
    this.style = opts.style ?? "line";
    if (this.style === "tape") {
      this.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.02,
      });
      this.selectedMaterial = this.material.clone();
      this.selectedMaterial.emissive = new THREE.Color(0x3a3a3a);
    } else {
      this.material = new LineMaterial({ vertexColors: true, linewidth: YARN_LINE_WIDTH });
      this.selectedMaterial = new LineMaterial({
        vertexColors: true,
        linewidth: 2.5 * YARN_LINE_WIDTH,
      });
    }
    const vertsPerRing = this.style === "tape" ? NSEG : 2;

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
    this.undulate = nYarns * (pathLen / ds) * vertsPerRing <= VERTEX_BUDGET;
    // Too many vertices: layered yarns without undulation, with the spacing that meets the budget.
    if (!this.undulate) ds = Math.max(ds, 2e-3, (nYarns * pathLen * vertsPerRing) / VERTEX_BUDGET);
    this.ringSpacing = ds;
    this.capacityHint = Math.ceil((pathLen / ds) * 1.1) + 16;

    // Heights in units of the rendered thickness (centre line above the surface).
    const eps = 0.06;
    this.c = (this.triaxial ? 1.5 : 1.0) + eps;
    this.a = this.triaxial ? 1.0 : 0.5;

    this.colorMode = opts.colorMode;
    // Scalar colourings (scales.js): one scale spec per colouring, the running data ranges of the
    // bias yarns, and the effective range of the current colouring (null if it has no scale).
    this.scaleCtx = { mu: c.friction, tension: c.tension, ...curvatureRanges(prof) };
    this.scales = {};
    for (const k of Object.keys(YARN_SCALES)) {
      this.scales[k] = { mode: "data", ...opts.scales?.[k] };
    }
    this.tracker = new RangeTracker();
    this.range = this.effectiveRange();
    this.lastRangeUpdate = -Infinity;
    /** Incremented whenever the legend (colour-bar ticks) changes. */
    this.legendVersion = 0;
    this.selected = 0;
    this.entries = [];
    sim.yarns.forEach((y, k) => this.entries.push(this.makeEntry(y, sim.crossings.events[k], k)));
    sim.axialYarns.forEach((y) => this.entries.push(this.makeEntry(y, null, -1)));
    this.applySelection();
    this.applyToneMapping();
  }

  /** Creates the drawable + bookkeeping for one yarn. */
  makeEntry(path, events, k) {
    const draw = this.style === "tape"
      ? new TapeDrawable(this.material)
      : new LineDrawable(this.material);
    const e = {
      path,
      events,
      k,
      draw,
      cap: 0,
      rings: [], // sample index of each committed ring
      ringArc: [], // arc position of each committed ring
      nextSample: 0,
      centers: null, // ring centres (for picking)
      written: 0, // rings written so far (committed + tail)
    };
    this.allocate(e, this.capacityHint);
    this.group.add(draw.object);
    return e;
  }

  /** (Re)allocates buffers for `cap` rings, preserving existing contents. */
  allocate(e, cap) {
    const centers = new Float32Array(cap * 3);
    if (e.cap) centers.set(e.centers);
    e.draw.allocate(cap);
    e.centers = centers;
    e.cap = cap;
    e.fullUpload = true;
  }

  /** Brings every yarn mesh up to date with the simulation. */
  update() {
    for (const e of this.entries) this.sync(e);
    if (this.scales[this.colorMode]?.mode === "data") this.followDataRange();
  }

  /**
   * Effective range {min, mid, max} (display units) of colouring `key` (default: the current one),
   * or null if that colouring has no continuous scale.
   */
  effectiveRange(key = this.colorMode) {
    if (!YARN_SCALES[key]) return null;
    return yarnRange(key, this.scales[key], this.tracker.get(key), this.scaleCtx);
  }

  /**
   * Data-range mode: follows the growing range of the run. Recolours only when a bound has moved by
   * more than 2 % of the span, and at most every 300 ms.
   */
  followDataRange() {
    const next = this.effectiveRange(), cur = this.range;
    const tol = 0.02 * (next.max - next.min);
    if (
      Math.abs(next.min - cur.min) <= tol && Math.abs(next.max - cur.max) <= tol &&
      Math.abs(next.mid - cur.mid) <= tol
    ) return;
    const now = performance.now();
    if (now - this.lastRangeUpdate < 300) return;
    this.lastRangeUpdate = now;
    this.range = next;
    this.recolorAll();
    this.legendVersion++;
  }

  /**
   * Sets the colour scale of colouring `key`.
   * @param {string} key @param {import("./scales.js").ScaleSpec} spec (bounds in display units)
   */
  setScale(key, spec) {
    this.scales[key] = { ...this.scales[key], ...spec };
    if (key !== this.colorMode) return;
    this.range = this.effectiveRange();
    this.lastRangeUpdate = performance.now();
    this.recolorAll();
    this.legendVersion++;
  }

  /**
   * Scale information for the controls: effective range, full range, slider bounds, unit.
   * @param {string} [key] colouring (default: current); null if it has no scale
   */
  scaleInfo(key = this.colorMode) {
    const def = YARN_SCALES[key];
    if (!def) return null;
    const range = this.effectiveRange(key), full = def.full(this.scaleCtx);
    return {
      spec: this.scales[key],
      range,
      full,
      bounds: sliderBounds(full, range),
      unit: def.unit,
      zeroPivot: !!def.curvature, // green at 0; custom mid may coincide with an end
    };
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
    e.draw.markUpdated(from, total, e.fullUpload);
    e.fullUpload = false;
    e.written = total;
    e.draw.setRingCount(total);
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
    const hw = (e.k < 0 ? this.axialWidth : this.width) / 2;
    // Data ranges: drawn samples of the bias yarns (tie points and axial yarns excluded).
    if (e.k >= 0 && !(y.flags[i] & FLAG.TIE)) this.tracker.add(y, i, this.scaleCtx);
    e.draw.writeRing(r, C, n, b, this.colorOf(e, i), hw, T / 2);
  }

  /** Linear-RGB colour of sample i of entry e for the current colour mode. */
  colorOf(e, i) {
    const y = e.path, mode = this.colorMode;
    const neutral = hexLin("#898781");
    if (mode === "family") {
      if (e.k < 0) return hexLin(AXIAL_COLOR);
      return hexLin(y.family === 1 ? SERIES.plus : SERIES.minus);
    }
    if (mode === "flags") {
      const f = y.flags[i];
      if (f & FLAG.SLIP) return hexLin(STATUS.critical);
      if (f & (FLAG.BRIDGE | FLAG.CONTACT | FLAG.LIFTOFF)) return hexLin(STATUS.serious);
      if (f & FLAG.JAM) return hexLin(STATUS.warning);
      return hexLin("#5d5c58");
    }
    const def = YARN_SCALES[mode];
    if (!def) return neutral;
    if (mode === "slip") {
      // Status first (also for μ = 0): friction cannot hold the path.
      const r = Math.abs(y.slip[i]);
      if (!Number.isFinite(r)) return neutral;
      if (r > this.scaleCtx.mu) return hexLin(STATUS.critical);
    }
    const v = def.value(y, i, this.scaleCtx), R = this.range;
    if (!Number.isFinite(v)) return neutral;
    const t = pivotScale(v, R.min, R.mid, R.max);
    return lin(def.curvature ? curvatureMap(t) : sequential(t));
  }

  /** Colour-bar description for the current mode (see ui/colorbar in app.js). */
  legend() {
    const def = YARN_SCALES[this.colorMode];
    if (def) {
      const R = this.range, s = this.scales[this.colorMode];
      const what =
        { data: "range of this run", custom: "custom range", full: "full range" }[s.mode];
      const extra = this.colorMode === "slip"
        ? ` = ${this.scaleCtx.mu}`
        : this.colorMode === "pressure"
        ? ` (T = ${this.scaleCtx.tension} N)`
        : "";
      return {
        title: `${def.label}${extra} · ${what}`,
        unit: def.unit,
        kind: def.curvature ? "curvature" : "sequential",
        min: R.min,
        mid: R.mid,
        max: R.max,
        // κg and the slip ratio are undefined at tie points and bridge ends (drawn gray).
        keys: this.colorMode === "slip"
          ? [
            { color: STATUS.critical, label: "slips (|κg| > μ κn)" },
            { color: "#898781", label: "undefined (tie / bridge)" },
          ]
          : this.colorMode === "kg"
          ? [{ color: "#898781", label: "undefined (tie / bridge)" }]
          : undefined,
      };
    }
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
    this.applyToneMapping();
    this.range = this.effectiveRange();
    this.recolorAll();
    this.legendVersion++;
  }

  /**
   * Curvature maps (κn, κg) are drawn without tone mapping so that their hues are exact (ACES would
   * turn the pure green into a pale yellow-green); all other colourings stay tone-mapped.
   */
  applyToneMapping() {
    const exact = !!YARN_SCALES[this.colorMode]?.curvature;
    for (const m of [this.material, this.selectedMaterial]) {
      if (m.toneMapped === !exact) continue;
      m.toneMapped = !exact;
      m.needsUpdate = true;
    }
  }

  /** Recomputes every ring colour (uploaded in full by the next sync). */
  recolorAll() {
    for (const e of this.entries) {
      const total = e.rings.length + 1;
      for (let r = 0; r < total && e.path.count; r++) {
        e.draw.writeColor(r, this.colorOf(e, r < e.rings.length ? e.rings[r] : e.path.count - 1));
      }
      e.fullUpload = true; // the next sync must upload everything, not just the newest rings
    }
  }

  /** Highlights the selected bias yarn. */
  setSelected(k) {
    this.selected = k;
    this.applySelection();
  }

  applySelection() {
    for (const e of this.entries) {
      e.draw.object.material = e.k === this.selected ? this.selectedMaterial : this.material;
    }
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

  /** Line materials need the viewport size in pixels (no-op for tapes). */
  setResolution(w, h) {
    if (this.style === "line") {
      this.material.resolution.set(w, h);
      this.selectedMaterial.resolution.set(w, h);
    }
  }

  dispose() {
    for (const e of this.entries) e.draw.dispose();
    this.material.dispose();
    this.selectedMaterial.dispose();
  }
}

// ── Drawables: the geometry of one yarn in one style ────────────────────────────────────────────
// Interface: object (THREE.Object3D) · allocate(cap) keeps existing content · writeRing(r, C, n, b,
// colour, halfWidth, halfThickness) · writeColor(r, colour) · setRingCount(n) ·
// markUpdated(from, to, full) · dispose().

/** Flat elliptical tape: NSEG vertices per ring, quads between consecutive rings. */
class TapeDrawable {
  constructor(material) {
    this.geo = new THREE.BufferGeometry();
    this.object = new THREE.Mesh(this.geo, material);
    this.object.frustumCulled = false;
    this.cap = 0;
  }

  allocate(cap) {
    const pos = new Float32Array(cap * NSEG * 3), nor = new Float32Array(cap * NSEG * 3);
    const col = new Float32Array(cap * NSEG * 3);
    if (this.cap) {
      pos.set(this.geo.getAttribute("position").array);
      nor.set(this.geo.getAttribute("normal").array);
      col.set(this.geo.getAttribute("color").array);
      // Replacing attributes would leave the old GL buffers alive: use a fresh geometry instead.
      const old = this.geo;
      this.geo = new THREE.BufferGeometry();
      this.object.geometry = this.geo;
      this.geo.setDrawRange(0, old.drawRange.count);
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
      this.geo.setAttribute(name, attr);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.cap = cap;
  }

  writeRing(r, C, n, b, col, hw, ht) {
    const pos = this.geo.getAttribute("position").array;
    const nor = this.geo.getAttribute("normal").array;
    const cols = this.geo.getAttribute("color").array;
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

  writeColor(r, col) {
    const cols = this.geo.getAttribute("color");
    for (let k = 0; k < NSEG; k++) cols.setXYZ(r * NSEG + k, col[0], col[1], col[2]);
  }

  setRingCount(n) {
    this.geo.setDrawRange(0, Math.max(0, n - 1) * NSEG * 6);
  }

  markUpdated(from, to, full) {
    for (const name of ["position", "normal", "color"]) {
      const attr = this.geo.getAttribute(name);
      attr.clearUpdateRanges();
      if (!full) attr.addUpdateRange(from * NSEG * 3, (to - from) * NSEG * 3);
      attr.needsUpdate = true;
    }
    if (full) this.geo.getIndex().needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
  }
}

/**
 * Fat screen-space line through the ring centres, drawn like the free yarns. Segment s joins
 * ring s and ring s + 1; each segment stores its two end points (and colours), so writing ring r
 * touches the end of segment r − 1 and the start of segment r.
 */
class LineDrawable {
  constructor(material) {
    this.geo = new LineSegmentsGeometry();
    this.object = new LineSegments2(this.geo, material);
    this.object.frustumCulled = false;
    this.cap = 0;
  }

  allocate(cap) {
    const pos = new Float32Array((cap - 1) * 6), col = new Float32Array((cap - 1) * 6);
    if (this.cap) {
      pos.set(this.pos);
      col.set(this.col);
      const old = this.geo;
      this.geo = new LineSegmentsGeometry();
      this.object.geometry = this.geo;
      old.dispose();
    }
    // setPositions / setColors wrap these arrays (no copy), so they can be updated in place.
    this.geo.setPositions(pos);
    this.geo.setColors(col);
    this.pos = pos;
    this.col = col;
    this.cap = cap;
    this.geo.instanceCount = 0;
  }

  /** Writes 3 floats of ring r into the start of segment r and the end of segment r − 1. */
  put(arr, r, v) {
    if (r < this.cap - 1) arr.set(v, 6 * r);
    if (r > 0) arr.set(v, 6 * (r - 1) + 3);
  }

  writeRing(r, C, _n, _b, col) {
    this.put(this.pos, r, C);
    this.put(this.col, r, col);
  }

  writeColor(r, col) {
    this.put(this.col, r, col);
  }

  setRingCount(n) {
    this.geo.instanceCount = Math.max(0, n - 1);
  }

  markUpdated(from, to, full) {
    for (const name of ["instanceStart", "instanceColorStart"]) {
      const buf = this.geo.attributes[name].data;
      buf.clearUpdateRanges();
      if (!full) {
        const s0 = Math.max(0, from - 1) * 6, s1 = Math.min(this.cap - 1, to) * 6;
        if (s1 > s0) buf.addUpdateRange(s0, s1 - s0);
      }
      buf.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
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
