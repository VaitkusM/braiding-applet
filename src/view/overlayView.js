/**
 * @file overlayView.js — analytic overlays in the MANDREL frame (child of the mandrel group):
 *  - the fell line (closed curve through all current fell points),
 *  - the Darboux frame (t, n, b) of the selected yarn at its fell point,
 *  - the principal directions (meridian m, parallel e) there,
 *  - the geodesic that leaves the fell point in the yarn's current direction (what the yarn would
 *    follow on a frictionless mandrel), dashed, in the geodesic series colour.
 * Vector labels are HTML elements positioned by projecting the arrow tips every frame.
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { integrateGeodesic } from "../core/geodesic.js";
import { SERIES } from "./colormaps.js";

/** @typedef {import("../core/simulation.js").Simulation} Simulation */

export class OverlayView {
  /**
   * @param {Simulation} sim
   * @param {HTMLElement} labelsHost element for the HTML vector labels
   */
  constructor(sim, labelsHost) {
    this.sim = sim;
    this.group = new THREE.Group();
    this.labelsHost = labelsHost;

    // Fell line.
    this.fellMat = new LineMaterial({
      color: 0xffffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.75,
    });
    this.fellGeo = new LineGeometry();
    this.fellGeo.setPositions(new Float32Array((sim.yarns.length + 1) * 3));
    this.fellLine = new Line2(this.fellGeo, this.fellMat);
    this.fellLine.frustumCulled = false;
    this.group.add(this.fellLine);

    // Darboux frame and principal directions.
    const mk = (color) =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        0.05,
        color,
        0.012,
        0.007,
      );
    this.arrows = { t: mk(0xffffff), n: mk(0x9ec5f4), b: mk(0xc3c2b7) };
    this.darboux = new THREE.Group();
    Object.values(this.arrows).forEach((a) => this.darboux.add(a));
    this.group.add(this.darboux);
    this.principal = new THREE.Group();
    this.principalArrows = { m: mk(0x898781), e: mk(0x898781) };
    Object.values(this.principalArrows).forEach((a) => this.principal.add(a));
    this.group.add(this.principal);

    // Geodesic.
    this.geoMat = new LineMaterial({
      color: SERIES.geodesic,
      linewidth: 2.2,
      dashed: true,
      dashSize: 0.008,
      gapSize: 0.005,
    });
    this.geoLine = null;
    this.geoTime = -Infinity;

