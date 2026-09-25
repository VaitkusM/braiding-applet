/**
 * @file app.js — the application: owns the parameters, the Simulation and all views/panels, and
 * runs the animation loop.
 *
 * Data flow (one direction):
 *   params (UI units) ──validate/convert──▶ Simulation (pure core, SI) ──read-only──▶ views & panels
 * A parameter change rebuilds the Simulation (debounced) and every view; display settings only
 * reconfigure views. The loop advances the simulation by (wall-clock Δt × speed), time-sliced so
 * the UI stays responsive, then syncs the views and renders.
 */

import * as THREE from "three";
import { Simulation } from "./core/simulation.js";
import { quasiStaticConvergenceLength, takeUpForAngle } from "./core/analysis.js";
import {
  decodeParams,
  defaultParams,
  encodeParams,
  toSimConfig,
  validateParams,
} from "./params.js";
import { SceneView } from "./view/scene.js";
import { MandrelView } from "./view/mandrelView.js";
import { MachineView } from "./view/machineView.js";
import { YarnView } from "./view/yarnView.js";
import { OverlayView } from "./view/overlayView.js";
import { Controls } from "./ui/controls.js";
import { StatusBar } from "./ui/statusBar.js";
import { ColorBar } from "./ui/colorbar.js";
import { PlotPanel } from "./ui/plotPanel.js";
import { TheoryPanel } from "./ui/theoryPanel.js";
import { ProfileEditor } from "./ui/profileEditor.js";
import { AboutPanel } from "./ui/aboutPanel.js";

const DEG = Math.PI / 180;

