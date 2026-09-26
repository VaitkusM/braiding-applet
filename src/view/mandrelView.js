/**
 * @file mandrelView.js — the mandrel: a lathe mesh built in the MANDREL frame, plus end caps and a
 * support shaft. Its parent group carries the mandrel pose, so every child (yarns, overlays) moves
 * with the mandrel.
 *
 * Colour modes: "metal" (reflective), "flat" (matte, one user-chosen colour: no metallic highlights,
 * so coloured yarns read evenly against it), "K" / "H" (Gaussian / mean curvature on the diverging
 * blue–gray–red scale; range "auto" = ±max |value| on this mandrel, or custom min / mid / max with
 * mid at the neutral colour — see scales.js).
 */

import * as THREE from "three";
import { diverging, pivotScale, srgbToLinear } from "./colormaps.js";
import { mandrelRange, sliderBounds } from "./scales.js";

/** Mandrel colour modes. */
export const MANDREL_COLOR_MODES = Object.freeze({
  metal: "Metal",
  flat: "Flat colour (matte)",
  K: "Gaussian curvature K",
  H: "Mean curvature H",
});

/**
 * Default colour of the flat (matte) mandrel: a medium slate gray, chosen by measuring OKLab ΔE
 * between the rendered matte mandrel and every yarn colour (ramp, families, axial ivory, status):
 * ΔE ≥ 11 over 90 % of the surface for all of them, while the silhouette keeps ΔE ≈ 22 against the
 * dark background. Lighter grays hide the ivory axial yarns; darker ones merge with the background.
 */
export const DEFAULT_FLAT_COLOR = "#686b6f";

const CURVATURE = Object.freeze({
  K: { label: "Gaussian curvature K", unit: "1/m²" },
  H: { label: "Mean curvature H (convex > 0)", unit: "1/m" },
});

/** @typedef {import("../core/simulation.js").Simulation} Simulation */

