/**
 * @file profileEditor.js — the "Profile" tab: the mandrel silhouette r(z), coloured by Gaussian
 * curvature K, with draggable control points for the custom (natural cubic spline) profile.
 *
 * Interaction (custom profile): drag a point to move it; double-click empty space to add a point;
 * select a point and press "Remove point" (or right-click it) to delete it. The end points stay at
 * the mandrel ends (only their radius changes). Control points are stored as [u, r] with
 * u = z / length ∈ [0, 1] and r in mm (params.shapes.custom.points).
 * The run restarts when a drag ends (not during the drag).
 */

import { makeProfile, validateProfile } from "../core/profiles.js";
import { profileSpec } from "../params.js";
import { curvatureMap, INK, pivotScale, rgbToHex, STATUS } from "../view/colormaps.js";
import { zeroPivotRange } from "../view/scales.js";

const R_MIN_MM = 2, R_MAX_MM = 200;

export class ProfileEditor {
  /**
   * @param {HTMLElement} host
   * @param {object} params    simulation parameters (custom points are edited in place)
   * @param {()=>void} onChange called after an edit is complete
   * @param {{toCustom:()=>void}} hooks
   */
  constructor(host, params, onChange, hooks) {
    this.host = host;
    this.params = params;
    this.onChange = onChange;
    this.hooks = hooks;
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    host.appendChild(el("h2", "", "Mandrel profile r(z)"));
    this.info = el("p", "note");
    host.appendChild(this.info);
    const wrap = el("div", "profile-canvas-wrap");
    this.canvas = el("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Mandrel profile editor");
    wrap.appendChild(this.canvas);
    host.appendChild(wrap);
    this.wrap = wrap;

    const row = el("div", "row");
    this.btnCustom = el("button", "btn small", "Edit as custom profile");
    this.btnCustom.type = "button";
    this.btnCustom.addEventListener("click", () => this.hooks.toCustom());
    this.btnRemove = el("button", "btn small", "Remove point");
    this.btnRemove.type = "button";
    this.btnRemove.addEventListener("click", () => this.removeSelected());
    row.append(this.btnCustom, this.btnRemove);
    host.appendChild(row);
    this.msg = el("p", "note");
    host.appendChild(this.msg);

    host.appendChild(el("h3", "", "Colour: Gaussian curvature K"));
    const legend = el("p", "note");
    legend.textContent = "Blue: K < 0 (saddle-like, e.g. a waist — yarns may bridge). " +
      "Green: K = 0 (cylinder, cone). Red: K > 0 (bulge, dome-like). Each sign is scaled by its " +
      "largest value on this profile (as the mandrel's curvature map in the 3D view). " +
      "The vertical line marks the current fell line.";
    host.appendChild(legend);

    this.drag = -1;
    this.selected = -1;
    this.fellZ = NaN;
    this.canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerup", () => this.onUp());
    this.canvas.addEventListener("pointercancel", () => this.onUp());
    this.canvas.addEventListener("dblclick", (e) => this.onDouble(e));
    this.canvas.addEventListener("contextmenu", (e) => {
      const i = this.hit(e);
      if (i >= 0) {
        e.preventDefault();
        this.selected = i;
        this.removeSelected();
      }
    });
    new ResizeObserver(() => this.draw()).observe(wrap);
  }

  get isCustom() {
    return this.params.mandrel === "custom";
  }

  get points() {
    return this.params.shapes.custom.points;
  }

  reset(sim) {
    this.sim = sim;
    this.selected = -1;
    this.draw();
  }

  show(sim) {
    this.sim = sim;
    this.draw();
  }

  update(sim) {
    this.sim = sim;
    const z = sim.solvers.reduce((a, s) => a + s.z, 0) / sim.solvers.length;
    if (!(Math.abs(z - this.fellZ) <= 1e-3)) {
      this.fellZ = z;
      this.draw();
    }
  }

  /** Current profile built from the parameters (may be invalid while editing). */
  profile() {
    try {
      return makeProfile(profileSpec(this.params));
    } catch {
      return null;
    }
  }

