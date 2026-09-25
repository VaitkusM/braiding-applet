/**
 * @file plots.js — a small, dependency-free canvas line-chart component.
 *
 * Design rules (data-viz method used by this project):
 *  - one y-axis per chart (never dual axes); 2 px round-joined lines; hairline solid grid;
 *  - categorical series colours come from the fixed slot palette (colormaps.js SERIES); reference /
 *    threshold lines are dashed in muted ink; text is always ink, never the series colour;
 *  - a legend whenever there are ≥ 2 series; a crosshair tooltip that snaps to the nearest x and
 *    lists every series (value first, label second, short line key);
 *  - every chart has a table-view twin and CSV / PNG export.
 * NaN values break a line (gaps), so undefined data is never interpolated.
 */

import { INK } from "../view/colormaps.js";

/**
 * @typedef {Object} SeriesSpec
 * @property {string} key
 * @property {string} label
 * @property {string} color              CSS colour
 * @property {boolean} [dashed]          reference / threshold line
 * @property {boolean} [tooltipOnly]     not drawn, only listed in tooltip and table
 * @property {number} [digits]           decimals in tooltip/table (default 2)
 */

/** "Nice" tick values covering [a, b] with roughly n ticks. */
export function niceTicks(a, b, n = 5) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  if (a === b) {
    a -= 1;
    b += 1;
  }
  const span = b - a, raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** Compact number formatting for ticks and tooltips. */
export function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  return v.toFixed(digits);
}