export class App {
  /** @param {Document} doc */
  constructor(doc) {
    this.doc = doc;
    const fromHash = decodeParams(globalThis.location.hash.slice(1));
    this.params = fromHash ?? defaultParams();
    validateParams(this.params);
    this.display = {
      yarnColor: "family",
      mandrelColor: "metal",
      thicknessScale: 1.5,
      selectedYarn: 0,
      showMachine: true,
      showFreeYarns: true,
      showFellLine: true,
      showDarboux: true,
      showPrincipal: false,
      showGeodesic: true,
    };
    this.playing = true;
    this.speed = 2;
    this.finishing = false;
    this.errors = []; // runtime errors (exposed for the smoke test)

    this.view = new SceneView(doc.getElementById("canvas-host"));
    this.status = new StatusBar(doc);
    this.colorbar = new ColorBar(doc.getElementById("colorbar"));
    this.message = doc.getElementById("message");
    this.controls = new Controls(doc.getElementById("gui-host"), this.params, this.display, {
      onParams: () => this.scheduleRebuild(),
      onDisplay: (key) => this.applyDisplay(key),
      onAction: (name) => this.action(name),
    });
    this.panels = {
      plots: new PlotPanel(doc.getElementById("tab-plots"), {
        screenshot: () => this.view.screenshot(),
      }),
      theory: new TheoryPanel(doc.getElementById("tab-theory")),
      profile: new ProfileEditor(
        doc.getElementById("tab-profile"),
        this.params,
        () => this.onProfileEdited(),
        { toCustom: () => this.action("toCustom") },
      ),
      about: new AboutPanel(doc.getElementById("tab-about")),
    };
    this.activeTab = "plots";

    this.bindUI();
    this.rebuild();
    if (this.sim) this.view.setView("overview", this.viewBounds());
    this.lastPanelUpdate = 0;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ── Building / rebuilding ──────────────────────────────────────────────────────────────────

  /** Debounced rebuild after parameter edits. */
  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(), 250);
  }

  /** Validates the parameters and (re)creates the simulation and all views. */
  rebuild() {
    const v = validateParams(this.params);
    this.controls.refresh();
    if (v.errors.length) {
      this.showMessage(`Cannot start: ${v.errors.join(" ")}`, 0);
      return;
    }
    const notes = [...v.fixes, ...v.warnings];
    if (notes.length) this.showMessage(notes.join(" "), 6000);
    else this.hideMessage();

    this.disposeViews();
    this.sim = new Simulation(toSimConfig(this.params));
    this.finishing = false;
    const sim = this.sim;
    this.display.selectedYarn = Math.min(this.display.selectedYarn, sim.yarns.length - 1);

    this.mandrelView = new MandrelView(sim);
    this.yarnView = new YarnView(sim, {
      thicknessScale: this.display.thicknessScale,
      colorMode: this.display.yarnColor,
    });
    this.overlayView = new OverlayView(sim, this.doc.getElementById("labels-host"));
    this.machineView = new MachineView(sim);
    this.mandrelView.group.add(this.yarnView.group, this.overlayView.group);
    this.view.scene.add(this.mandrelView.group, this.machineView.group);
    const { w, h } = this.view.size;
    this.machineView.setResolution(w, h);
    this.overlayView.setResolution(w, h);
    for (const key of Object.keys(this.display)) this.applyDisplay(key, true);
    this.updateColorbar();
    for (const p of Object.values(this.panels)) p.reset?.(sim, this.display);
    this.syncViews();
    try {
      globalThis.history.replaceState(null, "", `#${encodeParams(this.params)}`);
    } catch { /* e.g. sandboxed iframes */ }
  }

  disposeViews() {
    for (const v of [this.mandrelView, this.yarnView, this.overlayView, this.machineView]) {
      v?.dispose();
    }
    if (this.mandrelView) this.view.scene.remove(this.mandrelView.group);
    if (this.machineView) this.view.scene.remove(this.machineView.group);
  }

  /** Characteristic scales for camera presets. */
  viewBounds() {
    const sim = this.sim, c = sim.config;
    const zTie = c.tieZ + 0.05;
    const h = quasiStaticConvergenceLength(sim.profile, zTie, c.omega, c.takeUp, c.ringRadius);
    return {
      fellZ: -Math.min(0.35, Math.max(0.04, Number.isFinite(h) ? h : 0.1)),
      radius: sim.profile.evaluate(zTie).r,
      ringRadius: c.ringRadius,
      trackRadius: sim.machine.trackRadius,
    };
  }

  // ── Display settings ───────────────────────────────────────────────────────────────────────

  /** Applies one display setting (or all, during a rebuild). */
  applyDisplay(key, silent = false) {
    const d = this.display;
    if (!this.sim) return;
    switch (key) {
      case "yarnColor":
        this.yarnView.setColorMode(d.yarnColor);
        break;
      case "mandrelColor":
        this.mandrelView.setColorMode(d.mandrelColor);
        break;
      case "thicknessScale":
        if (!silent) this.rebuildYarnView();
        break;
      case "selectedYarn":
        this.select(d.selectedYarn, silent);
        break;
      case "showMachine":
        this.machineView.group.visible = d.showMachine;
        break;
      case "showFreeYarns":
        this.machineView.setFreeYarnsVisible(d.showFreeYarns);
        break;
      default:
        this.overlayView.setVisibility({
          fellLine: d.showFellLine,
          darboux: d.showDarboux,
          principal: d.showPrincipal,
          geodesic: d.showGeodesic,
        });
    }
    if (!silent) this.updateColorbar();
  }

  /** Rebuilds only the yarn meshes (e.g. new thickness exaggeration). */
  rebuildYarnView() {
    this.mandrelView.group.remove(this.yarnView.group);
    this.yarnView.dispose();
    this.yarnView = new YarnView(this.sim, {
      thicknessScale: this.display.thicknessScale,
      colorMode: this.display.yarnColor,
    });
    this.yarnView.setSelected(this.display.selectedYarn);
    this.mandrelView.group.add(this.yarnView.group);
  }

  select(k, silent = false) {
    this.display.selectedYarn = k;
    this.yarnView.setSelected(k);
    this.overlayView.setSelected(k);
    if (!silent) {
      this.controls.refresh();
      for (const p of Object.values(this.panels)) p.onSelect?.(k);
    }
  }

  updateColorbar() {
    this.colorbar.render([this.yarnView?.legend(), this.mandrelView?.legend]);
  }

  // ── Actions from the controls ──────────────────────────────────────────────────────────────

  action(name) {
    const p = this.params;
    if (name === "takeUpForAngle") {
      const c = toSimConfig(p);
      const prof = this.sim?.profile;
      const e = prof ? prof.evaluate(c.tieZ) : { r: 0.04, dr: 0 };
      const v = takeUpForAngle(c.omega, e.r, this.controls.targetAlphaDeg * DEG) /
        Math.sqrt(1 + e.dr * e.dr);
      p.takeUpMm = Math.round(v * 1e4) / 10;
      this.controls.refresh();
      this.scheduleRebuild();
    } else if (name === "editProfile") {
      this.showTab("profile");
    } else if (name === "toCustom") {
      const prof = this.sim.profile, n = 9;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const z = (i / (n - 1)) * prof.length;
        pts.push([i / (n - 1), Math.round(prof.evaluate(z).r * 1e4) / 10]);
      }
      p.shapes.custom = { length: Math.round(prof.length * 1e3), points: pts };
      p.mandrel = "custom";
      this.controls.rebuildShape();
      this.controls.refresh();
      this.panels.profile.reset(this.sim, this.display);
      this.showTab("profile");
      this.scheduleRebuild();
    }
  }

  /** Called by the profile editor after the custom curve changed. */
  onProfileEdited() {
    if (this.params.mandrel !== "custom") {
      this.params.mandrel = "custom";
      this.controls.rebuildShape();
    }
    this.controls.refresh();
    this.scheduleRebuild();
  }

  // ── UI wiring ──────────────────────────────────────────────────────────────────────────────

  bindUI() {
    const doc = this.doc;
    const play = doc.getElementById("btn-play");
    const setPlay = (v) => {
      this.playing = v;
      play.textContent = v ? "Pause" : "Play";
    };
    this.setPlay = setPlay;
    play.addEventListener("click", () => setPlay(!this.playing));
    doc.getElementById("btn-reset").addEventListener("click", () => this.rebuild());
    doc.getElementById("btn-finish").addEventListener("click", () => {
      this.finishing = true;
      setPlay(true);
    });
    const speed = doc.getElementById("sel-speed");
    speed.addEventListener("change", () => (this.speed = Number(speed.value)));
    this.speed = Number(speed.value);

    for (const b of doc.querySelectorAll("[data-view]")) {
      b.addEventListener(
        "click",
        () => this.sim && this.view.setView(b.dataset.view, this.viewBounds()),
      );
    }
    for (const t of doc.querySelectorAll(".tab")) {
      t.addEventListener("click", () => this.showTab(t.dataset.tab));
    }

    doc.addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlay(!this.playing);
      } else if (e.key === "r" || e.key === "R") {
        this.rebuild();
      }
    });

    // Click (without drag) selects a carrier or a deposited yarn.
    const canvas = this.view.renderer.domElement;
    let down = null;
    canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = canvas.getBoundingClientRect();
      this.pickAt(e.clientX - r.left, e.clientY - r.top);
    });
    globalThis.addEventListener("resize", () => {
      if (!this.sim) return;
      const { w, h } = this.view.size;
      this.machineView.setResolution(w, h);
      this.overlayView.setResolution(w, h);
    });
  }

  /** Selects the carrier (raycast) or yarn (nearest centre line) under a viewport point. */
  pickAt(x, y) {
    const { w, h } = this.view.size;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.view.camera);
    if (this.display.showMachine) {
      const P = this.sim.machine.perFamily;
      for (const [fi, { pkg, base }] of this.machineView.carriers.entries()) {
        const hit = ray.intersectObjects([pkg, base])[0];
        if (hit && hit.instanceId !== undefined) {
          this.select(fi * P + hit.instanceId);
          return;
        }
      }
    }
    const k = this.yarnView.pick(x, y, this.view.camera, this.view.size);
    if (k >= 0) this.select(k);
  }

  showTab(name) {
    this.activeTab = name;
    for (const t of this.doc.querySelectorAll(".tab")) {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    }
    for (const p of this.doc.querySelectorAll(".tab-panel")) p.hidden = p.id !== `tab-${name}`;
    this.panels[name]?.show?.(this.sim, this.display);
  }

  showMessage(text, ms) {
    this.message.textContent = text;
    this.message.hidden = false;
    clearTimeout(this.msgTimer);
    if (ms) this.msgTimer = setTimeout(() => this.hideMessage(), ms);
  }

  hideMessage() {
    this.message.hidden = true;
  }

  // ── Main loop ──────────────────────────────────────────────────────────────────────────────

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    try {
      const sim = this.sim;
      if (sim && !sim.ended) {
        if (this.finishing) sim.advance(1e6, { budgetMs: 40 });
        else if (this.playing) sim.advance(dt * this.speed, { budgetMs: 14 });
        if (sim.ended) {
          this.finishing = false;
          this.showMessage(`Run finished (${sim.endReason}) after ${sim.time.toFixed(1)} s.`, 8000);
        }
      }
      if (sim) this.syncViews(now);
      this.view.render();
    } catch (err) {
      this.errors.push(String(err?.stack ?? err));
      console.error(err);
      this.playing = false;
    }
  }

  /** Pushes the current simulation state into every view. */
  syncViews(now = performance.now()) {
    const sim = this.sim;
    this.mandrelView.update(sim.time);
    this.mandrelView.group.updateMatrixWorld(true);
    this.machineView.update();
    this.yarnView.update();
    this.overlayView.update(this.view, this.yarnView.thickness * 3.5);
    this.status.update(sim);
    if (now - this.lastPanelUpdate > 250) {
      this.lastPanelUpdate = now;
      this.panels[this.activeTab]?.update?.(sim, this.display, this.overlayView);
    }
  }

  /** Small read-only handle for automated checks (tools/smoke.js). */
  debugHandle() {
    return {
      app: this,
      get time() {
        return this.app.sim?.time ?? 0;
      },
      get samples() {
        return this.app.sim ? this.app.sim.yarns.reduce((a, y) => a + y.count, 0) : 0;
      },
      get ended() {
        return this.app.sim?.ended ?? false;
      },
      get errors() {
        return this.app.errors;
      },
    };
  }
}