  /** Canvas geometry: x ↔ z [mm], y ↔ r [mm] (mirrored silhouette). */
  layout() {
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
    const L = this.params.shapes[this.params.mandrel].length;
    let rMax = 10;
    const prof = this.profile();
    if (prof) rMax = Math.max(rMax, prof.rMax * 1e3);
    if (this.isCustom) { for (const [, r] of this.points) rMax = Math.max(rMax, r); }
    rMax *= 1.25;
    const m = { l: 44, r: 14, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    return {
      W,
      H,
      m,
      pw,
      ph,
      L,
      rMax,
      X: (z) => m.l + (z / L) * pw,
      Y: (r) => m.t + ph / 2 - (r / rMax) * (ph / 2),
      Z: (px) => ((px - m.l) / pw) * L,
      R: (py) => ((m.t + ph / 2 - py) / (ph / 2)) * rMax,
    };
  }

  draw() {
    const c = this.canvas, dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const lay = this.layout();
    if (!lay.W || !lay.H) return;
    c.width = Math.round(lay.W * dpr);
    c.height = Math.round(lay.H * dpr);
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, lay.W, lay.H);
    const { m, pw, ph, L, X, Y } = lay;
    const prof = this.profile();

    this.btnCustom.hidden = this.isCustom;
    this.btnRemove.hidden = !this.isCustom;
    this.btnRemove.disabled = this.selected <= 0 ||
      this.selected >= (this.isCustom ? this.points.length - 1 : 0);
    this.info.textContent = this.isCustom
      ? "Drag points to reshape the mandrel. Double-click to add a point; right-click a point (or select it and press “Remove point”) to delete it. Radial scale is exaggerated."
      : "Preset profile (read-only). Use “Edit as custom profile” to start editing a copy. Radial scale is exaggerated.";

    // Axes.
    g.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.fillStyle = INK.muted;
    g.strokeStyle = INK.grid;
    g.lineWidth = 1;
    g.textAlign = "center";
    g.textBaseline = "top";
    const zStep = L > 800 ? 200 : 100;
    for (let z = 0; z <= L + 1e-9; z += zStep) {
      g.beginPath();
      g.moveTo(Math.round(X(z)) + 0.5, m.t);
      g.lineTo(Math.round(X(z)) + 0.5, m.t + ph);
      g.stroke();
      g.fillText(String(z), X(z), m.t + ph + 5);
    }
    g.textAlign = "right";
    g.fillText("z [mm]", m.l + pw, m.t + ph + 15);
    g.textBaseline = "middle";
    const rStep = lay.rMax > 120 ? 50 : lay.rMax > 60 ? 20 : 10;
    for (let r = -Math.floor(lay.rMax / rStep) * rStep; r <= lay.rMax; r += rStep) {
      g.fillText(String(Math.abs(r)), m.l - 6, Y(r));
    }
    g.save();
    g.translate(10, m.t + ph / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = "center";
    g.fillText("r [mm]", 0, 0);
    g.restore();
    g.strokeStyle = INK.axis;
    g.beginPath();
    g.moveTo(m.l, Math.round(Y(0)) + 0.5);
    g.lineTo(m.l + pw, Math.round(Y(0)) + 0.5);
    g.stroke();

    const msgs = [];
    if (prof) {
      // Silhouette.
      const n = 400;
      g.fillStyle = "rgba(195, 194, 183, 0.10)";
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const z = (i / n) * prof.length;
        const r = prof.evaluate(z).r * 1e3;
        if (i === 0) g.moveTo(X(z * 1e3), Y(r));
        else g.lineTo(X(z * 1e3), Y(r));
      }
      for (let i = n; i >= 0; i--) {
        const z = (i / n) * prof.length;
        g.lineTo(X(z * 1e3), Y(-prof.evaluate(z).r * 1e3));
      }
      g.closePath();
      g.fill();
      // Outline coloured by K with the curvature map (as the mandrel in the 3D view: green = 0,
      // each sign scaled by its own extent on this profile).
      const Ks = [];
      let kLo = Infinity, kHi = -Infinity;
      for (let i = 0; i <= n; i++) {
        const e = prof.evaluate((i / n) * prof.length);
        const K = -e.d2r / (e.r * (1 + e.dr * e.dr) ** 2);
        Ks.push(K);
        kLo = Math.min(kLo, K);
        kHi = Math.max(kHi, K);
      }
      const KR = zeroPivotRange(kLo, kHi, 0.02 * Math.max(Math.abs(kLo), Math.abs(kHi)));
      g.lineWidth = 3;
      g.lineCap = "round";
      for (const sign of [1, -1]) {
        for (let i = 0; i < n; i++) {
          const z0 = (i / n) * prof.length, z1 = ((i + 1) / n) * prof.length;
          g.strokeStyle = rgbToHex(curvatureMap(pivotScale(Ks[i], KR.min, KR.mid, KR.max)));
          g.beginPath();
          g.moveTo(X(z0 * 1e3), Y(sign * prof.evaluate(z0).r * 1e3));
          g.lineTo(X(z1 * 1e3), Y(sign * prof.evaluate(z1).r * 1e3));
          g.stroke();
        }
      }
      const v = validateProfile(prof);
      msgs.push(...v.messages);
    } else {
      msgs.push("The control points do not define a valid profile (they must be ordered in z).");
    }

    // Fell line.
    if (Number.isFinite(this.fellZ)) {
      const px = Math.round(X(this.fellZ * 1e3)) + 0.5;
      g.strokeStyle = INK.secondary;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, m.t);
      g.lineTo(px, m.t + ph);
      g.stroke();
      g.fillStyle = INK.secondary;
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText("fell line", px + 4, m.t + 2);
    }

