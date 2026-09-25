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
];

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
      (display, view, tab) => {
        const app = globalThis.__braid.app;
        Object.assign(app.display, display);
        for (const k of Object.keys(display)) app.applyDisplay(k);
        if (view) app.view.setView(view, app.viewBounds());
        if (tab) app.showTab(tab);
      },
      { args: [sc.display, sc.view ?? null, sc.tab ?? null] },
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
      await new Promise((r) => setTimeout(r, Number(args.seconds) * 1000));
    }
    const state = await page.evaluate(() => ({
      time: globalThis.__braid.time,
      samples: globalThis.__braid.samples,
      errors: globalThis.__braid.errors,
      failed: performance.getEntriesByType("resource")
        .filter((r) => r.responseStatus >= 400)
        .map((r) => `${r.responseStatus} ${r.name}`),
    }));
    if (!(state.time > 0.5)) problems.push(`simulation did not advance (t = ${state.time})`);
    if (!(state.samples > 100)) problems.push(`too few deposited samples (${state.samples})`);
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
