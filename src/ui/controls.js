/**
 * @file controls.js — the lil-gui parameter panel.
 *
 * Two objects are edited:
 *  - `params`  (simulation parameters, src/params.js): any change triggers `onParams()`, and the app
 *              restarts the run (debounced);
 *  - `display` (view-only settings): changes call `onDisplay(key)` and never restart the run.
 * Colour-scale controls edit small proxy objects (`scaleUI.yarn`, `scaleUI.mandrel`); the app owns
 * the per-colouring scale specs and pushes the current state back with `syncScales()`.
 */

import GUI from "lil-gui";
import { allowedCarrierCounts, PATTERNS } from "../core/machine.js";
import { MANDREL_LABELS, patternM, SHAPE_RANGES } from "../params.js";
import { YARN_COLOR_MODES, YARN_STYLES } from "../view/yarnView.js";
import { MANDREL_COLOR_MODES } from "../view/mandrelView.js";
import { MANDREL_SCALE_MODES, YARN_SCALE_MODES } from "../view/scales.js";

/** Inverts a {key: label} map into the {label: key} form lil-gui dropdowns expect. */
const options = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

const SHAPE_LABELS = {
  length: "length [mm]",
  radius: "radius [mm]",
  r0: "leading radius [mm]",
  r1: "trailing radius [mm]",
  zStart: "transition start [mm]",
  zEnd: "transition end [mm]",
  amplitude: "bulge height [mm]",
  depth: "waist depth [mm]",
  center: "centre z [mm]",
  halfWidth: "half width [mm]",
};

export class Controls {
  /**
   * @param {HTMLElement} host
   * @param {object} params     simulation parameters (mutated in place)
   * @param {object} display    display settings (mutated in place)
   * @param {{onParams:()=>void, onDisplay:(key:string)=>void, onAction:(name:string)=>void}} cb
   */
  constructor(host, params, display, cb) {
    this.params = params;
    this.display = display;
    this.cb = cb;
    this.gui = new GUI({ container: host, title: "Parameters", width: 290 });
    this.helper = { targetAlphaDeg: 45 };
    this.build();
    if (globalThis.innerWidth < 900) this.gui.close();
  }