    // Control points.
    if (this.isCustom) {
      this.points.forEach(([u, r], i) => {
        const px = X(u * L), py = Y(r);
        g.beginPath();
        g.arc(px, py, i === this.selected ? 7 : 5.5, 0, 2 * Math.PI);
        g.fillStyle = i === 0 || i === this.points.length - 1 ? INK.muted : INK.primary;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = INK.surface;
        g.stroke();
      });
    }
    this.msg.textContent = msgs.length ? `⚠ Not admissible: ${msgs.join(" ")}` : "";
    this.msg.style.color = msgs.length ? STATUS.critical : "";
  }

  /** Index of the control point under the pointer (within 12 px), or −1. */
  hit(e) {
    if (!this.isCustom) return -1;
    const r = this.canvas.getBoundingClientRect(), lay = this.layout();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bestD = 12;
    this.points.forEach(([u, rr], i) => {
      const d = Math.hypot(lay.X(u * lay.L) - x, lay.Y(rr) - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  onDown(e) {
    const i = this.hit(e);
    this.selected = i;
    if (i >= 0 && e.button === 0) {
      this.drag = i;
      this.dragStart = [...this.points[i]]; // to tell a real drag from a click
      this.canvas.setPointerCapture(e.pointerId);
    }
    this.draw();
  }

  onMove(e) {
    if (this.drag < 0) {
      this.canvas.style.cursor = this.hit(e) >= 0 ? "grab" : "default";
      return;
    }
    const r = this.canvas.getBoundingClientRect(), lay = this.layout();
    const pts = this.points, i = this.drag, last = pts.length - 1;
    let u = lay.Z(e.clientX - r.left) / lay.L;
    const rad = Math.min(R_MAX_MM, Math.max(R_MIN_MM, Math.abs(lay.R(e.clientY - r.top))));
    if (i === 0) u = 0;
    else if (i === last) u = 1;
    else u = Math.min(pts[i + 1][0] - 0.01, Math.max(pts[i - 1][0] + 0.01, u));
    pts[i] = [round(u, 4), round(rad, 1)];
    this.draw();
  }

  onUp() {
    if (this.drag < 0) return;
    const [u0, r0] = this.dragStart, [u1, r1] = this.points[this.drag];
    this.drag = -1;
    if (u0 !== u1 || r0 !== r1) this.onChange(); // a plain click selects without restarting
  }

  onDouble(e) {
    if (!this.isCustom || this.hit(e) >= 0) return;
    const r = this.canvas.getBoundingClientRect(), lay = this.layout();
    const u = lay.Z(e.clientX - r.left) / lay.L;
    if (!(u > 0.005 && u < 0.995)) return;
    const rad = Math.min(R_MAX_MM, Math.max(R_MIN_MM, Math.abs(lay.R(e.clientY - r.top))));
    const pts = this.points;
    const k = pts.findIndex((p) => p[0] > u);
    if (k <= 0) return;
    if (u - pts[k - 1][0] < 0.01 || pts[k][0] - u < 0.01) return;
    pts.splice(k, 0, [round(u, 4), round(rad, 1)]);
    this.selected = k;
    this.draw();
    this.onChange();
  }

  removeSelected() {
    const i = this.selected, pts = this.points;
    if (!this.isCustom || i <= 0 || i >= pts.length - 1 || pts.length <= 2) return;
    pts.splice(i, 1);
    this.selected = -1;
    this.draw();
    this.onChange();
  }
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
