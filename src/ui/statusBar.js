/**
 * @file statusBar.js — top-bar read-outs (time, progress) and live status badges.
 *
 * Badges are status indicators (reserved colours, always with a text label): a badge turns "live"
 * while the condition holds at the current fell line, and shows the cumulative count of affected
 * deposited samples.
 */

import { FLAG } from "../core/yarnPath.js";

const BADGES = [
  {
    key: "slip",
    flag: FLAG.SLIP,
    label: "slip",
    level: "critical",
    title: "Friction cannot hold the yarn path: |κg| > μ κn",
  },
  {
    key: "bridge",
    flag: FLAG.BRIDGE,
    label: "bridging",
    level: "serious",
    title: "Yarn suspended over a non-convex region (straight chord)",
  },
  {
    key: "contact",
    flag: FLAG.CONTACT,
    label: "contact",
    level: "serious",
    title: "The free yarn caught on the mandrel ahead of the fell point",
  },
  {
    key: "liftoff",
    flag: FLAG.LIFTOFF,
    label: "lift-off",
    level: "serious",
    title: "The free yarn lifted off the surface",
  },
  {
    key: "jam",
    flag: FLAG.JAM,
    label: "jamming",
    level: "warning",
    title: "Local cover k ≥ 1: yarns of one family would overlap",
  },
];

export class StatusBar {
  constructor(doc) {
    this.time = doc.getElementById("ro-time");
    this.bar = doc.getElementById("progress-bar");
    this.host = doc.getElementById("badges");
    this.els = {};
    for (const b of BADGES) {
      const el = doc.createElement("span");
      el.className = "badge";
      el.title = b.title;
      const dot = doc.createElement("span");
      dot.className = "dot";
      const txt = doc.createElement("span");
      el.append(dot, txt);
      this.host.appendChild(el);
      this.els[b.key] = { el, txt, b };
    }
  }

  /** @param {import("../core/simulation.js").Simulation} sim */
  update(sim) {
    this.time.textContent = `${sim.time.toFixed(1)} s`;
    this.bar.style.width = `${(sim.progress * 100).toFixed(1)}%`;
    let current = 0;
    for (const f of sim.currentFlags) current |= f;
    for (const { el, txt, b } of Object.values(this.els)) {
      const count = sim.stats[b.key];
      const live = (current & b.flag) !== 0;
      el.hidden = count === 0;
      el.className = `badge ${live ? `live ${b.level}` : ""}`;
      txt.textContent = `${b.label} ${live ? "now" : ""} · ${count}`;
    }
  }
}
