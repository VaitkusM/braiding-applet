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
  // Braid-angle colour scale: data range (default), full range, custom min/mid/max.
  { name: "alpha-scale", params: {}, display: { yarnColor: "alpha" }, check: checkAlphaScale },
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
 * In-page check of the braid-angle colour scale (runs in the browser; returns a list of problems).
 * Colour-bar ticks must show the data range of the run, then 0/45/90, then the custom bounds.
 */
function checkAlphaScale() {
  const app = globalThis.__braid.app, problems = [];
  app.playing = false;
  const ticks = () =>
    [...document.querySelectorAll("#colorbar .cb-ticks")][0]
      ?.innerText.split(/\s+/).map(Number) ?? [];
  const set = (d) => {
    Object.assign(app.display, d);
    for (const k of Object.keys(d)) app.applyDisplay(k);
    app.syncViews();
  };
  // Data range of the deposited bias yarns (tie samples excluded).
  let lo = Infinity, hi = -Infinity;
  for (const y of app.sim.yarns) {
    for (let i = 0; i < y.count; i++) {
      if (y.flags[i] & 1) continue;
      const a = Math.abs(y.alpha[i]) * 180 / Math.PI;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  app.syncViews();
  app.yarnView.lastRangeUpdate = -Infinity; // bypass the throttle for this check
  app.yarnView.followDataRange();
  app.syncViews();
  let t = ticks();
  if (!(Math.abs(t[0] - lo) < 1 && Math.abs(t[2] - hi) < 1)) {
    problems.push(`data range ticks ${t} vs yarn |α| range ${lo.toFixed(1)}…${hi.toFixed(1)}`);
  }
  if (!(hi - lo < 60)) problems.push(`data range suspiciously wide: ${lo}…${hi}`);
  set({ alphaScale: "full" });
  t = ticks();
  if (t.join() !== "0,45,90") problems.push(`full range ticks ${t}`);
  set({ alphaScale: "custom" });
  const sliders = [...document.querySelectorAll(".lil-controller")]
    .filter((c) => /α (min|mid|max)/.test(c.textContent) && c.style.display !== "none").length;
  if (sliders !== 3) problems.push(`custom range: ${sliders} visible sliders (expected 3)`);
  set({ alphaMin: 30, alphaMid: 40, alphaMax: 60 });
  t = ticks();
  if (t.join() !== "30,40,60") problems.push(`custom ticks ${t}`);
  set({ alphaMin: 70 }); // must push mid and max up
  const d = app.display;
  if (!(d.alphaMin === 70 && d.alphaMid > 70 && d.alphaMax > d.alphaMid)) {
    problems.push(`ordering not kept: ${d.alphaMin}/${d.alphaMid}/${d.alphaMax}`);
  }
  set({ yarnColor: "family" });
  const modeShown = [...document.querySelectorAll(".lil-controller")]
    .some((c) => /α colour scale/.test(c.textContent) && c.style.display !== "none");
  if (modeShown) problems.push("α scale selector visible outside braid-angle colouring");
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