/** Triggers a browser download of a Blob. */
export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export class LinePlot {
  /**
   * @param {HTMLElement} host container the card is appended to
   * @param {{title:string, subtitle?:string, xLabel:string, yLabel:string, series:SeriesSpec[],
   *          yMin?:number, yMax?:number, xMin?:number, xMax?:number, height?:number, file:string}} o
   */
  constructor(host, o) {
    this.o = o;
    this.data = { x: [], y: {}, band: null };
    const card = (this.card = document.createElement("div"));
    card.className = "plot-card";
    const head = document.createElement("div");
    head.className = "plot-head";
    const title = document.createElement("span");
    title.className = "plot-title";
    title.textContent = o.title;
    const sub = document.createElement("span");
    sub.className = "plot-sub";
    sub.textContent = o.subtitle ?? "";
    this.subEl = sub;
    const actions = document.createElement("div");
    actions.className = "plot-actions";
    for (
      const [label, fn] of [["Table", () => this.toggleTable()], ["CSV", () => this.exportCsv()], [
        "PNG",
        () => this.exportPng(),
      ]]
    ) {
      const b = document.createElement("button");
      b.className = "btn";
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      actions.appendChild(b);
    }
    head.append(title, sub, actions);

    const legend = document.createElement("div");
    legend.className = "plot-legend";
    this.legendEl = legend;
    this.renderLegend();

    const wrap = document.createElement("div");
    wrap.className = "plot-canvas-wrap";
    wrap.style.height = `${o.height ?? 190}px`;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", `${o.title}: ${o.yLabel} versus ${o.xLabel}`);
    this.tooltip = document.createElement("div");
    this.tooltip.className = "plot-tooltip";
    this.tooltip.hidden = true;
    wrap.append(this.canvas, this.tooltip);
    this.wrap = wrap;

    this.tableWrap = document.createElement("div");
    this.tableWrap.className = "plot-table-wrap";
    this.tableWrap.hidden = true;

    card.append(head, legend, wrap, this.tableWrap);
    host.appendChild(card);

    this.hoverX = null;
    this.canvas.addEventListener("pointermove", (e) => this.onHover(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.hidden = true;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(wrap);
  }

  /** Legend: a line key per drawn series (≥ 2 series), dashed for references. */
  renderLegend() {
    const drawn = this.o.series.filter((s) => !s.tooltipOnly);
    this.legendEl.replaceChildren();
    this.legendEl.hidden = drawn.length < 2;
    for (const s of drawn) {
      const item = document.createElement("span");
      item.className = "legend-item";
      const key = document.createElement("span");
      key.className = `legend-line${s.dashed ? " dashed" : ""}`;
      key.style.borderTopColor = s.color;
      const lab = document.createElement("span");
      lab.textContent = s.label;
      item.append(key, lab);
      this.legendEl.appendChild(item);
    }
  }

  setSubtitle(text) {
    this.subEl.textContent = text;
  }

  /**
   * @param {{x:number[], y:Record<string, number[]>, band?:{lo:number[], hi:number[], color:string}|null,
   *          xMin?:number, xMax?:number}} d
   */
  setData(d) {
    this.data = d;
    this.draw();
    if (!this.tableWrap.hidden) this.renderTable();
  }

  /** Axis ranges from options and data. */
  ranges() {
    const { x, y, band } = this.data;
    let x0 = this.data.xMin ?? this.o.xMin ?? Infinity,
      x1 = this.data.xMax ?? this.o.xMax ?? -Infinity;
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) {
      for (const v of x) {
        if (Number.isFinite(v)) {
          x0 = Math.min(x0, v);
          x1 = Math.max(x1, v);
        }
      }
    }
    let y0 = this.o.yMin ?? Infinity, y1 = this.o.yMax ?? -Infinity;
    if (this.o.yMin === undefined || this.o.yMax === undefined) {
      let lo = Infinity, hi = -Infinity;
      const scan = (arr) => {
        for (const v of arr ?? []) {
          if (Number.isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      };
      for (const s of this.o.series) if (!s.tooltipOnly) scan(y[s.key]);
      if (band) {
        scan(band.lo);
        scan(band.hi);
      }
      if (this.o.yMin === undefined) y0 = lo;
      if (this.o.yMax === undefined) y1 = hi;
      if (y0 === y1) {
        y0 -= 1;
        y1 += 1;
      }
    }
    if (!Number.isFinite(x0)) [x0, x1] = [0, 1];
    if (!Number.isFinite(y0)) [y0, y1] = [0, 1];
    if (x0 === x1) x1 = x0 + 1;
    return { x0, x1, y0, y1 };
  }

  /** Redraws the chart. */
  draw() {
    const c = this.canvas, dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const m = { l: 50, r: 12, t: 8, b: 32 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    let { x0, x1, y0, y1 } = this.ranges();
    let yt = niceTicks(y0, y1, Math.max(3, Math.round(ph / 40)));
    if (yt.length >= 2) {
      // Auto-ranged ends snap outwards to the enclosing tick, so no line runs along the frame.
      const step = yt[1] - yt[0];
      if (this.o.yMin === undefined) y0 = Math.floor(y0 / step + 1e-9) * step;
      if (this.o.yMax === undefined) y1 = Math.ceil(y1 / step - 1e-9) * step;
      if (y1 === y0) y1 = y0 + step;
      yt = niceTicks(y0, y1, Math.max(3, Math.round(ph / 40)));
    }
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * pw;
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
    this.geom = { m, pw, ph, x0, x1, X };

    // Grid + ticks (hairline, solid, recessive).
    g.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.lineWidth = 1;
    g.fillStyle = INK.muted;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const v of yt) {
      if (v < y0 - 1e-12 || v > y1 + 1e-12) continue;
      const py = Math.round(Y(v)) + 0.5;
      g.strokeStyle = INK.grid;
      g.beginPath();
      g.moveTo(m.l, py);
      g.lineTo(m.l + pw, py);
      g.stroke();
      g.fillText(fmtTick(v), m.l - 6, py);
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const v of niceTicks(x0, x1, Math.max(3, Math.round(pw / 70)))) {
      if (v < x0 - 1e-12 || v > x1 + 1e-12) continue;
      g.fillText(fmtTick(v), X(v), m.t + ph + 5);
    }
    g.strokeStyle = INK.axis;
    g.beginPath();
    g.moveTo(m.l, m.t + ph + 0.5);
    g.lineTo(m.l + pw, m.t + ph + 0.5);
    g.stroke();
    // Axis titles.
    g.fillStyle = INK.muted;
    g.textAlign = "right";
    g.fillText(this.o.xLabel, m.l + pw, m.t + ph + 18);
    g.save();
    g.translate(11, m.t + ph / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(this.o.yLabel, 0, 0);
    g.restore();

    g.save();
    g.beginPath();
    g.rect(m.l, m.t, pw, ph);
    g.clip();
    const { x, y, band } = this.data;
    // Band (e.g. min/max over yarns).
    if (band && x.length) {
      g.fillStyle = band.color;
      g.globalAlpha = 0.22;
      g.beginPath();
      let open = false;
      const flush = (from, to) => {
        if (to <= from) return;
        g.moveTo(X(x[from]), Y(band.hi[from]));
        for (let i = from + 1; i <= to; i++) g.lineTo(X(x[i]), Y(band.hi[i]));
        for (let i = to; i >= from; i--) g.lineTo(X(x[i]), Y(band.lo[i]));
        g.closePath();
      };
      let start = -1;
      for (let i = 0; i <= x.length; i++) {
        const ok = i < x.length && Number.isFinite(band.lo[i]) && Number.isFinite(band.hi[i]);
        if (ok && !open) {
          start = i;
          open = true;
        } else if (!ok && open) {
          flush(start, i - 1);
          open = false;
        }
      }
      g.fill();
      g.globalAlpha = 1;
    }
    // Series.
    g.lineJoin = g.lineCap = "round";
    for (const s of this.o.series) {
      const ys = y[s.key];
      if (s.tooltipOnly || !ys) continue;
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.setLineDash(s.dashed ? [5, 4] : []);
      g.beginPath();
      let pen = false;
      for (let i = 0; i < x.length; i++) {
        if (!Number.isFinite(ys[i]) || !Number.isFinite(x[i])) {
          pen = false;
          continue;
        }
        const px = X(x[i]), py = Y(ys[i]);
        if (pen) g.lineTo(px, py);
        else g.moveTo(px, py);
        pen = true;
      }
      g.stroke();
    }
    g.setLineDash([]);
    // Crosshair.
    if (this.hoverX !== null) {
      const px = Math.round(X(x[this.hoverX])) + 0.5;
      g.strokeStyle = INK.secondary;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, m.t);
      g.lineTo(px, m.t + ph);
      g.stroke();
      for (const s of this.o.series) {
        const v = y[s.key]?.[this.hoverX];
        if (s.tooltipOnly || !Number.isFinite(v)) continue;
        g.fillStyle = s.color;
        g.strokeStyle = INK.surface;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, Y(v), 4, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  /** Crosshair snapping to the nearest x + tooltip listing all series. */
  onHover(e) {
    const { x } = this.data;
    if (!x.length || !this.geom) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i])) continue;
      const d = Math.abs(this.geom.X(x[i]) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    this.hoverX = best;
    this.draw();
    const tt = this.tooltip;
    tt.replaceChildren();
    const head = document.createElement("div");
    head.className = "tt-x";
    head.textContent = `${this.o.xLabel}: ${fmtNum(x[best], 2)}`;
    tt.appendChild(head);
    for (const s of this.o.series) {
      const v = this.data.y[s.key]?.[best];
      const row = document.createElement("div");
      row.className = "tt-row";
      const key = document.createElement("span");
      key.className = `legend-line${s.dashed ? " dashed" : ""}`;
      key.style.borderTopColor = s.tooltipOnly ? "transparent" : s.color;
      const val = document.createElement("span");
      val.className = "tt-val";
      val.textContent = fmtNum(v, s.digits ?? 2);
      const lab = document.createElement("span");
      lab.textContent = s.label;
      row.append(key, val, lab);
      tt.appendChild(row);
    }
    tt.hidden = false;
    const W = this.wrap.clientWidth;
    const left = px + 14 + 180 > W ? px - 14 - tt.offsetWidth : px + 14;
    tt.style.left = `${Math.max(0, left)}px`;
    tt.style.top = "6px";
  }

  /** Rows for table / CSV (subsampled to ≤ maxRows). */
  rows(maxRows = Infinity) {
    const { x, y } = this.data;
    const step = Math.max(1, Math.ceil(x.length / maxRows));
    const out = [];
    for (let i = 0; i < x.length; i += step) {
      out.push([
        x[i],
        ...this.o.series.map((s) => y[s.key]?.[i]),
      ]);
    }
    return out;
  }

  toggleTable() {
    this.tableWrap.hidden = !this.tableWrap.hidden;
    if (!this.tableWrap.hidden) this.renderTable();
  }

  renderTable() {
    const t = document.createElement("table");
    t.className = "data";
    const hr = document.createElement("tr");
    for (const h of [this.o.xLabel, ...this.o.series.map((s) => s.label)]) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.appendChild(th);
    }
    t.appendChild(hr);
    for (const r of this.rows(200)) {
      const tr = document.createElement("tr");
      r.forEach((v, j) => {
        const td = document.createElement("td");
        td.textContent = fmtNum(v, j === 0 ? 2 : this.o.series[j - 1].digits ?? 2);
        tr.appendChild(td);
      });
      t.appendChild(tr);
    }
    this.tableWrap.replaceChildren(t);
  }

  exportCsv() {
    const esc = (s) => `"${String(s).replaceAll('"', '""')}"`;
    const lines = [[this.o.xLabel, ...this.o.series.map((s) => s.label)].map(esc).join(",")];
    for (const r of this.rows()) {
      lines.push(r.map((v) => (Number.isFinite(v) ? String(v) : "")).join(","));
    }
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `${this.o.file}.csv`);
  }

  exportPng() {
    // Draw onto an opaque surface so the PNG is readable outside the app.
    const src = this.canvas, out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d");
    g.fillStyle = INK.surface;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0);
    out.toBlob((b) => b && downloadBlob(b, `${this.o.file}.png`), "image/png");
  }
}

/** Tick label formatting: trims trailing zeros. */
function fmtTick(v) {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(0);
  return String(Number(v.toPrecision(6)));
}