export class MandrelView {
  /**
   * @param {Simulation} sim
   * @param {{flatColor?:string, scales?:Record<string, import("./scales.js").ScaleSpec>}} [opts]
   */
  constructor(sim, opts = {}) {
    this.sim = sim;
    /** Group in the mandrel frame; its matrix is set from the pose every frame. */
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;

    const surf = sim.surface, L = sim.profile.length;
    const nz = Math.min(700, Math.max(160, Math.round(L / 0.0015)));
    const nt = 128;
    const pos = new Float32Array((nz + 1) * (nt + 1) * 3);
    const nor = new Float32Array(pos.length);
    const col = new Float32Array(pos.length);
    /** Per-vertex K and H (for colouring). */
    this.K = new Float32Array((nz + 1) * (nt + 1));
    this.H = new Float32Array(this.K.length);
    let v = 0;
    for (let i = 0; i <= nz; i++) {
      const z = (i / nz) * L;
      const pr = surf.principal(z);
      for (let j = 0; j <= nt; j++) {
        const f = surf.frame(z, (j / nt) * 2 * Math.PI);
        pos.set(f.p, 3 * v);
        nor.set(f.n, 3 * v);
        this.K[v] = pr.K;
        this.H[v] = pr.H;
        v++;
      }
    }
    const idx = [];
    for (let i = 0; i < nz; i++) {
      for (let j = 0; j < nt; j++) {
        const a = i * (nt + 1) + j, b = a + nt + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // Winding (a, a+1, b): (S_θ × S_z) points along the outward normal → front faces outside.
    geo.setIndex(idx);
    this.geometry = geo;

    this.metal = new THREE.MeshStandardMaterial({
      color: 0x9aa1a9,
      metalness: 0.9,
      roughness: 0.32,
    });
    this.painted = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.05,
      roughness: 0.6,
    });
    this.flat = new THREE.MeshStandardMaterial({
      color: opts.flatColor ?? DEFAULT_FLAT_COLOR,
      metalness: 0,
      roughness: 0.85,
    });
    this.mesh = new THREE.Mesh(geo, this.metal);
    this.group.add(this.mesh);
    /** Value ranges of K and H over the mandrel, and their scale specs. */
    this.values = { K: minMax(this.K), H: minMax(this.H) };
    this.scales = {
      K: { mode: "auto", ...opts.scales?.K },
      H: { mode: "auto", ...opts.scales?.H },
    };

    // End caps (flat discs) and a support shaft continuing upstream from the trailing end.
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x5d636b,
      metalness: 0.85,
      roughness: 0.4,
    });
    for (const z of [0, L]) {
      const r = sim.profile.evaluate(z).r;
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r, 64), capMat);
      cap.position.z = z;
      if (z === 0) cap.rotation.y = Math.PI; // leading cap faces −z_M
      this.group.add(cap);
    }
    const rShaft = Math.min(sim.profile.rMin * 0.35, 0.012);
    const shaftLen = 1.2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rShaft, rShaft, shaftLen, 24), capMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = L + shaftLen / 2;
    this.group.add(shaft);

    /** Colour mode: "metal" | "K" | "H". */
    this.mode = "metal";
    /** Colour-bar description of the current mode (null for metal). */
    this.legend = null;
  }

  /**
   * Switches the colouring. @param {"metal"|"flat"|"K"|"H"} mode
   */
  setColorMode(mode) {
    this.mode = mode;
    if (mode === "metal" || mode === "flat") {
      this.mesh.material = mode === "metal" ? this.metal : this.flat;
      this.legend = null;
      return;
    }
    this.paint();
  }

  /** Colour of the flat (matte) mode ("#rrggbb", sRGB). */
  setFlatColor(hex) {
    this.flat.color.set(hex);
  }

  /** Sets the scale of colouring "K" or "H" (repaints if it is shown). */
  setScale(key, spec) {
    this.scales[key] = { ...this.scales[key], ...spec };
    if (key === this.mode) this.paint();
  }

  /** Scale information for the controls (null for metal / flat). */
  scaleInfo(key = this.mode) {
    if (!CURVATURE[key]) return null;
    const auto = mandrelRange({ mode: "auto" }, this.values[key]);
    const range = mandrelRange(this.scales[key], this.values[key]);
    return {
      spec: this.scales[key],
      range,
      full: auto,
      bounds: sliderBounds(auto, range),
      unit: CURVATURE[key].unit,
    };
  }

  /** Paints K or H with the diverging scale: t = pivot(v; min, mid, max), colour = div(2t − 1). */
  paint() {
    const key = this.mode, data = key === "K" ? this.K : this.H;
    const R = mandrelRange(this.scales[key], this.values[key]);
    const col = this.geometry.getAttribute("color");
    for (let i = 0; i < data.length; i++) {
      const c = diverging(2 * pivotScale(data[i], R.min, R.mid, R.max) - 1).map(srgbToLinear);
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
    this.mesh.material = this.painted;
    const what = { auto: "range of this mandrel", custom: "custom range" }[this.scales[key].mode];
    this.legend = {
      title: `${CURVATURE[key].label} · ${what}`,
      unit: CURVATURE[key].unit,
      kind: "diverging",
      min: R.min,
      mid: R.mid,
      max: R.max,
    };
  }

  /** Places the mandrel at simulation time t (pose → group matrix). */
  update(t) {
    const pose = this.sim.pose, R = pose.R, o = pose.origin(t);
    // deno-fmt-ignore
    this.group.matrix.set(
      R[0][0], R[0][1], R[0][2], o[0],
      R[1][0], R[1][1], R[1][2], o[1],
      R[2][0], R[2][1], R[2][2], o[2],
      0, 0, 0, 1,
    );
    this.group.matrixWorldNeedsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.metal.dispose();
    this.painted.dispose();
    this.flat.dispose();
  }
}

/** Min and max of a typed array. */
function minMax(a) {
  let min = Infinity, max = -Infinity;
  for (const x of a) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}