  build() {
    const p = this.params, d = this.display, gui = this.gui, change = () => this.cb.onParams();

    // ── Machine ──
    const fm = gui.addFolder("Machine");
    const patterns = Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [v.label, k]));
    fm.add(p, "pattern", patterns).name("braid pattern").onChange(() => {
      this.rebuildCarriers();
      change();
    });
    this.fm = fm;
    this.rebuildCarriers();
    fm.add(p, "rpm", 0.5, 30, 0.1).name("carrier speed [rpm]").onFinishChange(change);
    fm.add(p, "takeUpMm", 1, 200, 0.5).name("take-up speed [mm/s]").onFinishChange(change);
    fm.add(this.helper, "targetAlphaDeg", 5, 80, 1).name("target α [°]");
    fm.add({ go: () => this.cb.onAction("takeUpForAngle") }, "go").name(
      "↳ set take-up for target α",
    );
    fm.add(p, "ringRadiusMm", 40, 500, 1).name("guide-ring radius [mm]").onFinishChange(change);
    fm.add(p, "triaxial").name("triaxial (axial yarns)").onChange(change);

    // ── Mandrel ──
    const fd = gui.addFolder("Mandrel");
    const mandrels = Object.fromEntries(Object.entries(MANDREL_LABELS).map(([k, v]) => [v, k]));
    fd.add(p, "mandrel", mandrels).name("shape").onChange(() => {
      this.rebuildShape();
      change();
    });
    this.fd = fd;
    this.shapeFolder = null;
    this.rebuildShape();
    fd.add(p, "offsetXMm", -80, 80, 0.5).name("axis offset x [mm]").onFinishChange(change);
    fd.add(p, "offsetYMm", -80, 80, 0.5).name("axis offset y [mm]").onFinishChange(change);
    fd.add(p, "tiltDeg", -25, 25, 0.25).name("axis tilt [°]").onFinishChange(change);
    fd.add(p, "tieZMm", 0, 500, 1).name("tie ring at z [mm]").onFinishChange(change);
    fd.add(p, "initialConvergenceMm", 5, 500, 1).name("initial convergence [mm]").onFinishChange(
      change,
    );

    // ── Yarn ──
    const fy = gui.addFolder("Yarn").close();
    fy.add(p, "yarnWidthMm", 0.5, 25, 0.1).name("width w [mm]").onFinishChange(change);
    fy.add(p, "yarnThicknessMm", 0.05, 3, 0.01).name("thickness [mm]").onFinishChange(change);
    fy.add(p, "axialWidthMm", 0.5, 25, 0.1).name("axial yarn width [mm]").onFinishChange(change);
    fy.add(p, "tensionN", 0.1, 100, 0.1).name("tension T [N]").onFinishChange(change);
    fy.add(p, "friction", 0, 1.5, 0.01).name("friction μ").onFinishChange(change);

    // ── Display ──
    const fv = gui.addFolder("Display").close();
    const yarnModes = Object.fromEntries(Object.entries(YARN_COLOR_MODES).map(([k, v]) => [v, k]));
    const styles = Object.fromEntries(Object.entries(YARN_STYLES).map(([k, v]) => [v, k]));
    fv.add(d, "yarnStyle", styles).name("yarn drawing").onChange(() =>
      this.cb.onDisplay("yarnStyle")
    );
    fv.add(d, "yarnColor", yarnModes).name("yarn colour").onChange(() =>
      this.cb.onDisplay("yarnColor")
    );
    // Scale of the yarn colouring (shown for braid angle, slip, κn, κg, pressure).
    this.scaleUI = {
      yarn: { mode: "data", min: 0, mid: 0.5, max: 1 },
      mandrel: { mode: "auto", min: 0, mid: 0.5, max: 1 },
    };
    this.scaleCtrls = {
      yarn: this.addScaleControls(fv, "yarn", "yarn colour scale", YARN_SCALE_MODES),
    };
    fv.add(d, "mandrelColor", options(MANDREL_COLOR_MODES)).name("mandrel colour").onChange(() =>
      this.cb.onDisplay("mandrelColor")
    );
    this.flatColorCtrl = fv.addColor(d, "mandrelFlatColor").name("flat colour").onChange(() =>
      this.cb.onDisplay("mandrelFlatColor")
    );
    this.scaleCtrls.mandrel = this.addScaleControls(
      fv,
      "mandrel",
      "mandrel colour scale",
      MANDREL_SCALE_MODES,
    );
    this.syncScales(null, null); // hidden until the app reports the current colourings
    fv.add(d, "thicknessScale", 1, 8, 0.5).name("thickness exaggeration").onFinishChange(() =>
      this.cb.onDisplay("thicknessScale")
    );
    this.selCtrl = fv.add(d, "selectedYarn", 0, p.carriers - 1, 1).name("selected yarn").onChange(
      () => this.cb.onDisplay("selectedYarn"),
    );
    for (
      const [key, label] of [
        ["showMachine", "machine"],
        ["showFreeYarns", "free yarns"],
        ["showFellLine", "fell line"],
        ["showDarboux", "Darboux frame (t, n, b)"],
        ["showPrincipal", "principal directions"],
        ["showGeodesic", "geodesic from fell point"],
      ]
    ) fv.add(d, key).name(label).onChange(() => this.cb.onDisplay(key));

    // ── Numerics ──
    const fn = gui.addFolder("Numerics").close();
    fn.add(p, "dsMaxMm", 0.1, 3, 0.05).name("max step Δs [mm]").onFinishChange(change);
    fn.add(p, "dphiMaxDeg", 0.1, 3, 0.05).name("max rotation Δφ [°]").onFinishChange(change);
    fn.add(p, "turnMaxDeg", 0.2, 5, 0.1).name("max turn per step [°]").onFinishChange(change);
  }

  /** Shows the α scale selector in braid-angle colouring, and the sliders for a custom range. */
  /**
   * Adds a scale selector and min / mid / max sliders for `target` ("yarn" | "mandrel").
   * Slider limits, steps and unit labels are set later by `syncScales()`.
   */
  addScaleControls(folder, target, label, modes) {
    const ui = this.scaleUI[target], ev = (what) => () => this.cb.onScale(target, what);
    const c = { mode: folder.add(ui, "mode", options(modes)).name(label).onChange(ev("mode")) };
    for (const k of ["min", "mid", "max"]) {
      c[k] = folder.add(ui, k, 0, 1, 0.01).name(`↳ ${k}`).onChange(ev(k));
    }
    return c;
  }

  /**
   * Shows the scale controls of the current colourings and loads their state.
   * @param {object|null} yarn   scale info of the yarn colouring (YarnView.scaleInfo) or null
   * @param {object|null} mandrel scale info of the mandrel colouring or null
   */
  syncScales(yarn, mandrel) {
    for (const [target, info] of [["yarn", yarn], ["mandrel", mandrel]]) {
      const c = this.scaleCtrls[target], ui = this.scaleUI[target];
      c.mode.show(!!info);
      const custom = !!info && info.spec.mode === "custom";
      if (info) {
        ui.mode = info.spec.mode;
        const b = info.bounds;
        for (const k of ["min", "mid", "max"]) {
          ui[k] = Math.min(b.hi, Math.max(b.lo, info.range[k]));
          c[k].min(b.lo).max(b.hi).step(b.step).name(`↳ ${k} [${info.unit}]`);
        }
      }
      for (const k of ["mode", "min", "mid", "max"]) c[k].updateDisplay();
      for (const k of ["min", "mid", "max"]) c[k].show(custom);
    }
    this.flatColorCtrl.show(this.display.mandrelColor === "flat");
  }

  /** Carrier-count dropdown restricted to counts compatible with the pattern (2m | N). */
  rebuildCarriers() {
    const p = this.params;
    const counts = allowedCarrierCounts(patternM(p.pattern)).filter((n) => n >= 8);
    if (!counts.includes(p.carriers)) {
      p.carriers = counts.reduce((
        a,
        b,
      ) => (Math.abs(b - p.carriers) < Math.abs(a - p.carriers) ? b : a));
    }
    const opts = counts.filter((n) => n <= 48 || n % 12 === 0 || n % 16 === 0);
    if (!opts.includes(p.carriers)) opts.push(p.carriers);
    opts.sort((a, b) => a - b);
    if (this.carrierCtrl) this.carrierCtrl.destroy();
    this.carrierCtrl = this.fm.add(p, "carriers", opts).name("carriers N").onChange(() =>
      this.cb.onParams()
    );
    // Keep it right below the pattern selector.
    const el = this.carrierCtrl.domElement;
    el.parentElement.insertBefore(el, el.parentElement.children[1] ?? null);
  }

  /** Shape sub-folder for the selected mandrel preset. */
  rebuildShape() {
    const p = this.params;
    if (this.shapeFolder) this.shapeFolder.destroy();
    const s = p.shapes[p.mandrel];
    const f = this.fd.addFolder("shape parameters");
    for (const key of Object.keys(s)) {
      if (key === "points") continue;
      const [min, max, step] = SHAPE_RANGES[key];
      f.add(s, key, min, max, step).name(SHAPE_LABELS[key]).onFinishChange(() =>
        this.cb.onParams()
      );
    }
    if (p.mandrel === "custom") {
      f.add({ edit: () => this.cb.onAction("editProfile") }, "edit").name("✎ edit profile curve…");
    } else {
      f.add({ conv: () => this.cb.onAction("toCustom") }, "conv").name("✎ copy to custom profile…");
    }
    this.shapeFolder = f;
    // Place it right below the shape selector.
    const el = f.domElement, parent = el.parentElement;
    parent.insertBefore(el, parent.children[1] ?? null);
  }

  /** Re-reads all values (after programmatic changes) and updates dependent ranges. */
  refresh() {
    this.selCtrl.max(this.params.carriers - 1);
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
  }

  /** Target braid angle of the helper [°]. */
  get targetAlphaDeg() {
    return this.helper.targetAlphaDeg;
  }
}
