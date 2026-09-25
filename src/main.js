/**
 * @file main.js — entry point. Checks WebGL, loads the application dynamically (so that a failed
 * CDN import can be reported instead of leaving a blank page) and exposes `globalThis.__braid`,
 * a small read-only handle used by the automated smoke test (tools/smoke.js).
 */

function fatal(err) {
  const box = document.getElementById("fatal");
  document.getElementById("fatal-text").textContent = String(err?.message ?? err);
  box.hidden = false;
  console.error(err);
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

try {
  if (!webglAvailable()) throw new Error("WebGL is not available in this browser.");
  const { App } = await import("./app.js");
  const app = new App(document);
  globalThis.__braid = app.debugHandle();
} catch (err) {
  fatal(err);
}
