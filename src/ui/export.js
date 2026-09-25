/**
 * @file export.js — data / image export and share links.
 */

import { downloadBlob } from "./plots.js";
import { FLAG } from "../core/yarnPath.js";

/**
 * Downloads every deposited sample of bias yarn k as CSV (SI units; angles in degrees).
 * @param {import("../core/simulation.js").Simulation} sim @param {number} k
 */
export function exportYarnCsv(sim, k) {
  const y = sim.yarns[k], T = sim.config.tension;
  const names = Object.entries(FLAG);
  const head = [
    "arc_m",
    "time_s",
    "z_m",
    "theta_deg",
    "x_m",
    "y_m",
    "alpha_deg",
    "kappa_n_per_m",
    "kappa_g_per_m",
    "slip_ratio",
    "pressure_N_per_m",
    "free_length_m",
    "flags",
  ];
  const lines = [head.join(",")];
  const n = (v) => (Number.isFinite(v) ? String(v) : "");
  for (let i = 0; i < y.count; i++) {
    const flags = names.filter(([, bit]) => y.flags[i] & bit).map(([name]) => name).join("|");
    lines.push([
      n(y.arc[i]),
      n(y.time[i]),
      n(y.zp[i]),
      n((y.th[i] * 180) / Math.PI),
      n(y.x[i]),
      n(y.y[i]),
      n((y.alpha[i] * 180) / Math.PI),
      n(y.kn[i]),
      n(y.kg[i]),
      n(y.slip[i]),
      n(T * y.kn[i]),
      n(y.free[i]),
      flags,
    ].join(","));
  }
  const fam = y.family === 1 ? "plus" : "minus";
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `yarn-${fam}${y.index}.csv`);
}

/** Downloads a PNG data URL. */
export async function downloadDataUrl(url, filename) {
  const blob = await (await fetch(url)).blob();
  downloadBlob(blob, filename);
}

/**
 * Copies the current URL (parameters are kept in the hash) to the clipboard.
 * @returns {Promise<boolean>} whether copying succeeded
 */
export async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(globalThis.location.href);
    return true;
  } catch {
    return false;
  }
}
