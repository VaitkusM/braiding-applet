/**
 * @file mandrelView.js — the mandrel: a lathe mesh built in the MANDREL frame, optionally coloured
 * by Gaussian (K) or mean (H) curvature, plus end caps and a support shaft. Its parent group carries
 * the mandrel pose, so every child (yarns, overlays) moves with the mandrel.
 */

import * as THREE from "three";
import { diverging, hexToRgb, srgbToLinear } from "./colormaps.js";

/** @typedef {import("../core/simulation.js").Simulation} Simulation */

export class MandrelView {
  /** @param {Simulation} sim */
  constructor(sim) {
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
    this.mesh = new THREE.Mesh(geo, this.metal);
    this.group.add(this.mesh);

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
   * Switches the colouring. K and H use a diverging scale centred at 0, symmetric in the
   * largest magnitude on this mandrel.
   * @param {"metal"|"K"|"H"} mode
   */
  setColorMode(mode) {
    this.mode = mode;
    if (mode === "metal") {
      this.mesh.material = this.metal;
      this.legend = null;
      return;
    }
    const data = mode === "K" ? this.K : this.H;
    let max = 0;
    for (const x of data) max = Math.max(max, Math.abs(x));
    const scale = max > 0 ? max : 1;
    const col = this.geometry.getAttribute("color");
    const zero = hexToRgb("#c9c8c2").map(srgbToLinear);
    for (let i = 0; i < data.length; i++) {
      const c = max > 0 ? diverging(data[i] / scale).map(srgbToLinear) : zero;
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
    this.mesh.material = this.painted;
    this.legend = mode === "K"
      ? { title: "Gaussian curvature K", unit: "1/m²", kind: "diverging", min: -scale, max: scale }
      : {
        title: "Mean curvature H (convex > 0)",
        unit: "1/m",
        kind: "diverging",
        min: -scale,
        max: scale,
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
  }
}
