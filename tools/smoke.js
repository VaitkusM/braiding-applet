/**
 * @file tools/smoke.js — end-to-end smoke test in headless Chrome (dev tool, not deployed).
 *
 * For each scenario it opens the applet (parameters in the URL hash), lets the simulation run,
 * optionally applies display settings, saves a screenshot, and FAILS if
 *   - the page throws, logs a console error, or shows the fatal-error overlay,
 *   - any resource (CDN modules, CSS) fails to load (HTTP status ≥ 400),
 *   - the simulation does not advance or deposits no yarn.
 *
 * Usage:
 *   deno task serve                         # in another terminal (http://127.0.0.1:8000/)
 *   deno task smoke [--url URL] [--out DIR] [--only name1,name2] [--seconds 4]
 * Uses the locally installed Google Chrome (set CHROME_PATH to override).
 */

import { launch } from "@astral/astral";
import { parseArgs } from "@std/cli/parse-args";
import { defaultParams, encodeParams } from "../src/params.js";

const args = parseArgs(Deno.args, {
  string: ["url", "out", "only", "seconds"],
  default: { url: "http://127.0.0.1:8000/", out: "screenshots", seconds: "4" },
});
const CHROME = Deno.env.get("CHROME_PATH") ??
  (Deno.build.os === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/usr/bin/google-chrome");

/** Scenario = parameter overrides + display settings + optional page actions. */
const SCENARIOS = [
  { name: "default-taper", params: {}, display: {} },
  { name: "cylinder-fell-zone", params: { mandrel: "cylinder" }, display: {}, view: "fell" },
  {
    name: "hourglass-curvature",
    params: { mandrel: "hourglass" },
    display: { mandrelColor: "K", yarnColor: "slip" },
  },
  {
    name: "off-axis",
    params: { mandrel: "cylinder", offsetXMm: 20, tiltDeg: 6, carriers: 24 },
    display: { yarnColor: "alpha" },
  },
  {
    name: "triaxial-regular",
    params: { mandrel: "bulge", triaxial: true },
    display: {},
    view: "fell",
  },
  {
    name: "diamond-run-to-end",
    params: { pattern: "diamond", carriers: 16, mandrel: "cone" },
    display: {},
    finish: true,
  },
  { name: "phone-width", params: {}, display: {}, viewport: { width: 400, height: 860 } },
  { name: "tab-plots-offaxis", params: { offsetXMm: 15, tiltDeg: 4 }, display: {}, tab: "plots" },
  {
    name: "tab-plots-cylinder-finished",
    params: { mandrel: "cylinder" },
    display: {},
    tab: "plots",
    finish: true,
  },
  { name: "tab-theory", params: { mandrel: "cone" }, display: { selectedYarn: 3 }, tab: "theory" },
  { name: "tab-profile-custom", params: { mandrel: "custom" }, display: {}, tab: "profile" },
  { name: "tab-about", params: {}, display: {}, tab: "about" },
  // Regression: switching the colour mode mid-run must recolour ALL yarns (checked by pixels).
  {
    name: "recolour-mid-run",
    params: { mandrel: "cylinder" },
    display: {},
    view: "fell",
    later: { yarnColor: "alpha" },
  },
  // Colour scales of every scalar colouring (data / full / custom), mandrel K scale, flat colour.
  { name: "colour-scales", params: {}, display: {}, check: checkColourScales, wait: 6 },
  // Switching the yarn drawing to flat tapes (rebuilds the yarn view mid-run).
  {
    name: "tape-style",
    params: { mandrel: "bulge" },
    display: { yarnStyle: "tape" },
    view: "fell",
  },
  // Regression: an invalid share link shows a message instead of crashing.
  { name: "invalid-link", params: { tieZMm: 5000 }, display: {}, expectNoSim: true },
  // Images for the README (docs/images): parameter panel collapsed.
  { name: "readme-overview", params: {}, display: {}, gui: false, wait: 9 },
  {
    name: "readme-fell-zone",
    params: { mandrel: "bulge", triaxial: true, carriers: 24 },
    display: {},
    view: "fell",
    gui: false,
    wait: 8,
  },
];

/**
 * In-page check of all colour scales (runs in the browser; returns a list of problems). Expected
 * ranges are computed here from the simulation data and the surface — independently of
 * src/view/scales.js — and compared with the colour-bar ticks.
 *  - sequential scales (α, slip, pressure): [min, centre (or 0 for both signs), max];
 *  - curvature maps (κn, κg, mandrel K/H; geo-framework convention): green at 0,
 *    [min(lo, 0), 0, max(hi, 0)], each occurring side at least 2 % of the largest magnitude,
 *    drawn without tone mapping; a one-signed map shows half a colour bar.
 */
function checkColourScales() {
  const app = globalThis.__braid.app, sim = app.sim, problems = [];
  app.playing = false;
  const ticksOf = (n) =>
    [...(document.querySelectorAll("#colorbar .cb-ticks")[n]?.children ?? [])].map((e) =>
      Number(e.textContent)
    );
  const setDisplay = (d) => {
    Object.assign(app.display, d);
    for (const k of Object.keys(d)) app.applyDisplay(k);
    app.syncViews();
  };
  const scaleEvent = (target, what, value) => {
    app.controls.scaleUI[target][what] = value;
    app.onScale(target, what);
    app.syncViews();
  };
  const visible = (re) =>
    [...document.querySelectorAll(".lil-controller")].filter((c) =>
      re.test(c.textContent) && c.style.display !== "none"
    ).length;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const fmt = (v) => v.map((x) => x.toPrecision(3)).join(" / ");
  const zeroPivot = (lo, hi, floor) => {
    const a = lo < 0 ? Math.min(lo, -floor) : 0, b = hi > 0 ? Math.max(hi, floor) : 0;
    return a === 0 && b === 0 ? [-(floor || 1), 0, floor || 1] : [a, 0, b];
  };
  // Ticks the colour bar draws for a range [min, mid, max] (half bar when mid sits at an end).
  const ticksFor = (
    [a, m, b],
  ) => (m <= a ? [m, (m + b) / 2, b] : m >= b ? [a, (a + m) / 2, m] : [a, m, b]);
  const signedMid = (lo, hi) => (lo < 0 && hi > 0 ? 0 : (lo + hi) / 2);

  // Independent references: principal curvatures sampled with SurfaceOfRevolution.principal.
  let knMin = Infinity, knMax = -Infinity, kAbs = 0, kLo = Infinity, kHi = -Infinity;
  for (let i = 0; i <= 2000; i++) {
    const p = sim.surface.principal((i / 2000) * sim.profile.length);
    knMin = Math.min(knMin, p.k_m, p.k_p);
    knMax = Math.max(knMax, p.k_m, p.k_p);
    kAbs = Math.max(kAbs, Math.abs(p.k_m), Math.abs(p.k_p));
    kLo = Math.min(kLo, p.K);
    kHi = Math.max(kHi, p.K);
  }
  const mu = sim.config.friction, T = sim.config.tension;
  const curvature = { kn: true, kg: true };
  const values = {
    alpha: (y, i) => Math.abs(y.alpha[i]) * 180 / Math.PI,
    slip: (y, i) => Math.abs(y.slip[i]) / mu,
    kn: (y, i) => y.kn[i],
    kg: (y, i) => y.kg[i],
    pressure: (y, i) => T * y.kn[i],
  };
  const full = {
    alpha: [0, 45, 90],
    slip: [0, 0.5, 1],
    kn: zeroPivot(knMin, knMax, 0),
    kg: [-kAbs, 0, kAbs],
    pressure: [T * knMin, signedMid(T * knMin, T * knMax), T * knMax],
  };

  for (const mode of Object.keys(values)) {
    setDisplay({ yarnColor: mode });
    app.yarnView.lastRangeUpdate = -Infinity; // bypass the throttle
    app.yarnView.followDataRange();
    app.updateColorbar();
    // Data range over the deposited bias yarns (tie samples excluded).
    let lo = Infinity, hi = -Infinity;
    for (const y of sim.yarns) {
      for (let i = 0; i < y.count; i++) {
        if (y.flags[i] & 1) continue;
        const v = values[mode](y, i);
        if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
      }
    }
    if (mode === "slip") [hi, lo] = [Math.min(hi, 1), Math.min(lo, Math.min(hi, 1))];
    const f = full[mode], fullSpan = f[2] - f[0];
    const mag = Math.max(Math.abs(f[0]), Math.abs(f[2]));
    const tol = 0.03 * Math.max(hi - lo, 0.02 * fullSpan) +
      0.06 * Math.max(Math.abs(lo), Math.abs(hi));
    let t = ticksOf(0);
    let expect = null;
    if (curvature[mode]) expect = ticksFor(zeroPivot(lo, hi, 0.02 * mag));
    else if (hi - lo >= 0.02 * fullSpan) {
      expect = [lo, mode === "alpha" || mode === "slip" ? (lo + hi) / 2 : signedMid(lo, hi), hi];
    }
    if (expect && !expect.every((v, k) => near(t[k], v, tol))) {
      problems.push(`${mode} data: ticks ${t} vs ${fmt(expect)}`);
    }
    if (app.yarnView.material.toneMapped === !!curvature[mode]) {
      problems.push(`${mode}: toneMapped = ${app.yarnView.material.toneMapped}`);
    }
    if (visible(/yarn colour scale/) !== 1) problems.push(`${mode}: scale selector not shown`);
    // Full range.
    scaleEvent("yarn", "mode", "full");
    t = ticksOf(0);
    const ftol = 0.02 * fullSpan + 0.06 * mag, ft = ticksFor(f);
    if (!ft.every((v, k) => near(t[k], v, ftol))) {
      problems.push(`${mode} full: ticks ${t} vs ${fmt(ft)}`);
    }
    // Custom: starts from the range shown (green stays at 0 for curvature maps), bounds ordered.
    const ordered = (q) =>
      curvature[mode]
        ? q.min <= q.mid && q.mid <= q.max && q.min < q.max
        : q.min < q.mid && q.mid < q.max;
    scaleEvent("yarn", "mode", "custom");
    if (visible(/↳ (min|mid|max)/) !== 3) problems.push(`${mode} custom: sliders not shown`);
    const sp = app.display.yarnScales[mode];
    if (!ordered(sp)) problems.push(`${mode} custom seed ${JSON.stringify(sp)}`);
    if (curvature[mode] && sp.mid !== 0) {
      problems.push(`${mode}: custom seed moved the green off 0`);
    }
    if (!(near(sp.min, f[0], ftol) && near(sp.max, f[2], ftol))) {
      problems.push(`${mode} custom did not start from the range shown: ${JSON.stringify(sp)}`);
    }
    scaleEvent("yarn", "min", sp.max + 1e6); // absurd value: must be clamped and reordered
    const s2 = app.display.yarnScales[mode];
    if (!ordered(s2)) problems.push(`${mode} ordering ${JSON.stringify(s2)}`);
    t = ticksOf(0);
    const ct = ticksFor([s2.min, s2.mid, s2.max]);
    if (!(near(t[0], ct[0], ftol) && near(t[2], ct[2], ftol))) {
      problems.push(`${mode} custom ticks ${t} vs ${fmt(ct)}`);
    }
  }
  // Each colouring keeps its own scale.
  setDisplay({ yarnColor: "alpha" });
  if (
    app.display.yarnScales.alpha.mode !== "custom" || app.yarnView.scales.alpha.mode !== "custom"
  ) {
    problems.push("alpha lost its custom scale after switching colourings");
  }
  setDisplay({ yarnColor: "family" });
  if (visible(/yarn colour scale/) !== 0) {
    problems.push("yarn scale selector shown for family colours");
  }
  if (app.yarnView.material.toneMapped !== true) {
    problems.push("family colours must be tone-mapped");
  }

  // Mandrel K: curvature map of the K values, exact hues; custom with the green moved.
  setDisplay({ mandrelColor: "K" });
  let t = ticksOf(0);
  const kMag = Math.max(Math.abs(kLo), Math.abs(kHi)),
    ek = ticksFor(zeroPivot(kLo, kHi, 0.02 * kMag));
  if (!ek.every((v, k) => near(t[k], v, 0.03 * kMag))) {
    problems.push(`mandrel K auto: ticks ${t} vs ${fmt(ek)}`);
  }
  if (app.mandrelView.mesh.material.toneMapped !== false) problems.push("mandrel K is tone-mapped");
  scaleEvent("mandrel", "mode", "custom");
  if (visible(/↳ (min|mid|max)/) !== 3) problems.push("mandrel custom: sliders not shown");
  const midK = 0.25 * kMag;
  scaleEvent("mandrel", "mid", midK);
  t = ticksOf(0);
  const mk = app.display.mandrelScales.K;
  if (!(near(t[1], mk.mid, 0.05 * kMag) && near(mk.mid, midK, 0.05 * kMag))) {
    problems.push(`mandrel custom mid: ticks ${t}, spec ${JSON.stringify(mk)}`);
  }
  // Flat colour: matte material with the chosen colour, picker shown, no legend.
  setDisplay({ mandrelColor: "flat", mandrelFlatColor: "#335577" });
  const mv = app.mandrelView;
  if (mv.mesh.material !== mv.flat || mv.flat.metalness !== 0) {
    problems.push("flat material not used");
  }
  if (mv.flat.color.getHexString() !== "335577") {
    problems.push(`flat colour ${mv.flat.color.getHexString()}`);
  }
  if (visible(/flat colour/) !== 1) problems.push("flat colour picker not shown");
  if (mv.legend !== null) problems.push("flat mode must not show a mandrel legend");
  setDisplay({ mandrelColor: "metal" });
  if (visible(/flat colour|mandrel colour scale/) !== 0) {
    problems.push("mandrel controls shown for metal");
  }
  return problems;
}

const only = args.only ? new Set(args.only.split(",")) : null;
await Deno.mkdir(args.out, { recursive: true });
const browser = await launch({
  path: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
let failures = 0;

for (const sc of SCENARIOS) {
  if (only && !only.has(sc.name)) continue;
  const p = { ...defaultParams(), ...sc.params };
  const url = `${args.url}#${encodeParams(p)}`;
  const problems = [];
  const page = await browser.newPage();
  await page.setViewportSize(sc.viewport ?? { width: 1600, height: 1000 });
  page.addEventListener("console", (e) => {
    if (e.detail.type === "error") problems.push(`console.error: ${e.detail.text}`);
  });
  page.addEventListener(
    "pageerror",
    (e) => problems.push(`page error: ${e.detail?.message ?? e.detail}`),
  );
  await page.goto(url, { waitUntil: "load" });

  // Wait for the app handle.
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const ok = await page.evaluate(() =>
      !!globalThis.__braid || !document.getElementById("fatal").hidden
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const fatal = await page.evaluate(() =>
    document.getElementById("fatal").hidden ? "" : document.getElementById("fatal-text").textContent
  );
  if (fatal) problems.push(`fatal overlay: ${fatal}`);

  if (!fatal) {
    await page.evaluate(
      (display, view, tab, gui) => {
        const app = globalThis.__braid.app;
        Object.assign(app.display, display);
        for (const k of Object.keys(display)) app.applyDisplay(k);
        if (view) app.view.setView(view, app.viewBounds());
        if (tab) app.showTab(tab);
        if (gui === false) app.controls.gui.close();
      },
      { args: [sc.display, sc.view ?? null, sc.tab ?? null, sc.gui ?? true] },
    );
    if (sc.finish) {
      await page.evaluate(() => document.getElementById("btn-finish").click());
      const tf = Date.now();
      while (Date.now() - tf < 60000 && !(await page.evaluate(() => globalThis.__braid.ended))) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!(await page.evaluate(() => globalThis.__braid.ended))) {
        problems.push("run-to-end did not finish");
      }
    } else {
      await new Promise((r) => setTimeout(r, (sc.wait ?? Number(args.seconds)) * 1000));
    }
    if (sc.later) {
      // Count "+"-family orange pixels with the machine hidden (bobbins and free yarns are orange
      // too), before and after switching to a scalar colour mode.
      const countOrange = () =>
        page.evaluate(() => {
          const app = globalThis.__braid.app;
          const gl = app.view.renderer.getContext();
          app.view.render();
          const { width: w, height: h } = gl.canvas;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let orange = 0;
          for (let i = 0; i < px.length; i += 4) {
            const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
            if (r > 150 && r - g > 50 && r - b > 80) orange++;
          }
          return orange;
        });
      await page.evaluate(() => {
        const app = globalThis.__braid.app;
        app.playing = false;
        // Hide everything but mandrel and yarns (bobbins, free yarns and the geodesic are coloured).
        const hide = {
          showMachine: false,
          showFreeYarns: false,
          showGeodesic: false,
          showDarboux: false,
        };
        Object.assign(app.display, hide);
        for (const k of Object.keys(hide)) app.applyDisplay(k);
      });
      await new Promise((r) => setTimeout(r, 500));
      const before = await countOrange();
      await page.evaluate((display) => {
        const app = globalThis.__braid.app;
        Object.assign(app.display, display);
        for (const k of Object.keys(display)) app.applyDisplay(k);
      }, { args: [sc.later] });
      await new Promise((r) => setTimeout(r, 1500));
      const after = await countOrange();
      console.log(`  orange yarn pixels: ${before} before, ${after} after recolouring`);
      if (!(before > 1000)) {
        problems.push(`recolour check invalid: only ${before} orange pixels before`);
      }
      if (after > 0.02 * before) {
        problems.push(`recolouring incomplete: ${after} orange pixels remain`);
      }
    }
    if (sc.check) {
      for (const pr of await page.evaluate(sc.check)) problems.push(pr);
    }
    const state = await page.evaluate(() => ({
      time: globalThis.__braid.time,
      samples: globalThis.__braid.samples,
      errors: globalThis.__braid.errors,
      failed: performance.getEntriesByType("resource")
        .filter((r) => r.responseStatus >= 400)
        .map((r) => `${r.responseStatus} ${r.name}`),
    }));
    if (sc.expectNoSim) {
      const msg = await page.evaluate(() => {
        const m = document.getElementById("message");
        return m.hidden ? "" : m.textContent;
      });
      if (!msg.includes("Cannot start")) {
        problems.push(`expected a "Cannot start" message, got "${msg}"`);
      }
      await page.evaluate(() =>
        document.querySelector("#canvas-host canvas").dispatchEvent(new PointerEvent("pointerup"))
      );
    } else {
      if (!(state.time > 0.5)) problems.push(`simulation did not advance (t = ${state.time})`);
      if (!(state.samples > 100)) problems.push(`too few deposited samples (${state.samples})`);
    }
    for (const e of state.errors) problems.push(`app error: ${e}`);
    for (const f of state.failed) problems.push(`resource failed: ${f}`);
    console.log(`  t = ${state.time.toFixed(1)} s, samples = ${state.samples}`);
  }

  const png = await page.screenshot();
  await Deno.writeFile(`${args.out}/${sc.name}.png`, png);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${sc.name} → ${args.out}/${sc.name}.png`);
  for (const pr of problems) console.log(`       ${pr}`);
  failures += problems.length ? 1 : 0;
  await page.close();
}

await browser.close();
if (failures) {
  console.error(`${failures} scenario(s) failed`);
  Deno.exit(1);
}
console.log("smoke test passed");
