/**
 * @file colorbar.js — the colour legend in the corner of the 3D view. It shows the active colour
 * scale(s): the yarn scale and, if the mandrel is painted, the curvature scale, each with title,
 * range and unit, plus swatch keys for categorical/status colours (never colour alone: every key
 * has a label).
 */

import { rampCss } from "../view/colormaps.js";

/** Formats a tick value compactly. */
function fmt(x) {
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(1);
  return x.toPrecision(2);
}

export class ColorBar {
  /** @param {HTMLElement} el */
  constructor(el) {
    this.el = el;
  }

  /** @param {Array<object|null>} legends descriptors from YarnView.legend() / MandrelView.legend */
  render(legends) {
    const list = legends.filter(Boolean);
    this.el.replaceChildren();
    this.el.hidden = list.length === 0;
    for (const lg of list) {
      const block = document.createElement("div");
      block.style.marginBottom = "6px";
      const title = document.createElement("div");
      title.className = "cb-title";
      title.textContent = lg.title + (lg.unit ? ` [${lg.unit}]` : "");
      block.appendChild(title);
      if (lg.kind) {
        // The ramp centre is the pivot value `mid`. If mid coincides with an end (a one-signed
        // curvature map), only the used half of the ramp is drawn.
        const mid = lg.mid ?? (lg.min + lg.max) / 2;
        let t0 = 0, t1 = 1, ends = [lg.min, mid, lg.max];
        if (mid <= lg.min && lg.max > mid) [t0, ends] = [0.5, [mid, (mid + lg.max) / 2, lg.max]];
        else if (mid >= lg.max && lg.min < mid) {
          [t1, ends] = [0.5, [lg.min, (lg.min + mid) / 2, mid]];
        }
        const ramp = document.createElement("div");
        ramp.className = "cb-ramp";
        ramp.style.background = rampCss(lg.kind, t0, t1);
        const ticks = document.createElement("div");
        ticks.className = "cb-ticks";
        for (const v of ends) {
          const s = document.createElement("span");
          s.textContent = fmt(v);
          ticks.appendChild(s);
        }
        block.append(ramp, ticks);
      }
      if (lg.keys) {
        const keys = document.createElement("div");
        keys.className = "cb-keys";
        for (const k of lg.keys) {
          const item = document.createElement("span");
          item.className = "cb-key";
          const sw = document.createElement("span");
          sw.className = "cb-swatch";
          sw.style.background = k.color;
          const lab = document.createElement("span");
          lab.textContent = k.label;
          item.append(sw, lab);
          keys.appendChild(item);
        }
        block.appendChild(keys);
      }
      this.el.appendChild(block);
    }
  }
}