    this.labels = {};
    for (const key of ["t", "n", "b", "κm", "κp"]) {
      const el = document.createElement("div");
      el.className = "vec-label";
      el.textContent = key;
      labelsHost.appendChild(el);
      this.labels[key] = el;
    }
    this.show = { fellLine: true, darboux: true, principal: false, geodesic: true };
    this.selected = 0;
    this.clairaut = NaN;
  }

  /** Visibility toggles: {fellLine, darboux, principal, geodesic}. */
  setVisibility(show) {
    Object.assign(this.show, show);
    this.fellLine.visible = this.show.fellLine;
    this.darboux.visible = this.show.darboux;
    this.principal.visible = this.show.principal;
    if (this.geoLine) this.geoLine.visible = this.show.geodesic;
  }

  setSelected(k) {
    this.selected = k;
    this.geoTime = -Infinity;
  }

  /**
   * Updates overlays from the simulation. `lift` = height above the surface for drawn curves [m].
   * @param {{camera:THREE.Camera, project:(v:THREE.Vector3)=>{x:number,y:number,visible:boolean}}} view
   * @param {number} lift
   */
  update(view, lift) {
    const sim = this.sim, surf = sim.surface;
    // Fell line, sorted by azimuth around the mandrel axis.
    const pts = sim.fell.map((p) => ({ p, a: Math.atan2(p[1], p[0]) })).sort((u, v) => u.a - v.a);
    const arr = new Float32Array((pts.length + 1) * 3);
    pts.forEach(({ p }, i) => {
      const s = 1 + lift / Math.max(1e-6, Math.hypot(p[0], p[1]));
      arr.set([p[0] * s, p[1] * s, p[2]], 3 * i);
    });
    arr.set(arr.subarray(0, 3), 3 * pts.length);
    const buf = this.fellGeo.attributes.instanceStart.data;
    // LineGeometry stores segments (start, end) pairs.
    const segs = buf.array;
    for (let i = 0; i < pts.length; i++) {
      segs.set(arr.subarray(3 * i, 3 * i + 6), 6 * i);
    }
    buf.needsUpdate = true;

    // Selected yarn: Darboux frame at the fell point.
    const y = sim.yarns[this.selected];
    const i = y.last;
    const f = surf.frame(y.zp[i], y.th[i]);
    const t = new THREE.Vector3(y.tx[i], y.ty[i], y.tz[i]);
    const n = new THREE.Vector3(y.nx[i], y.ny[i], y.nz[i]);
    const b = new THREE.Vector3().crossVectors(n, t).normalize();
    const origin = new THREE.Vector3(...f.p).addScaledVector(n, lift);
    const len = Math.max(0.025, 0.9 * f.r);
    for (const [key, dir] of [["t", t], ["n", n], ["b", b]]) {
      const a = this.arrows[key];
      a.position.copy(origin);
      a.setDirection(dir);
      a.setLength(len, 0.18 * len, 0.1 * len);
    }
    const m = new THREE.Vector3(...f.m), e = new THREE.Vector3(...f.e);
    for (const [key, dir] of [["m", m], ["e", e]]) {
      const a = this.principalArrows[key];
      a.position.copy(origin);
      a.setDirection(dir);
      a.setLength(0.7 * len, 0.15 * len, 0.08 * len);
    }
    this.clairaut = f.r * Math.sin(y.alpha[i]);

    // Geodesic (recomputed a few times per second). A yarn still at its tie point has no
    // direction yet: hide the previous yarn's geodesic.
    if (this.geoLine && (i === 0 || !Number.isFinite(y.alpha[i]))) this.geoLine.visible = false;
    if (
      this.show.geodesic && sim.time - this.geoTime > 0.2 && Number.isFinite(y.alpha[i]) && i > 0
    ) {
      this.geoTime = sim.time;
      const g = integrateGeodesic(sim.profile, {
        z0: y.zp[i],
        th0: y.th[i],
        alpha0: y.alpha[i],
        ds: 1e-3,
        maxLength: Math.min(0.8, 12 * f.r),
      });
      if (g.z.length > 2) {
        const gp = [];
        for (let k = 0; k < g.z.length; k++) {
          const fr = surf.frame(g.z[k], g.th[k]);
          gp.push(fr.p[0] + lift * fr.n[0], fr.p[1] + lift * fr.n[1], fr.p[2] + lift * fr.n[2]);
        }
        if (this.geoLine) {
          this.group.remove(this.geoLine);
          this.geoLine.geometry.dispose();
        }
        const geo = new LineGeometry();
        geo.setPositions(gp);
        this.geoLine = new Line2(geo, this.geoMat);
        this.geoLine.computeLineDistances();
        this.geoLine.frustumCulled = false;
        this.geoLine.visible = this.show.geodesic;
        this.group.add(this.geoLine);
      }
    }

    // HTML labels at the arrow tips (world positions via the group's matrixWorld).
    const mw = this.group.matrixWorld;
    const place = (key, tip, visible) => {
      const el = this.labels[key];
      if (!visible) {
        el.hidden = true;
        return;
      }
      const s = view.project(tip.clone().applyMatrix4(mw));
      el.hidden = !s.visible;
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
    };
    const tipAt = (dir, l) => origin.clone().addScaledVector(dir, l * 1.12);
    place("t", tipAt(t, len), this.show.darboux);
    place("n", tipAt(n, len), this.show.darboux);
    place("b", tipAt(b, len), this.show.darboux);
    place("κm", tipAt(m, 0.7 * len), this.show.principal);
    place("κp", tipAt(e, 0.7 * len), this.show.principal);
  }

  setResolution(w, h) {
    this.fellMat.resolution.set(w, h);
    this.geoMat.resolution.set(w, h);
  }

  dispose() {
    this.fellGeo.dispose();
    this.fellMat.dispose();
    this.geoMat.dispose();
    if (this.geoLine) this.geoLine.geometry.dispose();
    for (const el of Object.values(this.labels)) el.remove();
  }
}
